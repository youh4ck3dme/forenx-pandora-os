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
      const values = {
        status: patch.status,
        workflow_run_id: patch.workflowRunId,
        attempt_count: patch.attemptCount,
        started_at: patch.startedAt,
        completed_at: patch.completedAt,
        error_code: patch.errorCode,
        error_message: patch.errorMessage,
        duration_ms: patch.durationMs,
      };
      const { error } = await (supabaseAdmin as any)
        .from("forensic_workflow_runs")
        .update(
          Object.fromEntries(
            Object.entries(values).filter(([, value]) => value !== undefined),
          ),
        )
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
  const { data: forensicCase, error } = await (supabaseAdmin as any)
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
