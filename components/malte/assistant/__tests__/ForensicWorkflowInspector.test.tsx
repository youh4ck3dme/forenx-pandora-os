/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForensicWorkflowInspector } from "../ForensicWorkflowInspector";

const RUN_BASE = {
  id: "run-1",
  caseId: "case-1",
  workflowType: "FORENSIC_CASE_ANALYSIS",
  workflowRunId: "wf-1",
  idempotencyKey: "key",
  attemptCount: 1,
  createdAt: "2026-09-29T10:00:00.000Z",
  startedAt: "2026-09-29T10:00:01.000Z",
  completedAt: null,
  durationMs: null,
  errorCode: null,
  errorMessage: null,
} as const;

describe("ForensicWorkflowInspector", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(screen.getByText(/Zlyhalo · pokus 3/)).toBeTruthy();
  });

  it("zobrazuje slovenské stavy v live regióne", async () => {
    render(
      <ForensicWorkflowInspector
        caseId="case-1"
        loadRuns={vi.fn().mockResolvedValue({
          runs: [
            { ...RUN_BASE, id: "a", status: "queued" },
            { ...RUN_BASE, id: "b", status: "running" },
            { ...RUN_BASE, id: "c", status: "completed" },
          ],
        })}
      />,
    );
    expect(await screen.findByText(/Vo fronte · pokus 1/)).toBeTruthy();
    expect(screen.getByText(/Prebieha · pokus 1/)).toBeTruthy();
    expect(screen.getByText(/Dokončené · pokus 1/)).toBeTruthy();
    const live = screen.getByText(/Vo fronte/).closest("[aria-live]");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    expect(live?.getAttribute("role")).toBe("status");
  });

  it("does not issue overlapping refreshes while one is in flight", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: { runs: unknown[] }) => void = () => {};
    const loadRuns = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((res) => { resolveFirst = res; }),
      )
      .mockResolvedValue({ runs: [] });

    render(<ForensicWorkflowInspector caseId="case-1" loadRuns={loadRuns} />);

    expect(loadRuns).toHaveBeenCalledTimes(1);
    // Dva 4s tiky kým prvý request stále beží → overlap guard ich preskočí.
    await vi.advanceTimersByTimeAsync(8000);
    expect(loadRuns).toHaveBeenCalledTimes(1);

    // Po dokončení prvého (prázdny výsledok → stále čakáme) ďalší tik prejde.
    resolveFirst({ runs: [] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(loadRuns).toHaveBeenCalledTimes(2);
  });

  it("stops polling once all runs are terminal", async () => {
    vi.useFakeTimers();
    const loadRuns = vi
      .fn()
      .mockResolvedValue({ runs: [{ ...RUN_BASE, status: "completed" }] });

    render(<ForensicWorkflowInspector caseId="case-1" loadRuns={loadRuns} />);

    await vi.advanceTimersByTimeAsync(0);
    expect(loadRuns).toHaveBeenCalledTimes(1);
    // Beh je terminálny → polling sa zastaví, ďalšie tiky už nestrieľajú.
    await vi.advanceTimersByTimeAsync(12000);
    expect(loadRuns).toHaveBeenCalledTimes(1);
  });
});
