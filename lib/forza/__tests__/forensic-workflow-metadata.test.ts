// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  adminClient: null as { from: (table: string) => Record<string, unknown> } | null,
  adminUpdates: [] as Array<Record<string, unknown>>,
  adminInserts: [] as Array<Record<string, unknown>>,
  adminFilters: [] as Array<[string, unknown]>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    if (!state.adminClient) throw new Error("admin test client not initialized");
    return state.adminClient;
  },
}));
vi.mock("../workflow-storage.server", () => ({
  ensureWorkflowStorageDir: vi.fn(async () => "test-workflow-data"),
}));
vi.mock("../forensic-case-analysis.workflow", () => ({
  forensicCaseAnalysisWorkflow: {},
}));
vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({ runId: "run-1" })),
}));

function queryChain<T>(terminal: T, onEq?: (field: string, value: unknown) => void) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((field: string, value: unknown) => {
    onEq?.(field, value);
    return query;
  });
  query.maybeSingle = vi.fn(async () => terminal);
  query.single = vi.fn(async () => terminal);
  return query;
}

describe("forensic workflow metadata ownership boundary", () => {
  const caseId = "00000000-0000-4000-8000-000000000001";
  const userId = "00000000-0000-4000-8000-000000000002";

  beforeEach(() => {
    state.adminUpdates = [];
    state.adminInserts = [];
    state.adminFilters = [];
    let row: Record<string, unknown> = {
      id: "record-1",
      case_id: caseId,
      user_id: userId,
      workflow_type: "FORENSIC_CASE_ANALYSIS",
      idempotency_key: "test-key",
      status: "queued",
      workflow_run_id: null,
      attempt_count: 0,
      created_at: "2026-10-10T00:00:00.000Z",
      started_at: null,
      completed_at: null,
      error_code: null,
      error_message: null,
      duration_ms: null,
    };

    state.adminClient = {
      from(table: string) {
        if (table !== "forensic_workflow_runs") throw new Error(`unexpected admin table ${table}`);
        return {
          select: vi.fn(() =>
            queryChain({ data: null, error: null }, (field, value) => {
              state.adminFilters.push([field, value]);
            }),
          ),
          insert: vi.fn((values: Record<string, unknown>) => {
            state.adminInserts.push(values);
            row = { ...row, ...values };
            return {
              select: vi.fn(() => queryChain({ data: row, error: null })),
            };
          }),
          update: vi.fn((values: Record<string, unknown>) => {
            state.adminUpdates.push(values);
            row = { ...row, ...values };
            return queryChain({ data: row, error: null }, (field, value) => {
              state.adminFilters.push([field, value]);
            });
          }),
        };
      },
    };
  });

  it("keeps the authenticated client read-only while server admin persists workflow metadata", async () => {
    const userMetadataCalls: string[] = [];
    const userClient = {
      from(table: string) {
        if (table === "cases") return queryChain({ data: { id: caseId }, error: null });
        userMetadataCalls.push(table);
        throw new Error("authenticated workflow metadata mutation is forbidden");
      },
    };

    const { startForensicCaseAnalysisRun } = await import("../ai.functions");
    const result = await startForensicCaseAnalysisRun(
      { caseId, documentText: "safe test text", idempotencyKey: "test-key" },
      { supabase: userClient, userId },
    );

    expect(result.success).toBe(true);
    expect(result.workflowRun.workflowRunId).toBe("run-1");
    expect(userMetadataCalls).toEqual([]);
    expect(state.adminInserts).toHaveLength(1);
    expect(state.adminInserts[0]).toMatchObject({
      case_id: caseId,
      user_id: userId,
      workflow_type: "FORENSIC_CASE_ANALYSIS",
      idempotency_key: "test-key",
      status: "queued",
    });
    expect(state.adminUpdates).toContainEqual({ workflow_run_id: "run-1" });
    expect(state.adminFilters).toEqual(
      expect.arrayContaining([
        ["case_id", caseId],
        ["user_id", userId],
        ["workflow_type", "FORENSIC_CASE_ANALYSIS"],
        ["idempotency_key", "test-key"],
      ]),
    );
    expect(state.adminFilters.some(([field, value]) => field === "id" && typeof value === "string")).toBe(true);
  });

  it("accepts the current consent version and rejects missing or stale consent", async () => {
    const { AI_CONSENT_VERSION, assertAiConsent } = await import("../ai-consent");
    expect(() => assertAiConsent(AI_CONSENT_VERSION)).not.toThrow();
    expect(() => assertAiConsent()).toThrow();
    expect(() => assertAiConsent("stale-version")).toThrow();
  });
});
