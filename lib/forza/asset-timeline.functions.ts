import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAiConsent } from "@/lib/ai-consent";
import { parseAiJson } from "./ai/parse-json";
import { ForensicAssetReportSchema } from "./ai/asset-timeline-schema";
import { ASSET_TIMELINE_PROMPT_SHA256, ASSET_TIMELINE_PROMPT_VERSION, ASSET_TIMELINE_SYSTEM_PROMPT } from "./ai/asset-timeline-prompt";
import { bindAuthoritativeEvidenceMetadata, enforceDeterminism, validateReportSources } from "./ai/asset-timeline-engine";
import { canonicalJson, canonicalSha256 } from "./provenance/canonical";
import { decideAssetTimelineMetadataAction, nextAssetTimelineAttempt } from "./asset-timeline-retry";

const inputSchema = z.object({ caseId: z.string().uuid(), evidenceIds: z.array(z.string().uuid()).min(1).max(10), consentVersion: z.string().min(1) }).strict();
export const runAssetTimelineForensics = createServerFn({ method: "POST", id: "ai/runAssetTimelineForensics" }).middleware([requireSupabaseAuth]).validator((d: unknown) => inputSchema.parse(d)).handler(async ({ data, context }) => {
  assertAiConsent(data.consentVersion);
  const supabase = context.supabase;
  const owned = await supabase.from("cases").select("id").eq("id", data.caseId).maybeSingle();
  if (owned.error || !owned.data) throw new Error("Prípad sa nenašiel alebo naň nemáte oprávnenie.");
  const { loadLedgerDocuments, ledgerDocumentsText } = await import("./evidence-source");
  const { escapeLike } = await import("@/lib/storage/evidence-ledger");
  const { downloadCaseDocument } = await import("@/lib/storage/s3-vault");
  const { extractSingleBufferText } = await import("./ai/document-parser");
  const loaded = await loadLedgerDocuments(data.caseId, data.evidenceIds, { fetchRows: async ids => { const q = await supabase.from("evidence_items").select("id,file_name,file_size,sha256_hash,s3_object_key,hash_verification_status").in("id", ids).like("s3_object_key", `cases/${escapeLike(data.caseId)}/evidence/%`); if (q.error) throw new Error("Ledger dôkazov sa nepodarilo načítať."); return q.data ?? []; }, download: async key => (await downloadCaseDocument(key))?.buffer ?? null, extract: async (name, buffer) => (await extractSingleBufferText(name, buffer.toString("base64"))).text });
  if (loaded.rejected.length || !loaded.documents.length) throw new Error("Dôkazy neprešli overením.");
  const sources = new Map(loaded.documents.map(d => [d.evidenceId, d.text]));
  const evidenceBindings = loaded.documents.map(d => ({ evidenceId: d.evidenceId, fileName: d.fileName, sha256: d.sha256, fileSize: d.fileSize })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  const input = { analysisType: "ASSET_TIMELINE_FORENSICS", caseId: data.caseId, evidenceBindings, promptVersion: ASSET_TIMELINE_PROMPT_VERSION, text: ledgerDocumentsText(loaded.documents) };
  const inputSha256 = canonicalSha256(input);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin;
  const canonicalKey = canonicalSha256({ analysisType: input.analysisType, caseId: input.caseId, evidenceBindings, promptVersion: input.promptVersion });
  const existing = await db.from("forensic_asset_timeline_runs").select("*").eq("case_id", data.caseId).eq("idempotency_key", canonicalKey).maybeSingle();
  if (existing.data?.status === "COMPLETED") return { success: true, report: existing.data.result, run: existing.data };
  const previous = await db.from("forensic_asset_timeline_runs").select("id").eq("case_id", data.caseId).eq("user_id", context.userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let metadataId: string | null = null;
  try {
    const metadataExisting = await db.from("forensic_workflow_runs").select("*").eq("case_id", data.caseId).eq("workflow_type", "ASSET_TIMELINE_FORENSICS").eq("idempotency_key", canonicalKey).maybeSingle();
    if (metadataExisting.error) throw new Error("Workflow metadata lookup failed");
    if (metadataExisting.data) {
      if (metadataExisting.data.user_id !== context.userId) throw new Error("Workflow metadata owner mismatch");
      const state = String(metadataExisting.data.status);
      const action = decideAssetTimelineMetadataAction(state);
      if (action === "reuse") {
        return { success: true, report: null, run: metadataExisting.data };
      }
      if (state === "completed") throw new Error("Workflow metadata is completed without an immutable result");
      if (action !== "reset") throw new Error("Workflow metadata is in an invalid state");
      const reset = await db.from("forensic_workflow_runs").update({ status: "queued", attempt_count: nextAssetTimelineAttempt(metadataExisting.data.attempt_count), error_code: null, error_message: null, started_at: null, completed_at: null }).eq("id", metadataExisting.data.id).select("*").single();
      if (reset.error || !reset.data) throw new Error("Workflow metadata reset failed");
      metadataId = reset.data.id;
    } else {
      const metadata = await db.from("forensic_workflow_runs").insert({ case_id: data.caseId, user_id: context.userId, workflow_type: "ASSET_TIMELINE_FORENSICS", idempotency_key: canonicalKey, status: "queued", attempt_count: 1 }).select("*").single();
      if (metadata.error || !metadata.data) {
        if (metadata.error?.code !== "23505") throw new Error("Workflow metadata failed");
        const raced = await db.from("forensic_workflow_runs").select("*").eq("case_id", data.caseId).eq("workflow_type", "ASSET_TIMELINE_FORENSICS").eq("idempotency_key", canonicalKey).maybeSingle();
        if (raced.error || !raced.data) throw new Error("Workflow metadata race could not be resolved");
        if (raced.data.user_id !== context.userId) throw new Error("Workflow metadata owner mismatch");
        const racedAction = decideAssetTimelineMetadataAction(String(raced.data.status));
        if (racedAction === "reuse") return { success: true, report: null, run: raced.data };
        if (racedAction !== "reset") throw new Error("Workflow metadata is in an invalid state");
        const reset = await db.from("forensic_workflow_runs").update({ status: "queued", attempt_count: nextAssetTimelineAttempt(raced.data.attempt_count), error_code: null, error_message: null, started_at: null, completed_at: null }).eq("id", raced.data.id).select("*").single();
        if (reset.error || !reset.data) throw new Error("Workflow metadata reset failed");
        metadataId = reset.data.id;
      } else {
        metadataId = metadata.data.id;
      }
    }
    const { callLlm, activeProvider, preferredLlmModel } = await import("./ai/llm.server");
    const provider = activeProvider("analysis");
    if (!provider) throw new Error("AI provider unavailable");
    const llm = await callLlm({ purpose: "analysis", messages: [{ role: "system", content: ASSET_TIMELINE_SYSTEM_PROMPT }, { role: "user", content: `${canonicalJson(input)}\nVráť iba JSON podľa schémy.` }] });
    if (llm.status !== "ok") throw new Error("AI provider failure");
    const parsed = parseAiJson(llm.content, ForensicAssetReportSchema);
    if (!parsed.ok) throw new Error("AI schema validation failed");
    const report = enforceDeterminism(bindAuthoritativeEvidenceMetadata(validateReportSources(parsed.data, sources), evidenceBindings), sources);
    if (report.legalAssessment.status === "SUPPORTED" && report.legalAssessment.sourceReferences.length === 0) report.legalAssessment.status = "UNVERIFIED";
    const resultSha256 = canonicalSha256(report);
    const inserted = await db.from("forensic_asset_timeline_runs").insert({ case_id: data.caseId, user_id: context.userId, workflow_metadata_id: metadataId, status: "COMPLETED", idempotency_key: canonicalKey, supersedes_run_id: previous.data?.id ?? null, input_sha256: inputSha256, prompt_version: ASSET_TIMELINE_PROMPT_VERSION, prompt_sha256: ASSET_TIMELINE_PROMPT_SHA256, provider: llm.provider ?? provider, model: preferredLlmModel(llm.provider ?? provider), evidence_bindings: evidenceBindings, result: report, result_sha256: resultSha256 }).select("*").single();
    if (inserted.error) throw new Error("Immutable result persistence failed");
    await db.from("forensic_workflow_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", metadataId);
    return { success: true, report, run: inserted.data };
  } catch (error) {
    if (metadataId) await db.from("forensic_workflow_runs").update({ status: "failed", error_code: "ASSET_TIMELINE_FAILED", error_message: "Asset timeline analysis failed", completed_at: new Date().toISOString() }).eq("id", metadataId);
    throw error;
  }
});
