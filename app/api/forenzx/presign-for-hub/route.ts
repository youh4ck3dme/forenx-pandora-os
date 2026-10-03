import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateEvidencePresignedUrl } from "@/lib/forza/forenzx-evidence-presign.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isValidDownloadUrl } from "@/lib/forza/forenzx-download-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/forenzx/presign-for-hub
 *
 * Server-to-server (M2M) endpoint called exclusively by the
 * forenzx-evidence-webhook Supabase Edge Function.
 *
 * Purpose: Edge Function (Deno) cannot use AWS SDK directly. It asks Pandora to
 * generate a presigned S3 GET URL for an evidence file in the ledger so that
 * the ForenZX Hub can self-download the evidence file.
 *
 * Invariants:
 *  - Auth: Bearer token or x-forenzx-webhook-secret must equal FORENZX_WEBHOOK_SECRET.
 *  - ForenZX webhook/presign must NEVER accept caller-supplied downloadUrl.
 *  - Caller-supplied bucket is rejected. The bucket comes from FORENZX_S3_BUCKET.
 *  - URL is composed on the server strictly from the verified ledger row.
 *  - Foreign or unallowlisted download URLs are rejected (Cudzia URL = odmietnuť).
 */

const RequestSchema = z.object({
  s3_object_key: z.string().min(1).max(2048),
});

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === secret) return true;

  if (request.headers.get("x-forenzx-webhook-secret") === secret) return true;

  return false;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Invariant: Webhook/presign endpoint must never accept downloadUrl from caller
  if (body && typeof body === "object" && ("downloadUrl" in body || "download_url" in body)) {
    return NextResponse.json(
      { error: "Caller-supplied downloadUrl is prohibited; download URL must be generated from ledger" },
      { status: 400 }
    );
  }

  // Bucket is server configuration (FORENZX_S3_BUCKET) or ledger metadata, never a caller override.
  if (body && typeof body === "object" && "bucket" in body) {
    return NextResponse.json(
      { error: "Caller-supplied bucket is prohibited; bucket must come from server configuration" },
      { status: 400 }
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { s3_object_key } = parsed.data;

  if (s3_object_key.includes("..")) {
    return NextResponse.json({ error: "Invalid s3_object_key path traversal." }, { status: 400 });
  }

  // ── Ledger validation: S3 key must exist in evidence_items and have verified status ──
  const { data: evidenceRow, error: lookupError } = await supabaseAdmin
    .from("evidence_items")
    .select("id, s3_object_key, hash_verification_status")
    .eq("s3_object_key", s3_object_key)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: "Chyba overenia v ledgeri." }, { status: 503 });
  }
  if (!evidenceRow) {
    return NextResponse.json({ error: "S3 kľúč nebol nájdený v ledgeri dôkazov." }, { status: 404 });
  }
  if (evidenceRow.hash_verification_status !== "verified") {
    return NextResponse.json(
      { error: "Dôkaz v ledgeri nie je overený (vyžaduje sa verified status)." },
      { status: 403 }
    );
  }

  try {
    const presigned = await generateEvidencePresignedUrl(s3_object_key);

    // Validate generated download URL (Cudzia URL = odmietnuť)
    const validation = isValidDownloadUrl(presigned.url);
    if (!validation.ok) {
      return NextResponse.json(
        { error: `Vygenerovaná download URL neprešla bezpečnostnou kontrolou: ${validation.reason}` },
        { status: 403 }
      );
    }

    return NextResponse.json({
      download_url: presigned.url,
      expires_at: presigned.expiresAt,
      filename: presigned.filename,
      s3_key: presigned.s3Key,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Presign generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
