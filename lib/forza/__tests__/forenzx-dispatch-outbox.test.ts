// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_DISPATCH_ATTEMPTS,
  applyDispatchResult,
  claimForDispatch,
  processDispatchBatch,
  type OutboxRow,
} from "../forenzx-dispatch-worker";

const NOW = new Date("2026-10-03T10:00:00.000Z");

function pendingRow(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    evidence_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    case_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    payload: { evidenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", type: "UPDATE" },
    status: "pending",
    attempts: 0,
    last_error: null,
    next_attempt_at: "2026-10-03T09:00:00.000Z",
    created_at: "2026-10-03T08:00:00.000Z",
    updated_at: "2026-10-03T08:00:00.000Z",
    ...overrides,
  };
}

describe("forenzx dispatch outbox", () => {
  it("migration inserts an outbox row and does not swallow errors", () => {
    const sql = readFileSync(
      "supabase/migrations/20261003120000_forenzx_dispatch_outbox.sql",
      "utf8",
    );
    const code = sql.replace(/--.*$/gm, "");
    expect(code).toContain("insert into public.forenzx_dispatch_outbox");
    expect(code).toContain("public._forenzx_notify_on_evidence_verified");
    expect(code.toLowerCase()).not.toContain("then null");
    expect(code.toLowerCase()).not.toContain("exception when others");
    expect(code).not.toContain("http_post");
  });

  it("keeps the row and records last_error when HTTP dispatch throws", async () => {
    const saved: OutboxRow[] = [];
    const summary = await processDispatchBatch({
      now: NOW,
      listDue: async () => [pendingRow()],
      compareAndClaim: async (_original, claimed) => claimed,
      save: async (row) => {
        saved.push(row);
      },
      postWebhook: async () => {
        throw new Error("connection refused");
      },
    });

    expect(summary).toEqual({ sent: 0, kept: 1, failed: 0 });
    expect(saved).toHaveLength(1);
    expect(saved[0].status).toBe("pending");
    expect(saved[0].attempts).toBe(1);
    expect(saved[0].last_error).toContain("connection refused");
    expect(saved[0].id).toBe(pendingRow().id);
  });

  it("marks a terminal HTTP failure as failed without deleting the row", async () => {
    const saved: OutboxRow[] = [];
    const summary = await processDispatchBatch({
      now: NOW,
      listDue: async () => [pendingRow()],
      compareAndClaim: async (_original, claimed) => claimed,
      save: async (row) => {
        saved.push(row);
      },
      postWebhook: async () => ({ ok: false, status: 403, errorText: "ledger case mismatch" }),
    });

    expect(summary.failed).toBe(1);
    expect(saved[0].status).toBe("failed");
    expect(saved[0].last_error).toContain("ledger case mismatch");
    expect(saved[0].evidence_id).toBe(pendingRow().evidence_id);
  });

  it("marks the row sent only after a successful post", async () => {
    const saved: OutboxRow[] = [];
    const summary = await processDispatchBatch({
      now: NOW,
      listDue: async () => [pendingRow()],
      compareAndClaim: async (_original, claimed) => claimed,
      save: async (row) => {
        saved.push(row);
      },
      postWebhook: async () => ({ ok: true, status: 200 }),
    });

    expect(summary.sent).toBe(1);
    expect(saved[0].status).toBe("sent");
    expect(saved[0].last_error).toBeNull();
  });

  it("does not drop a row that has exhausted retries", () => {
    const claimed = claimForDispatch(
      pendingRow({ attempts: MAX_DISPATCH_ATTEMPTS - 1 }),
      NOW,
    );
    const saved = applyDispatchResult(
      claimed,
      { kind: "retry", error: "webhook HTTP 503" },
      NOW,
    );
    expect(claimed.attempts).toBe(MAX_DISPATCH_ATTEMPTS);
    expect(saved.status).toBe("failed");
    expect(saved.last_error).toContain("503");
  });
});
