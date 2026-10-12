import type { ForensicWorkflowStatus } from "@/lib/forza/forensic-workflow.types";

/** Slovenské popisy stavov serverového workflow (hodnoty kontraktu sa nemenia). */
export const WORKFLOW_STATUS_LABELS: Record<ForensicWorkflowStatus, string> = {
  queued: "Vo fronte",
  running: "Prebieha",
  completed: "Dokončené",
  failed: "Zlyhalo",
  cancelled: "Zrušené",
};

export function workflowStatusLabel(status: string): string {
  return (WORKFLOW_STATUS_LABELS as Record<string, string>)[status] ?? "Neznámy stav";
}
