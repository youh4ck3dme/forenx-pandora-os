export const FORENSIC_WORKFLOW_TYPES = [
  "FORENSIC_CASE_ANALYSIS",
  "DOCUMENT_ANALYSIS",
  "BULK_IMPORT",
  "EVIDENCE_VALIDATION",
  "DOSSIER_GENERATION",
  "REPORT_EXPORT",
  "ASSET_TIMELINE_FORENSICS",
] as const;

export type ForensicWorkflowType = (typeof FORENSIC_WORKFLOW_TYPES)[number];
export type ForensicWorkflowStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type ForensicWorkflowRun = {
  id: string;
  caseId: string;
  workflowType: ForensicWorkflowType;
  workflowRunId: string | null;
  idempotencyKey: string;
  status: ForensicWorkflowStatus;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
};

export type ForensicCaseAnalysisInput = {
  recordId: string;
  caseId: string;
  userId: string;
  documentText: string;
  fileName?: string;
  documentIds?: string[];
  evidenceIds?: string[];
  consentVersion?: string;
  idempotencyKey: string;
  retryChunkIndexes?: number[];
  priorDossier?: import("./types").ForensicDossier;
};
