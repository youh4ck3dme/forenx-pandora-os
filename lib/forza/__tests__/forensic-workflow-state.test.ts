import { describe, expect, it } from "vitest";
import {
  canTransitionForensicWorkflow,
  isPermanentForensicWorkflowError,
  mapForensicWorkflowRun,
} from "../forensic-workflow-state";

describe("forensic workflow state", () => {
  it("maps the durable database projection without Workflow runtime access", () => {
    const run = mapForensicWorkflowRun({
      id: "run-1", case_id: "case-1", workflow_type: "FORENSIC_CASE_ANALYSIS",
      workflow_run_id: "wf-1", idempotency_key: "ap:case", status: "running",
      attempt_count: 2, created_at: "2026-09-29T10:00:00.000Z",
      started_at: "2026-09-29T10:01:00.000Z", completed_at: null, duration_ms: null,
    });
    expect(run).toMatchObject({ workflowRunId: "wf-1", attemptCount: 2, status: "running" });
  });

  it("allows only finite-run lifecycle transitions and identifies fatal inputs", () => {
    expect(canTransitionForensicWorkflow("queued", "running")).toBe(true);
    expect(canTransitionForensicWorkflow("completed", "running")).toBe(false);
    expect(isPermanentForensicWorkflowError("Dokument je príliš krátky")).toBe(true);
    expect(isPermanentForensicWorkflowError("upstream timeout")).toBe(false);
  });
});
