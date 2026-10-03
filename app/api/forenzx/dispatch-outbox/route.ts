import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  processDispatchBatch,
  type OutboxRow,
} from "@/lib/forza/forenzx-dispatch-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/forenzx/dispatch-outbox
 *
 * Machine-to-machine worker for forenzx_dispatch_outbox.
 * Auth: FORENZX_WEBHOOK_SECRET via Bearer or x-forenzx-webhook-secret.
 * Schedule this route from cron. It never deletes a row on HTTP failure.
 */

const BATCH_LIMIT = 10;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === secret) return true;
  if (request.headers.get("x-forenzx-webhook-secret") === secret) return true;
  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.FORENZX_EVIDENCE_WEBHOOK_URL?.trim();
  const webhookSecret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      { error: "FORENZX_EVIDENCE_WEBHOOK_URL is not configured; pending rows were left untouched" },
      { status: 503 },
    );
  }

  const admin = supabaseAdmin as any;

  try {
    const summary = await processDispatchBatch({
      listDue: async (now) => {
        const { data, error } = await admin
          .from("forenzx_dispatch_outbox")
          .select(
            "id, evidence_id, case_id, payload, status, attempts, last_error, next_attempt_at, created_at, updated_at",
          )
          .eq("status", "pending")
          .lte("next_attempt_at", now.toISOString())
          .order("created_at", { ascending: true })
          .limit(BATCH_LIMIT);
        if (error) throw new Error(error.message);
        return (data ?? []) as OutboxRow[];
      },
      compareAndClaim: async (original, claimed) => {
        const { data, error } = await admin
          .from("forenzx_dispatch_outbox")
          .update({
            attempts: claimed.attempts,
            next_attempt_at: claimed.next_attempt_at,
            updated_at: claimed.updated_at,
          })
          .eq("id", original.id)
          .eq("status", "pending")
          .eq("attempts", original.attempts)
          .select(
            "id, evidence_id, case_id, payload, status, attempts, last_error, next_attempt_at, created_at, updated_at",
          )
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data ?? null) as OutboxRow | null;
      },
      save: async (row) => {
        const { error } = await admin
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
        });
        if (response.ok) return { ok: true, status: response.status };
        const errorText = await response.text().catch(() => "");
        return { ok: false, status: response.status, errorText: errorText.slice(0, 500) };
      },
    });

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dispatch worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
