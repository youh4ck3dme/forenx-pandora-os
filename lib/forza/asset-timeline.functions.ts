import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAiConsent } from "@/lib/ai-consent";
import { parseAiJson } from "./ai/parse-json";
import { ForensicAssetReportSchema } from "./ai/asset-timeline-schema";
import {
  ASSET_TIMELINE_PROMPT_SHA256,
  ASSET_TIMELINE_PROMPT_VERSION,
  ASSET_TIMELINE_SYSTEM_PROMPT,
} from "./ai/asset-timeline-prompt";
import {
  bindAuthoritativeEvidenceMetadata,
  enforceDeterminism,
  validateReportSources,
} from "./ai/asset-timeline-engine";
import { canonicalJson, canonicalSha256 } from "./provenance/canonical";

const inputSchema = z
  .object({
    caseId: z.string().uuid(),
    evidenceIds: z.array(z.string().uuid()).min(1).max(10),
    consentVersion: z.string().min(1),
  })
  .strict();

const claimSchema = z
  .object({
    claimed: z.boolean(),
    workflowId: z.string().uuid(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    attemptCount: z.number().int().nonnegative(),
    startedAt: z.string().nullable(),
  })
  .strict();

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

export const runAssetTimelineForensics = createServerFn({
  method: "POST",
  id: "ai/runAssetTimelineForensics",
})
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    assertAiConsent(data.consentVersion);

    const supabase = context.supabase;
    const owned = await supabase
      .from("cases")
      .select("id")
      .eq("id", data.caseId)
      .maybeSingle();
    if (owned.error || !owned.data) {
      throw new Error("Prípad sa nenašiel alebo naň nemáte oprávnenie.");
    }

    const { loadLedgerDocuments, ledgerDocumentsText } = await import(
      "./evidence-source"
    );
    const { escapeLike } = await import("@/lib/storage/evidence-ledger");
    const { downloadCaseDocument } = await import("@/lib/storage/s3-vault");
    const { extractSingleBufferText } = await import("./ai/document-parser");

    const loaded = await loadLedgerDocuments(
      data.caseId,
      data.evidenceIds,
      {
        fetchRows: async (ids) => {
          const query = await supabase
            .from("evidence_items")
            .select(
              "id,file_name,file_size,sha256_hash,s3_object_key,hash_verification_status",
            )
            .in("id", ids)
            .like(
              "s3_object_key",
              `cases/${escapeLike(data.caseId)}/evidence/%`,
            );
          if (query.error) {
            throw new Error("Ledger dôkazov sa nepodarilo načítať.");
          }
          return query.data ?? [];
        },
        download: async (key) =>
          (await downloadCaseDocument(key))?.buffer ?? null,
        extract: async (name, buffer) =>
          (
            await extractSingleBufferText(name, buffer.toString("base64"))
          ).text,
      },
    );

    if (loaded.rejected.length || !loaded.documents.length) {
      throw new Error("Dôkazy neprešli overením.");
    }

    const sources = new Map(
      loaded.documents.map((document) => [document.evidenceId, document.text]),
    );
    const evidenceBindings = loaded.documents
      .map((document) => ({
        evidenceId: document.evidenceId,
        fileName: document.fileName,
        sha256: document.sha256,
        fileSize: document.fileSize,
      }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));

    const input = {
      analysisType: "ASSET_TIMELINE_FORENSICS" as const,
      caseId: data.caseId,
      evidenceBindings,
      promptVersion: ASSET_TIMELINE_PROMPT_VERSION,
      promptSha256: ASSET_TIMELINE_PROMPT_SHA256,
      text: ledgerDocumentsText(loaded.documents),
    };
    const inputSha256 = canonicalSha256(input);
    const canonicalKey = canonicalSha256({
      analysisType: input.analysisType,
      caseId: input.caseId,
      evidenceBindings,
      promptVersion: input.promptVersion,
      promptSha256: input.promptSha256,
    });

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const db = supabaseAdmin;

    const existing = await db
      .from("forensic_asset_timeline_runs")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("user_id", context.userId)
      .eq("idempotency_key", canonicalKey)
      .maybeSingle();
    if (existing.error) {
      throw new Error("Asset timeline result lookup failed.");
    }
    if (existing.data?.status === "COMPLETED") {
      return {
        success: true,
        report: existing.data.result,
        run: existing.data,
      };
    }

    const previous = await db
      .from("forensic_asset_timeline_runs")
      .select("id")
      .eq("case_id", data.caseId)
      .eq("user_id", context.userId)
      .eq("analysis_type", "ASSET_TIMELINE_FORENSICS")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previous.error) {
      throw new Error("Asset timeline lineage lookup failed.");
    }

    const {
      AI_JOB_DEADLINE_MS,
      callLlm,
      activeProvider,
      preferredLlmModel,
    } = await import("./ai/llm.server");
    const leaseSeconds = Math.ceil(AI_JOB_DEADLINE_MS / 1000) + 60;

    const claimResult = await db.rpc("claim_asset_timeline_workflow", {
      _case_id: data.caseId,
      _user_id: context.userId,
      _idempotency_key: canonicalKey,
      _lease_seconds: leaseSeconds,
    });
    if (claimResult.error) {
      throw new Error("Asset timeline execution claim failed.");
    }
    const claim = claimSchema.parse(claimResult.data);

    if (!claim.claimed) {
      if (claim.status === "completed") {
        const completed = await db
          .from("forensic_asset_timeline_runs")
          .select("*")
          .eq("case_id", data.caseId)
          .eq("user_id", context.userId)
          .eq("idempotency_key", canonicalKey)
          .maybeSingle();
        if (completed.error || !completed.data) {
          throw new Error(
            "Completed asset timeline workflow has no immutable result.",
          );
        }
        return {
          success: true,
          report: completed.data.result,
          run: completed.data,
        };
      }

      const active = await db
        .from("forensic_workflow_runs")
        .select("*")
        .eq("id", claim.workflowId)
        .eq("case_id", data.caseId)
        .eq("user_id", context.userId)
        .eq("workflow_type", "ASSET_TIMELINE_FORENSICS")
        .eq("idempotency_key", canonicalKey)
        .maybeSingle();
      if (active.error || !active.data) {
        throw new Error("Active asset timeline workflow lookup failed.");
      }
      return { success: true, report: null, run: active.data };
    }

    const metadataId = claim.workflowId;

    try {
      const provider = activeProvider("analysis");
      if (!provider) throw new Error("AI provider unavailable");

      const llm = await callLlm({
        purpose: "analysis",
        messages: [
          { role: "system", content: ASSET_TIMELINE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `${canonicalJson(input)}\nVráť iba JSON podľa schémy.`,
          },
        ],
      });
      if (llm.status !== "ok") throw new Error("AI provider failure");

      const parsed = parseAiJson(llm.content, ForensicAssetReportSchema);
      if (!parsed.ok) throw new Error("AI schema validation failed");

      const report = enforceDeterminism(
        bindAuthoritativeEvidenceMetadata(
          validateReportSources(parsed.data, sources),
          evidenceBindings,
        ),
        sources,
      );

      const resultSha256 = canonicalSha256(report);
      const actualProvider = llm.provider ?? provider;
      const actualModel = preferredLlmModel(actualProvider);

      const completed = await db.rpc("complete_asset_timeline_analysis", {
        _workflow_id: metadataId,
        _case_id: data.caseId,
        _user_id: context.userId,
        _idempotency_key: canonicalKey,
        _supersedes_run_id: previous.data?.id ?? null,
        _input_sha256: inputSha256,
        _prompt_version: ASSET_TIMELINE_PROMPT_VERSION,
        _prompt_sha256: ASSET_TIMELINE_PROMPT_SHA256,
        _provider: actualProvider,
        _model: actualModel,
        _evidence_bindings: toJson(evidenceBindings),
        _result: toJson(report),
        _result_sha256: resultSha256,
      });
      if (completed.error || !completed.data) {
        throw new Error("Atomic asset timeline completion failed.");
      }

      return { success: true, report, run: completed.data };
    } catch (error) {
      // A transport error can arrive after the completion transaction committed.
      // Re-read the immutable result before attempting a failure transition.
      const committed = await db
        .from("forensic_asset_timeline_runs")
        .select("*")
        .eq("case_id", data.caseId)
        .eq("user_id", context.userId)
        .eq("idempotency_key", canonicalKey)
        .maybeSingle();
      if (committed.error) {
        throw new Error("Asset timeline post-failure verification failed.");
      }
      if (committed.data?.status === "COMPLETED") {
        return {
          success: true,
          report: committed.data.result,
          run: committed.data,
        };
      }

      const failed = await db.rpc("fail_asset_timeline_workflow", {
        _workflow_id: metadataId,
        _case_id: data.caseId,
        _user_id: context.userId,
        _idempotency_key: canonicalKey,
        _error_code: "ASSET_TIMELINE_FAILED",
        _error_message: "Asset timeline analysis failed",
      });
      if (failed.error) {
        throw new Error("Asset timeline failure transition failed.");
      }

      if (failed.data === false) {
        const terminal = await db
          .from("forensic_asset_timeline_runs")
          .select("*")
          .eq("case_id", data.caseId)
          .eq("user_id", context.userId)
          .eq("idempotency_key", canonicalKey)
          .maybeSingle();
        if (terminal.error || !terminal.data) {
          throw new Error("Asset timeline terminal state is inconsistent.");
        }
        return {
          success: true,
          report: terminal.data.result,
          run: terminal.data,
        };
      }

      throw error;
    }
  });
