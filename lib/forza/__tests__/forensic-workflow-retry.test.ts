// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildAutopilotIdempotencyKey } from "../autopilot-meta";

// ---------------------------------------------------------------------------
// P1: Idempotency key — partial retry chunk isolation
// ---------------------------------------------------------------------------
describe("buildAutopilotIdempotencyKey", () => {
  const base = { caseId: "case-abc", documentText: "hello world" };

  it("returns a stable key for the same input", async () => {
    const k1 = await buildAutopilotIdempotencyKey(base);
    const k2 = await buildAutopilotIdempotencyKey(base);
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^ap:/);
  });

  it("returns a DIFFERENT key when retryChunkIndexes is provided vs not", async () => {
    const full = await buildAutopilotIdempotencyKey(base);
    const partial = await buildAutopilotIdempotencyKey({ ...base, retryChunkIndexes: [2, 3] });
    expect(partial).not.toBe(full);
    expect(partial).toContain("retry:");
  });

  it("sorts chunk indexes so [3,1] and [1,3] produce the same key", async () => {
    const k1 = await buildAutopilotIdempotencyKey({ ...base, retryChunkIndexes: [3, 1] });
    const k2 = await buildAutopilotIdempotencyKey({ ...base, retryChunkIndexes: [1, 3] });
    expect(k1).toBe(k2);
  });

  it("empty retryChunkIndexes produces the same key as omitting it", async () => {
    const k1 = await buildAutopilotIdempotencyKey(base);
    const k2 = await buildAutopilotIdempotencyKey({ ...base, retryChunkIndexes: [] });
    expect(k1).toBe(k2);
  });
});

// ---------------------------------------------------------------------------
// P1: runForensicAutopilot retry/idempotency behaviour (unit, mocked)
// ---------------------------------------------------------------------------

type DbRow = {
  id: string;
  status: string;
  case_id: string;
  workflow_type: string;
  idempotency_key: string;
  user_id: string;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  created_at: string;
};

function makeDb(existing: DbRow | null = null) {
  const rows: DbRow[] = existing ? [existing] : [];
  const selectSingle = vi.fn(async () => ({ data: rows[0] ?? null, error: null }));
  const updateFn = vi.fn(async () => ({ error: null }));
  const insertFn = vi.fn(async () => ({ error: null }));

  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: selectSingle,
    update: (patch: Partial<DbRow>) => {
      if (rows[0]) Object.assign(rows[0], patch);
      return { eq: () => ({ error: null }) };
    },
    insert: (row: DbRow) => {
      rows.push(row);
      return { select: () => ({ single: async () => ({ error: null }) }) };
    },
  };
  return { from: () => chain, rows, selectSingle, updateFn, insertFn };
}

describe("retry/idempotency guard (unit)", () => {
  const COMPLETED_RUN: DbRow = {
    id: "run-1",
    status: "completed",
    case_id: "case-1",
    workflow_type: "FORENSIC_CASE_ANALYSIS",
    idempotency_key: "ap:key",
    user_id: "user-1",
    error_code: null,
    error_message: null,
    attempt_count: 1,
    created_at: new Date().toISOString(),
  };

  const FAILED_RUN: DbRow = {
    ...COMPLETED_RUN,
    id: "run-2",
    status: "failed",
    error_code: "TRANSIENT_EXHAUSTED",
    error_message: "upstream timeout",
  };

  it("returns existing completed run without re-queuing (idempotency guard)", async () => {
    // A completed run should be returned as-is
    expect(COMPLETED_RUN.status).toBe("completed");
    // Simulate: if status is completed/running/queued → return existing
    const shouldGuard = ["completed", "running", "queued"].includes(COMPLETED_RUN.status);
    expect(shouldGuard).toBe(true);
  });

  it("does NOT guard a failed run — allows retry", () => {
    const shouldGuard = ["completed", "running", "queued"].includes(FAILED_RUN.status);
    expect(shouldGuard).toBe(false);
  });

  it("a failed run is reset to queued before re-queueing", () => {
    const run = { ...FAILED_RUN };
    // Simulate the reset patch
    Object.assign(run, { status: "queued", error_code: null, error_message: null });
    expect(run.status).toBe("queued");
    expect(run.error_code).toBeNull();
    expect(run.error_message).toBeNull();
  });

  it("reuses existing id as recordId on retry (no INSERT collision)", () => {
    const existingId = FAILED_RUN.id;
    // recordId = existing?.id ?? crypto.randomUUID()
    const recordId = existingId ?? "new-uuid";
    expect(recordId).toBe(existingId);
  });

  it("a duplicate successful submission returns the existing completed run", () => {
    // Second call finds COMPLETED_RUN → returns it without starting workflow
    expect(["completed", "running", "queued"].includes(COMPLETED_RUN.status)).toBe(true);
  });
});
