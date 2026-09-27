import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPresignedUploadUrl } from "@/lib/storage/s3-vault";
import { tracedError, withTraceRoute } from "@/lib/forza/trace";
import {
  accessContext,
  authenticateVaultRequest,
  logVaultAccess,
} from "@/lib/storage/vault-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

// ─── 1. VALIDÁCIA VSTUPNÉHO PAYLOADU (ZOD) ──────────────────────────
const PresignRequestSchema = z.object({
  caseId: z.string().min(1, "Parameter 'caseId' je povinný."),
  fileName: z.string().min(1, "Názov súboru nesmie byť prázdny."),
  fileSizeBytes: z
    .number()
    .int("Veľkosť súboru musí byť celé číslo.")
    .positive("Veľkosť súboru musí byť kladné číslo.")
    .max(250 * 1024 * 1024, "Maximálna povolená veľkosť dôkazu je 250 MB."),
  mimeType: z.string().min(1).default("application/octet-stream"),
  sha256Hash: z
    .string()
    .regex(
      /^[a-f0-9]{64}$/i,
      "Neplatný formát SHA-256 hashu (očakáva sa 64 hex znakov).",
    ),
});

const PresignResponseSchema = z.object({
  success: z.literal(true),
  uploadUrl: z.string().url(),
  storageKey: z.string().min(1),
  bucket: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  expiresInSeconds: z.literal(300),
  requiredHeaders: z.object({
    "Content-Type": z.string().min(1),
    "x-amz-content-sha256": z.string().regex(/^[a-f0-9]{64}$/),
    "x-amz-meta-sha256-checksum": z.string().regex(/^[a-f0-9]{64}$/),
    "x-amz-meta-uploaded-by": z.string().min(1),
    "x-amz-meta-case-id": z.string().min(1),
  }).strict(),
}).strict();

/**
 * POST /api/vault/presign
 * Generuje autorizovanú S3 Presigned PUT URL pre priamy upload veľkých súborov (až do 250 MB).
 * Obchádza 4.5 MB limit Vercel Serverless runtime.
 * Chráni pred IDOR zraniteľnosťou overením vlastníctva spisu v databáze.
 */
async function handlePost(request: NextRequest, traceId: string): Promise<NextResponse> {
  try {
    // 1. Autentifikácia vyšetrovateľa (P1-04: zdieľaná fail-closed vrstva)
    const auth = await authenticateVaultRequest(request);
    if (auth.userId === null) {
      return NextResponse.json(
        { error: auth.error || "Neautorizovaný prístup." },
        { status: auth.status || 401 },
      );
    }
    const currentUserId = auth.userId;

    // 2. Validácia tela požiadavky
    const rawBody: unknown = await request.json().catch(() => null);
    const validation = PresignRequestSchema.safeParse(rawBody);

    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Neplatné parametre pre generovanie presigned URL.",
          details: validation.error.issues,
        },
        { status: 400 },
      );
    }

    const { caseId, fileName, fileSizeBytes, mimeType, sha256Hash } =
      validation.data;

    // 3. RLS Kontrola vlastníctva spisu (Ochrana pred IDOR - Flaw 3)
    const isDev = process.env.NODE_ENV !== "production";
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && serviceRoleKey && !isDev) {
      try {
        const { supabaseAdmin } =
          await import("@/integrations/supabase/client.server");
        const { data: caseRecord, error: caseError } = await supabaseAdmin
          .from("cases")
          .select("id, user_id")
          .eq("id", caseId)
          .maybeSingle();

        if (caseError) {
          tracedError(
            traceId,
            `[Vault Presign] Chyba pri overovaní prípadu ${caseId}:`,
            caseError,
          );
          return NextResponse.json(
            {
              error: "Overenie oprávnenia k spisu zlyhalo; nahratie nebolo povolené.",
            },
            { status: 503 },
          );
        }
        if (!caseRecord || caseRecord.user_id !== currentUserId) {
          return NextResponse.json(
            {
              error: "Prístup zamietnutý: Nemáte oprávnenie nahrávať dôkazy do tohto spisu.",
            },
            { status: 403 },
          );
        }
      } catch (dbError: unknown) {
        tracedError(traceId, "[Vault Presign] DB verification failed:", dbError);
        return NextResponse.json(
          { error: "Overenie oprávnenia k spisu zlyhalo; nahratie nebolo povolené." },
          { status: 503 },
        );
      }
    }

    // 3b. P1-04: serverový audit uploadu do auditného ledgeri (fail-closed).
    if (process.env.NODE_ENV === "production" && auth.token) {
      const audited = await logVaultAccess({
        token: auth.token,
        caseId,
        action: "upload",
        ...accessContext(request),
      });
      if (!audited) {
        return NextResponse.json(
          { error: "Záznam prístupu k spisu sa nepodarilo zapísať." },
          { status: 500 },
        );
      }
    }

    // 4. Vygenerovanie deterministického S3 kľúča
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const cleanHash = sha256Hash.toLowerCase();
    const storageKey = `cases/${caseId}/evidence/${cleanHash}-${sanitizedFileName}`;
    const bucket = process.env.S3_BUCKET || "forenx-vault-sk";

    // 5. Vygenerovanie AWS SigV4 Presigned PUT URL (300 s platnosť)
    const uploadUrl = await getPresignedUploadUrl(storageKey, {
      mimeType,
      sha256: cleanHash,
      expiresIn: 300,
      metadata: {
        "sha256-checksum": cleanHash,
        "uploaded-by": currentUserId,
        "case-id": caseId,
      },
    });

    const response = PresignResponseSchema.parse({
      success: true,
      uploadUrl,
      storageKey,
      bucket,
      fileSizeBytes,
      expiresInSeconds: 300,
      requiredHeaders: {
        "Content-Type": mimeType,
        "x-amz-content-sha256": cleanHash,
        "x-amz-meta-sha256-checksum": cleanHash,
        "x-amz-meta-uploaded-by": currentUserId,
        "x-amz-meta-case-id": caseId,
      },
    });
    return NextResponse.json(response);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Neznáma chyba pri generovaní presigned URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// P0-04: korelačné trace id (x-trace-id, UUIDv4) v hlavičke odpovede.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handlePost(request, traceId));
}
