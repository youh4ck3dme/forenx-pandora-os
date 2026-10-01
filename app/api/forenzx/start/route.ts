import { NextRequest, NextResponse } from "next/server";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { startForenZXAnalysis } from "@/lib/forza/forenzx-mcp.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeForenzxStart, ForenzxStartRequestSchema } from "@/lib/forza/forenzx-authorization.server";

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

  const { caseId, evidenceId, inputType, packId } = parsed.data;

  // ── IDOR protection: verify evidence ownership ─────────────────────────────
  let trusted;
  try { trusted = await authorizeForenzxStart(supabaseAdmin, auth.userId, parsed.data); }
  catch { return NextResponse.json({ error: "Dôkaz nebol nájdený, nie je overený alebo k nemu nemáte prístup." }, { status: 404 }); }

  // ── Idempotency check ──────────────────────────────────────────────────────
  const idempotencyKey = `pandora:evidence:${evidenceId}:${trusted.sha256}`;
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
      { error: "Uloženie úlohy zlyhalo." },
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
      s3Key: trusted.s3Key,
      sha256: trusted.sha256,
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
        error_message: "ForenZX analýzu sa nepodarilo spustiť.",
      })
      .eq("id", row.id);

    return NextResponse.json(
      { error: "ForenZX analýzu sa nepodarilo spustiť." },
      { status: 502 },
    );
  }
}
