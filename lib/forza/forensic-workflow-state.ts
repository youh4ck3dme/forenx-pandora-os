import type {
  ForensicWorkflowRun,
  ForensicWorkflowStatus,
} from "./forensic-workflow.types";

export function isPermanentForensicWorkflowError(message: string): boolean {
  return /príliš krátky|nenašiel|nemáte oprávnenie|neplatný|súhlas|overený a dostupný/i.test(
    message,
  );
}

export function mapForensicWorkflowRun(row: Record<string, unknown>): ForensicWorkflowRun {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    workflowType: row.workflow_type as ForensicWorkflowRun["workflowType"],
    workflowRunId: (row.workflow_run_id as string | null) ?? null,
    idempotencyKey: String(row.idempotency_key),
    status: row.status as ForensicWorkflowStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    createdAt: String(row.created_at),
    startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    errorCode: (row.error_code as string | null) ?? null,
    errorMessage: (row.error_message as string | null) ?? null,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
  };
}

export function canTransitionForensicWorkflow(
  from: ForensicWorkflowStatus,
  to: ForensicWorkflowStatus,
): boolean {
  return (
    (from === "queued" && (to === "running" || to === "failed" || to === "cancelled")) ||
    (from === "running" && (to === "completed" || to === "failed" || to === "cancelled"))
  );
}
