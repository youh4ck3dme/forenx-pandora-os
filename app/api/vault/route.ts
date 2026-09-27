import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  uploadCaseDocument,
  getPresignedDossierUrl,
  isS3Configured,
} from "@/lib/storage/s3-vault";
import {
  CaseIdSchema,
  Sha256HashSchema,
  ForensicEvidenceItem,
  ForensicEvidenceItemSchema,
  EvidenceId,
  S3StorageKey,
} from "@/lib/forza/vault-types";

export const maxDuration = 300; // 300 s limit pre veľké súbory
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

const MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB limit

const QueryParamSchema = z.object({
  caseId: CaseIdSchema.optional(),
  storageKey: z.string().optional(),
  action: z.enum(["list", "presign"]).optional().default("list"),
});

// In-memory runtime registry of uploaded evidence items (synchronized with S3 and Supabase)
const inMemoryEvidenceStore = new Map<string, ForensicEvidenceItem[]>();

function rejectUnconfiguredProductionVault(): NextResponse | undefined {
  if (process.env.NODE_ENV === "production" && !isS3Configured()) {
    return NextResponse.json(
      { error: "Evidence Vault nie je nakonfigurovaný pre produkčné S3 úložisko." },
      { status: 503 },
    );
  }
}

/**
 * GET /api/vault?caseId=... alebo ?storageKey=...&action=presign
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const unavailable = rejectUnconfiguredProductionVault();
  if (unavailable) return unavailable;

  const { searchParams } = new URL(request.url);
  const rawCaseId = searchParams.get("caseId");
  const rawStorageKey = searchParams.get("storageKey");
  const rawAction = searchParams.get("action") || (rawStorageKey ? "presign" : "list");

  const validation = QueryParamSchema.safeParse({
    caseId: rawCaseId || undefined,
    storageKey: rawStorageKey || undefined,
    action: rawAction,
  });

  if (!validation.success) {
    return NextResponse.json(
      { error: "Neplatné query parametre.", details: validation.error.issues },
      { status: 400 }
    );
  }

  // 1. On-Demand Just-in-Time Presigned URL generation (rieši Flaw 4)
  if (validation.data.action === "presign" && validation.data.storageKey) {
    try {
      const presignedUrl = await getPresignedDossierUrl(validation.data.storageKey, 300); // 5 minútová platnosť
      return NextResponse.json({ url: presignedUrl, expiresIn: 300 });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Zlyhalo generovanie predpodpísanej URL.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // 2. Vrátenie zoznamu zaistených dôkazov pre prípad
  if (!validation.data.caseId) {
    return NextResponse.json(
      { error: "Pre zoznam dôkazov je parameter 'caseId' povinný." },
      { status: 400 }
    );
  }

  const caseId = validation.data.caseId;
  const items = inMemoryEvidenceStore.get(caseId) || [];

  return NextResponse.json({
    caseId,
    items,
  });
}

/**
 * POST /api/vault -> Prijme súbor, nezávisle overí SHA-256 hash, uloží do Hetzner S3 a vráti evidenciu
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const unavailable = rejectUnconfiguredProductionVault();
  if (unavailable) return unavailable;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Požiadavka musí obsahovať multipart/form-data alebo application/x-www-form-urlencoded telo." },
        { status: 400 },
      );
    }
    const file = formData.get("file");
    const rawCaseId = formData.get("caseId");
    const rawClientHash = formData.get("clientSha256");

    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return NextResponse.json({ error: "Súbor nebol priložený v poli 'file'." }, { status: 400 });
    }
    const fileName = (file instanceof File ? file.name : (file as { name?: string }).name) || "evidence.bin";

    const caseIdValidation = CaseIdSchema.safeParse(rawCaseId);
    if (!caseIdValidation.success) {
      return NextResponse.json(
        { error: "Neplatné CaseId.", details: caseIdValidation.error.issues },
        { status: 400 }
      );
    }
    const caseId = caseIdValidation.data;

    const clientHashValidation = Sha256HashSchema.safeParse(rawClientHash);
    if (!clientHashValidation.success) {
      return NextResponse.json(
        { error: "Neplatný formát klientskeho SHA-256 hashu.", details: clientHashValidation.error.issues },
        { status: 400 }
      );
    }
    const expectedClientHash = clientHashValidation.data;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Veľkosť súboru (${file.size} B) prekračuje maximálny limit 250 MB.` },
        { status: 413 }
      );
    }

    // ─── 1. NEZÁVISLÝ SERVEROVÝ VÝPOČET SHA-256 HASHU (Anti-Tampering) ─────────────
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const serverHash = createHash("sha256").update(fileBuffer).digest("hex").toLowerCase();

    // ─── 2. STRIKTNÉ OVERENIE INTEGRITY (CWE-345 Protection) ─────────
    if (serverHash !== expectedClientHash) {
      return NextResponse.json(
        {
          error: "KRITICKÉ ZLYHANIE INTEGRITY: Serverový SHA-256 hash sa nezhoduje s klientskym odtlačkom.",
          clientHash: expectedClientHash,
          serverHash,
        },
        { status: 400 }
      );
    }

    // ─── 3. STREAMOVANÝ UPLOAD DO HETZNER S3 VAULTU ─────────────────────
    const storageKeyRaw = await uploadCaseDocument(caseId, {
      name: fileName,
      buffer: fileBuffer,
      mimeType: file.type || "application/octet-stream",
      sha256: serverHash,
    });

    const evidenceId = randomUUID() as EvidenceId;
    const storageKey = storageKeyRaw as S3StorageKey;

    // ─── 4. ZOSTAVENIE A VALIDÁCIA ZÁZNAMU ────────────────────────
    const evidenceItemRaw: unknown = {
      id: evidenceId,
      caseId,
      fileName,
      fileSizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      sha256Hash: serverHash,
      s3StorageKey: storageKey,
      s3Bucket: process.env.S3_BUCKET || "forenx-vault-sk",
      uploadedAt: new Date().toISOString(),
      uploadedBy: "investigator-session-user",
      integrityStatus: "verified",
      aiAnalyzed: false,
      tags: [fileName.endsWith(".csv") ? "vypis" : fileName.endsWith(".pdf") ? "zmluva" : "ine"],
    };

    const parsedItem = ForensicEvidenceItemSchema.safeParse(evidenceItemRaw);
    if (!parsedItem.success) {
      return NextResponse.json(
        { error: "Interná chyba formátovania záznamu dôkazu.", details: parsedItem.error.issues },
        { status: 500 }
      );
    }

    // Uloženie do pamäťového registra pre okamžitú spätnú synchronizáciu
    const existing = inMemoryEvidenceStore.get(caseId) || [];
    inMemoryEvidenceStore.set(caseId, [parsedItem.data, ...existing]);

    return NextResponse.json({
      success: true,
      item: parsedItem.data,
      sha256: serverHash,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Neznáma chyba spracovania trezoru.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
