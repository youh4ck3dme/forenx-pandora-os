/**
 * Pure ForenZX outbox dispatch decisions.
 *
 * The database trigger only inserts a pending row. This module decides how a
 * worker records the HTTP result so a failed post cannot drop the job.
 */

export const MAX_DISPATCH_ATTEMPTS = 8;

export type DispatchStatus = "pending" | "sent" | "failed";

export type OutboxRow = {
  id: string;
  evidence_id: string;
  case_id: string | null;
  payload: unknown;
  status: DispatchStatus;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
};

export type DispatchOutcome =
  | { kind: "success" }
  | { kind: "retry" | "terminal"; error: string };

export function backoffMs(attemptsAfterClaim: number): number {
  const exp = Math.max(0, attemptsAfterClaim - 1);
  const raw = 30_000 * 2 ** exp;
  return Math.min(raw, 3_600_000);
}

export function claimForDispatch(row: OutboxRow, now: Date): OutboxRow {
  const attempts = row.attempts + 1;
  return {
    ...row,
    attempts,
    updated_at: now.toISOString(),
    next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
  };
}

/** 2xx succeeds. 408/429/5xx retry. Other 4xx are terminal but the row is kept. */
export function classifyDispatchHttp(status: number): "success" | "retry" | "terminal" {
  if (status >= 200 && status < 300) return "success";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "terminal";
}

export function applyDispatchResult(row: OutboxRow, outcome: DispatchOutcome, now: Date): OutboxRow {
  if (outcome.kind === "success") {
    return {
      ...row,
      status: "sent",
      last_error: null,
      updated_at: now.toISOString(),
    };
  }

  const terminal = outcome.kind === "terminal" || row.attempts >= MAX_DISPATCH_ATTEMPTS;
  return {
    ...row,
    status: terminal ? "failed" : "pending",
    last_error: outcome.error.slice(0, 2000),
    updated_at: now.toISOString(),
  };
}

export type DispatchBatchDeps = {
  now?: Date;
  listDue: (now: Date) => Promise<OutboxRow[]>;
  compareAndClaim: (original: OutboxRow, claimed: OutboxRow) => Promise<OutboxRow | null>;
  save: (row: OutboxRow) => Promise<void>;
  postWebhook: (payload: unknown) => Promise<{ ok: boolean; status: number; errorText?: string }>;
};

export type DispatchBatchResult = {
  sent: number;
  kept: number;
  failed: number;
};

/**
 * Claim due rows, POST each payload, and persist the outcome.
 * Network and HTTP failures update last_error and leave the row in place.
 */
export async function processDispatchBatch(deps: DispatchBatchDeps): Promise<DispatchBatchResult> {
  const now = deps.now ?? new Date();
  const due = await deps.listDue(now);
  const result: DispatchBatchResult = { sent: 0, kept: 0, failed: 0 };

  for (const row of due) {
    const claimed = claimForDispatch(row, now);
    const owned = await deps.compareAndClaim(row, claimed);
    if (!owned) continue;

    let outcome: DispatchOutcome;
    try {
      const response = await deps.postWebhook(owned.payload);
      if (response.ok || classifyDispatchHttp(response.status) === "success") {
        outcome = { kind: "success" };
      } else {
        const kind = classifyDispatchHttp(response.status);
        const error = response.errorText?.trim() || `webhook HTTP ${response.status}`;
        outcome = { kind: kind === "terminal" ? "terminal" : "retry", error };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "webhook dispatch failed";
      outcome = { kind: "retry", error: message };
    }

    const saved = applyDispatchResult(owned, outcome, now);
    await deps.save(saved);
    if (saved.status === "sent") result.sent += 1;
    else if (saved.status === "failed") result.failed += 1;
    else result.kept += 1;
  }

  return result;
}
