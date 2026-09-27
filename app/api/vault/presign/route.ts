import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { getPresignedUploadUrl } from "@/lib/storage/s3-vault";

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
 * Získa používateľské ID z autorizačnej hlavičky alebo session.
 */
async function authenticateRequest(
  request: NextRequest,
): Promise<{ userId: string | null; error?: string; status?: number }> {
  const isDev = process.env.NODE_ENV !== "production";
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY;

    if (supabaseUrl && supabaseAnonKey && token.split(".").length === 3) {
      try {
        const supabase = createClient(supabaseUrl, supabaseAnonKey);
        const { data, error } = await supabase.auth.getUser(token);
        if (data?.user) {
          return { userId: data.user.id };
        }
        if (error && !isDev) {
          return {
            userId: null,
            error: `Neplatný auth token: ${error.message}`,
            status: 401,
          };
        }
      } catch {
        // Fallback v dev režime
      }
    }
  }

  // Lokálny vývojársky / testovací bypass
  if (isDev) {
    const devUserId =
      request.headers.get("x-dev-user-id") ||
      request.headers.get("x-user-id") ||
      "dev-investigator-001";
    return { userId: devUserId };
  }

  return {
    userId: null,
    error:
      "Neautorizovaný prístup: Chýba platná autorizačná relácia vyšetrovateľa.",
    status: 401,
  };
}

/**
 * POST /api/vault/presign
 * Generuje autorizovanú S3 Presigned PUT URL pre priamy upload veľkých súborov (až do 250 MB).
 * Obchádza 4.5 MB limit Vercel Serverless runtime.
 * Chráni pred IDOR zraniteľnosťou overením vlastníctva spisu v databáze.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Autentifikácia vyšetrovateľa
    const auth = await authenticateRequest(request);
    if (!auth.userId) {
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
          console.error(
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
        console.error("[Vault Presign] DB verification failed:", dbError);
        return NextResponse.json(
          { error: "Overenie oprávnenia k spisu zlyhalo; nahratie nebolo povolené." },
          { status: 503 },
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
