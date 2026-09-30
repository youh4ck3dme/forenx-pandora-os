import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateEvidencePresignedUrl } from "@/lib/forza/forenzx-evidence-presign.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/forenzx/presign-for-hub
 *
 * Server-to-server (M2M) endpoint called exclusively by the
 * forenzx-evidence-webhook Supabase Edge Function.
 *
 * Purpose: Edge Function (Deno) cannot use AWS SDK. It asks Pandora to
 * generate a presigned S3 GET URL for a given evidence S3 key so that
 * the ForenZX Hub can self-download the evidence file.
 *
 * Auth: Bearer token must equal FORENZX_WEBHOOK_SECRET env var.
 * Never expose this endpoint to browsers (middleware blocks it for non-API clients).
 */

const RequestSchema = z.object({
  s3_object_key: z.string().min(1).max(2048),
  bucket: z.string().min(1).max(256).optional(),
});

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  // Support both Bearer token and direct header value
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.slice(7) === secret) return true;

  // Also accept raw x-forenzx-webhook-secret header (Edge Function convenience)
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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { s3_object_key, bucket } = parsed.data;

  try {
    const presigned = await generateEvidencePresignedUrl(s3_object_key, bucket);
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
