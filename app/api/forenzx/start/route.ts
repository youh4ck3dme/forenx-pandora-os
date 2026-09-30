import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { startForenZXAnalysis } from "@/lib/forza/forenzx-mcp.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/forenzx/start
 *
 * Browser-facing endpoint to trigger a ForenZX forensic analysis job.
 * Called by <ForenzXAnalysisPanel /> after the user clicks "Spustiť analýzu".
 *
 * Flow:
 *  1. Authenticate user (Supabase session)
 *  2. Validate evidence ownership (IDOR protection)
 *  3. Generate presigned S3 GET URL (via startForenZXAnalysis → buildForenzxStartPayload)
 *  4. Call forenzx_analysis_start on the Hub (MCP tools/call)
 *  5. Persist job row in forenzx_analysis_jobs
 *  6. Return { jobId } to browser for SSE subscription
 */

const RequestSchema = z.object({
  caseId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  s3ObjectKey: z.string().min(1).max(2048),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, "sha256 must be 64 hex chars"),
  inputType: z.string().min(1).max(64),
  packId: z.string().min(1).max(128).default("mobile_compromise"),
});

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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { caseId, evidenceId, s3ObjectKey, sha256, inputType, packId } = parsed.data;

  // ── IDOR protection: verify evidence ownership ─────────────────────────────
  const { data: evidenceRow, error: lookupError } = await (supabaseAdmin as any)
    .from("evidence_items")
    .select("id, investigator_id, hash_verification_status")
    .eq("id", evidenceId)
    .eq("investigator_id", auth.userId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Overenie vlastníctva dôkazu zlyhalo." }, { status: 503 });
  }
  if (!evidenceRow) {
    return NextResponse.json({ error: "Dôkaz nebol nájdený alebo nemáte k nemu prístup." }, { status: 404 });
  }
  if (evidenceRow.hash_verification_status !== "verified") {
    return NextResponse.json(
      { error: "Analýzu možno spustiť iba na overených dôkazoch (hash_verification_status = verified)." },
      { status: 422 },
    );
  }

  // ── Idempotency check ──────────────────────────────────────────────────────
  const idempotencyKey = `pandora:evidence:${evidenceId}:${sha256.toLowerCase()}`;
  const { data: existing } = await (supabaseAdmin as any)
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
  const { data: row, error: insertError } = await (supabaseAdmin as any)
    .from("forenzx_analysis_jobs")
    .upsert({
      case_id: caseId,
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
  try {
    const result = await startForenZXAnalysis({
      caseId,
      evidenceId,
      packId,
      inputType,
      s3Key: s3ObjectKey,
      sha256: sha256.toLowerCase(),
      idempotencyKey,
    });

    await (supabaseAdmin as any)
      .from("forenzx_analysis_jobs")
      .update({
        hub_job_id: result.job_id,
        status: result.status?.toLowerCase() === "queued" ? "queued" : "running",
      })
      .eq("id", row.id);

    return NextResponse.json({ jobId: result.job_id, deduplicated: result.deduplicated });
  } catch (error) {
    await (supabaseAdmin as any)
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
