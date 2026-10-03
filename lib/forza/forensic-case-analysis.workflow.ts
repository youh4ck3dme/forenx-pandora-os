import { FatalError, getStepMetadata } from "workflow";
import type {
  ForensicCaseAnalysisInput,
  ForensicWorkflowStatus,
} from "./forensic-workflow.types";
import { isPermanentForensicWorkflowError } from "./forensic-workflow-state";

type RunStore = {
  update: (
    recordId: string,
    patch: {
      status?: ForensicWorkflowStatus;
      workflowRunId?: string;
      attemptCount?: number;
      startedAt?: string;
      completedAt?: string;
      errorCode?: string | null;
      errorMessage?: string | null;
      durationMs?: number | null;
    },
  ) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function getStore(): Promise<RunStore> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return {
    async update(recordId, patch) {
      type WorkflowRunUpdate = import("@/integrations/supabase/types").Database["public"]["Tables"]["forensic_workflow_runs"]["Update"];
      const values: WorkflowRunUpdate = {};
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.workflowRunId !== undefined) values.workflow_run_id = patch.workflowRunId;
      if (patch.attemptCount !== undefined) values.attempt_count = patch.attemptCount;
      if (patch.startedAt !== undefined) values.started_at = patch.startedAt;
      if (patch.completedAt !== undefined) values.completed_at = patch.completedAt;
      if (patch.errorCode !== undefined) values.error_code = patch.errorCode;
      if (patch.errorMessage !== undefined) values.error_message = patch.errorMessage;
      const { error } = await supabaseAdmin
        .from("forensic_workflow_runs")
        .update(values)
        .eq("id", recordId);
      if (error) throw new Error(`Workflow run persistence failed: ${error.message}`);
    },
  };
}

async function markRunning(input: ForensicCaseAnalysisInput) {
  "use step";
  const { attempt } = getStepMetadata();
  await (await getStore()).update(input.recordId, {
    status: "running",
    attemptCount: attempt + 1,
    startedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
  });
}
markRunning.maxRetries = 1;

async function performForensicAnalysis(input: ForensicCaseAnalysisInput) {
  "use step";
  const { attempt } = getStepMetadata();
  const store = await getStore();
  await store.update(input.recordId, { attemptCount: attempt + 1 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: forensicCase, error } = await supabaseAdmin
    .from("cases")
    .select("id")
    .eq("id", input.caseId)
    .eq("user_id", input.userId)
    .maybeSingle();
  if (error || !forensicCase) {
    throw new FatalError("Prípad sa nenašiel alebo k nemu nemáte oprávnenie.");
  }

  try {
    const { runForensicAutopilotInner } = await import("./ai.functions");
    const { withAiLog } = await import("@/lib/ai-log.server");
    return await withAiLog(
      {
        feature: "forensic_autopilot",
        userId: input.userId,
        inputSummary: `case=${input.caseId} file=${input.fileName ?? "-"} chars=${input.documentText.length} workflow=${input.recordId}`,
      },
      () => runForensicAutopilotInner(input, { supabase: supabaseAdmin, userId: input.userId }),
      (result) => ({
        success: result.success,
        outputSummary: `timeline=${result.dossier.facts?.timeline?.length ?? 0} save=${result.saveStatus}`,
      }),
    );
  } catch (error) {
    const message = errorMessage(error);
    if (isPermanentForensicWorkflowError(message)) throw new FatalError(message);
    throw error;
  }
}
performForensicAnalysis.maxRetries = 2;

async function markCompleted(input: ForensicCaseAnalysisInput) {
  "use step";
  const store = await getStore();
  const now = new Date();
  await store.update(input.recordId, {
    status: "completed",
    completedAt: now.toISOString(),
  });
}
markCompleted.maxRetries = 1;

async function markFailed(input: ForensicCaseAnalysisInput, message: string) {
  "use step";
  const store = await getStore();
  await store.update(input.recordId, {
    status: "failed",
    completedAt: new Date().toISOString(),
    errorCode: isPermanentForensicWorkflowError(message) ? "PERMANENT" : "TRANSIENT_EXHAUSTED",
    errorMessage: message.slice(0, 2000),
  });
}
markFailed.maxRetries = 1;

export async function forensicCaseAnalysisWorkflow(
  input: ForensicCaseAnalysisInput,
) {
  "use workflow";
  try {
    await markRunning(input);
    await performForensicAnalysis(input);
    await markCompleted(input);
    return { recordId: input.recordId, status: "completed" as const };
  } catch (error) {
    await markFailed(input, errorMessage(error));
    throw error;
  }
}
