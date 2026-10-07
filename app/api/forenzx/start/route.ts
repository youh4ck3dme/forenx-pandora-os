import { NextRequest, NextResponse } from "next/server";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { startForenZXAnalysis } from "@/lib/forza/forenzx-mcp.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ForenzxStartRequestSchema } from "@/lib/forza/forenzx-start.schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * POST /api/forenzx/start
 *
 * Browser-facing endpoint to trigger a ForenZX forensic analysis job.
 * Called by <ForenzXAnalysisPanel /> after the user clicks "Spustiť analýzu".
 *
 * Security & Ledger invariants:
 *  - Client sends ONLY evidenceId, packId, and inputType.
 *  - caseId, s3ObjectKey, sha256, and fileSize are loaded exclusively from evidence_items.
 *  - Evidence must have hash_verification_status = 'verified'. Otherwise HTTP 403.
 *  - If no valid UUID caseId can be resolved from evidence ledger row, return HTTP 403.
 *  - Any client-supplied s3ObjectKey, sha256, or caseId is strictly ignored.
 *  - ForenZX tool call and S3 presigned URL use only ledger row values.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error ?? "Unauthorized" }, { status: auth.status ?? 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ForenzxStartRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { evidenceId, inputType, packId } = parsed.data;

  // ── IDOR protection & load trusted evidence row ────────────────────────────
  const { data: evidenceRow, error: lookupError } = await supabaseAdmin
    .from("evidence_items")
    .select("*")
    .eq("id", evidenceId)
    .eq("investigator_id", auth.userId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Overenie vlastníctva dôkazu zlyhalo." }, { status: 503 });
  }
  if (!evidenceRow) {
    return NextResponse.json({ error: "Dôkaz nebol nájdený alebo k nemu nemáte prístup." }, { status: 404 });
  }

  // Evidence must have hash_verification_status = verified. Otherwise HTTP 403.
  if (evidenceRow.hash_verification_status !== "verified") {
    return NextResponse.json(
      { error: "Dôkaz nie je overený (vyžaduje sa verified status)." },
      { status: 403 },
    );
  }

  const trustedS3Key = typeof evidenceRow.s3_object_key === "string" ? evidenceRow.s3_object_key : "";
  const trustedSha256 = typeof evidenceRow.sha256_hash === "string" ? evidenceRow.sha256_hash.toLowerCase() : "";
  const rawSize = evidenceRow.file_size;
  const trustedFileSize = typeof rawSize === "number" ? rawSize : Number(rawSize);

  if (!trustedS3Key || trustedS3Key.includes("..") || !/^[a-f0-9]{64}$/.test(trustedSha256) || Number.isNaN(trustedFileSize) || trustedFileSize < 0) {
    return NextResponse.json(
      { error: "Dôkaz obsahuje neplatné metadáta integrity." },
      { status: 403 },
    );
  }

  // Blueprint Invariant: case_id musí pochádzať výlučne z evidence_items.case_id
  const resolvedCaseId =
    typeof evidenceRow.case_id === "string" && UUID_REGEX.test(evidenceRow.case_id)
      ? evidenceRow.case_id
      : null;

  if (!resolvedCaseId) {
    return NextResponse.json(
      { error: "Dôkaz nie je priradený k platnému prípadu (chýba platné UUID caseId v ledgeri)." },
      { status: 403 },
    );
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  // Use verified SHA-256 digest from evidence row
  const idempotencyKey = `pandora:evidence:${evidenceId}:${trustedSha256}`;
  const { data: existing } = await supabaseAdmin
    .from("forenzx_analysis_jobs")
    .select("id, hub_job_id, status")
    .eq("evidence_id", evidenceId)
    .eq("pack_id", packId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing?.hub_job_id) {
    return NextResponse.json({ jobId: existing.hub_job_id, deduplicated: true });
  }

  // ── Persist job row (starting) ─────────────────────────────────────────────
  const { data: row, error: insertError } = await supabaseAdmin
    .from("forenzx_analysis_jobs")
    .upsert({
      case_id: resolvedCaseId,
      evidence_id: evidenceId,
      user_id: auth.userId,
      pack_id: packId,
      input_type: inputType,
      idempotency_key: idempotencyKey,
      status: "starting",
    }, { onConflict: "evidence_id,pack_id,idempotency_key" })
    .select("id")
    .single();

  if (insertError || !row) {
    return NextResponse.json(
      { error: `Uloženie úlohy zlyhalo: ${insertError?.message ?? "no row"}` },
      { status: 500 },
    );
  }

  // ── Call Hub via MCP (includes presigned URL generation) ──────────────────
  // s3Key and sha256 come exclusively from the ledger row, NEVER from request
  try {
    const result = await startForenZXAnalysis({
      caseId: resolvedCaseId,
      evidenceId,
      packId,
      inputType,
      s3Key: trustedS3Key,
      sha256: trustedSha256,
      idempotencyKey,
    });

    await supabaseAdmin
      .from("forenzx_analysis_jobs")
      .update({
        hub_job_id: result.job_id,
        status: result.status?.toLowerCase() === "queued" ? "queued" : "running",
      })
      .eq("id", row.id);

    // Provenance Audit Invariant: record verified evidence identity and analysis job
    await supabaseAdmin
      .from("case_audit_log")
      .insert({
        user_id: auth.userId,
        case_id: resolvedCaseId,
        action: "forenzx_analysis_started",
        table_name: "forenzx_analysis_jobs",
        record_id: row.id,
        correlation_id: result.job_id,
        changes: {
          job_id: result.job_id,
          evidence_id: evidenceId,
          s3_object_key: trustedS3Key,
          sha256_hash: trustedSha256,
          file_size: trustedFileSize,
          pack_id: packId,
          input_type: inputType,
          idempotency_key: idempotencyKey,
        },
      });

    return NextResponse.json({ jobId: result.job_id, deduplicated: result.deduplicated });
  } catch (error) {
    await supabaseAdmin
      .from("forenzx_analysis_jobs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message.slice(0, 2000) : "start failed",
      })
      .eq("id", row.id);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "ForenZX start failed." },
      { status: 502 },
    );
  }
}
