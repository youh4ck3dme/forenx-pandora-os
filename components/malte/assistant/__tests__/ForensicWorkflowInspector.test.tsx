/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForensicWorkflowInspector } from "../ForensicWorkflowInspector";

describe("ForensicWorkflowInspector", () => {
  it("shows durable run status, attempts, duration, and failures", async () => {
    render(
      <ForensicWorkflowInspector
        caseId="case-1"
        loadRuns={vi.fn().mockResolvedValue({ runs: [{
          id: "run-1", caseId: "case-1", workflowType: "FORENSIC_CASE_ANALYSIS",
          workflowRunId: "wf-1", idempotencyKey: "key", status: "failed",
          attemptCount: 3, createdAt: "2026-09-29T10:00:00.000Z", startedAt: "2026-09-29T10:00:01.000Z",
          completedAt: "2026-09-29T10:00:05.000Z", durationMs: 5000,
          errorCode: "TRANSIENT_EXHAUSTED", errorMessage: "upstream timeout",
        }] })}
      />,
    );
    expect(await screen.findByText(/FORENSIC_CASE_ANALYSIS/)).toBeTruthy();
    expect(screen.getByText(/pokus 3/)).toBeTruthy();
    expect(screen.getByText("5 s")).toBeTruthy();
    expect(screen.getByText("upstream timeout")).toBeTruthy();
  });
});
