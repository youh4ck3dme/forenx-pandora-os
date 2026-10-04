import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  processDispatchBatch,
  type DispatchBatchResult,
  type OutboxRow,
} from "@/lib/forza/forenzx-dispatch-worker";

const DEFAULT_LIMIT = 10;
const SELECT_COLUMNS =
  "id, evidence_id, case_id, payload, status, attempts, last_error, next_attempt_at, created_at, updated_at";

export type DrainForenzxDispatchOptions = {
  /** When set, only the outbox row for this evidence item is claimed. */
  evidenceId?: string;
  limit?: number;
  /** Caps the webhook POST so a verify request cannot wait forever. */
  fetchTimeoutMs?: number;
};

export type DrainForenzxDispatchResult =
  | ({ skipped: false } & DispatchBatchResult)
  | { skipped: true; reason: string };

/**
 * Claim due forenzx_dispatch_outbox rows and POST the evidence webhook.
 * Auth material is FORENZX_WEBHOOK_SECRET (sent as x-forenzx-webhook-secret).
 * A failed POST is recorded on the row; this function does not delete it.
 * Missing config returns skipped instead of throwing so callers can leave the row pending.
 */
export async function drainForenzxDispatchOutbox(
  options: DrainForenzxDispatchOptions = {},
): Promise<DrainForenzxDispatchResult> {
  const webhookUrl = process.env.FORENZX_EVIDENCE_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  if (!webhookUrl || !webhookSecret) {
    const reason = "CONFIG_MISSING: FORENZX_EVIDENCE_WEBHOOK_URL or FORENZX_WEBHOOK_SECRET is not configured";
    if (options.evidenceId) {
      await supabaseAdmin
        .from("forenzx_dispatch_outbox")
        .update({ last_error: reason, updated_at: new Date().toISOString() })
        .eq("evidence_id", options.evidenceId)
        .eq("status", "pending");
    }
    return {
      skipped: true,
      reason,
    };
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 25_000;

  const summary = await processDispatchBatch({
    listDue: async (now) => {
      let query = supabaseAdmin
        .from("forenzx_dispatch_outbox")
        .select(SELECT_COLUMNS)
        .eq("status", "pending")
        .lte("next_attempt_at", now.toISOString())
        .order("created_at", { ascending: true })
        .limit(limit);
      if (options.evidenceId) query = query.eq("evidence_id", options.evidenceId);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data ?? []) as OutboxRow[];
    },
    compareAndClaim: async (original, claimed) => {
      const { data, error } = await supabaseAdmin
        .from("forenzx_dispatch_outbox")
        .update({
          attempts: claimed.attempts,
          next_attempt_at: claimed.next_attempt_at,
          updated_at: claimed.updated_at,
        })
        .eq("id", original.id)
        .eq("status", "pending")
        .eq("attempts", original.attempts)
        .select(SELECT_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data ?? null) as OutboxRow | null;
    },
    save: async (row) => {
      const { error } = await supabaseAdmin
        .from("forenzx_dispatch_outbox")
        .update({
          status: row.status,
          attempts: row.attempts,
          last_error: row.last_error,
          next_attempt_at: row.next_attempt_at,
          updated_at: row.updated_at,
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    },
    postWebhook: async (payload) => {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forenzx-webhook-secret": webhookSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(fetchTimeoutMs),
      });
      if (response.ok) return { ok: true, status: response.status };
      const errorText = await response.text().catch(() => "");
      return { ok: false, status: response.status, errorText: errorText.slice(0, 500) };
    },
  });

  return { skipped: false, ...summary };
}
