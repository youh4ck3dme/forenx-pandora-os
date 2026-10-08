import { z } from "zod";
import type { ForensicEvidenceItem } from "@/lib/forza/vault-types";

/**
 * Registrácia dôkazu v Supabase ledgeri (`evidence_items`) po úspešnom priamom
 * uploade do S3.
 *
 * - S3 kľúč sa neprijíma od klienta naslepo: musí byť presne ten, ktorý pre
 *   (caseId, sha256, fileName) vydal presign endpoint — klient tak nezaregistruje
 *   cudzí objekt ani iný prípad.
 * - Zápis beží s právami používateľa (RLS + insert/WORM triggery): záznam je vždy
 *   `pending`, bez legal hold, s auditnou udalosťou `evidence_registered`.
 * - Opakovaný commit toho istého objektu vráti existujúci záznam (idempotentné).
 * - Stav `verified` nastaví až serverový worker `/api/vault/verify`.
 */

export const MAX_EVIDENCE_BYTES = 250 * 1024 * 1024;

export function sanitizeEvidenceFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Deterministický S3 kľúč dôkazu (rovnaký výpočet používa presign endpoint). */
export function evidenceStorageKey(caseId: string, sha256: string, fileName: string): string {
  return `cases/${caseId}/evidence/${sha256.toLowerCase()}-${sanitizeEvidenceFileName(fileName)}`;
}

export const CommitEvidenceSchema = z
  .object({
    caseId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
    storageKey: z.string().min(1).max(1024),
    fileName: z.string().min(1).max(255),
    fileSizeBytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
    mimeType: z.string().min(1).max(255),
    sha256Hash: z.string().regex(/^[a-f0-9]{64}$/i),
  })
  .strict();

export type CommitEvidenceInput = z.infer<typeof CommitEvidenceSchema>;

export type LedgerStatus = "pending" | "verified" | "mismatch" | "object_missing" | "error";

export type LedgerRow = {
  id: string;
  case_id: string | null;
  case_name: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  s3_object_key: string;
  sha256_hash: string;
  hash_verification_status: LedgerStatus;
  created_at: string;
};

export type LedgerDeps = {
  /** Vlastníctvo prípadu (service rola, IDOR ochrana) + názov prípadu. */
  caseOf: (caseId: string) => Promise<
    { ok: true; userId: string; name: string } | { ok: false; reason: "not_found" | "unavailable" }
  >;
  /** Existujúci záznam tohto používateľa pre daný S3 kľúč (idempotencia). */
  findByKey: (storageKey: string) => Promise<LedgerRow | null>;
  /** Insert s právami používateľa (RLS + triggery). */
  insert: (row: {
    investigator_id: string;
    case_id?: string | null;
    case_name: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    s3_object_key: string;
    sha256_hash: string;
  }) => Promise<LedgerRow>;
};

export type CommitResult =
  | { ok: true; created: boolean; row: LedgerRow }
  | { ok: false; status: 400 | 403 | 404 | 503; error: string };

export async function registerEvidence(
  input: CommitEvidenceInput,
  userId: string,
  deps: LedgerDeps,
): Promise<CommitResult> {
  const sha = input.sha256Hash.toLowerCase();
  const expectedKey = evidenceStorageKey(input.caseId, sha, input.fileName);
  if (input.storageKey !== expectedKey) {
    return { ok: false, status: 400, error: "S3 kľúč nezodpovedá prípadu, hashu a názvu súboru." };
  }

  const owner = await deps.caseOf(input.caseId);
  if (!owner.ok) {
    return owner.reason === "not_found"
      ? { ok: false, status: 404, error: "Prípad neexistuje." }
      : { ok: false, status: 503, error: "Overenie oprávnenia k spisu zlyhalo." };
  }
  if (owner.userId !== userId) {
    return { ok: false, status: 403, error: "Nemáte oprávnenie zapisovať dôkazy do tohto spisu." };
  }

  const existing = await deps.findByKey(expectedKey);
  if (existing) return { ok: true, created: false, row: existing };

  let row;
  try {
    row = await deps.insert({
      investigator_id: userId,
      case_id: input.caseId,
      case_name: owner.name,
      file_name: input.fileName,
      file_size: input.fileSizeBytes,
      mime_type: input.mimeType,
      s3_object_key: expectedKey,
      sha256_hash: sha,
    });
  } catch (error) {
    // P0-03: konkurenčný commit toho istého objektu (unique index na
    // s3_object_key) — druhý zápis je idempotentný, vráti existujúci riadok.
    const raced = await deps.findByKey(expectedKey);
    if (raced) return { ok: true, created: false, row: raced };
    throw error;
  }
  return { ok: true, created: true, row };
}

/** Stav serverového overenia → stav zobrazovaný v UI. Overený je len `verified`. */
export function integrityStatusOf(status: string): ForensicEvidenceItem["integrityStatus"] {
  if (status === "verified") return "verified";
  if (status === "mismatch" || status === "object_missing") return "compromised";
  return "checking";
}

export function ledgerRowToItem(
  row: LedgerRow,
  caseId: string,
  bucket: string,
  uploadedBy: string,
): ForensicEvidenceItem {
  const name = row.file_name.toLowerCase();
  return {
    id: row.id as ForensicEvidenceItem["id"],
    caseId: (row.case_id || caseId) as ForensicEvidenceItem["caseId"],
    fileName: row.file_name,
    fileSizeBytes: row.file_size,
    mimeType: row.mime_type,
    sha256Hash: row.sha256_hash as ForensicEvidenceItem["sha256Hash"],
    s3StorageKey: row.s3_object_key as ForensicEvidenceItem["s3StorageKey"],
    s3Bucket: bucket,
    uploadedAt: new Date(row.created_at).toISOString(),
    uploadedBy,
    integrityStatus: integrityStatusOf(row.hash_verification_status),
    aiAnalyzed: false,
    tags: [name.endsWith(".csv") ? "vypis" : name.endsWith(".pdf") ? "zmluva" : "ine"],
  };
}

const LEDGER_COLUMNS =
  "id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash, hash_verification_status, created_at";

async function userClient(token: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) throw new Error("supabase_not_configured");
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function ledgerConfigured(): boolean {
  return Boolean(
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) &&
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** Produkčné závislosti: ownership cez service rolu, zápis/čítanie s tokenom používateľa. */
export async function supabaseLedgerDeps(token: string): Promise<LedgerDeps> {
  const client = await userClient(token);
  return {
    caseOf: async (caseId) => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("cases")
          .select("id, user_id, name")
          .eq("id", caseId)
          .maybeSingle();
        if (error) return { ok: false, reason: "unavailable" };
        if (!data) return { ok: false, reason: "not_found" };
        return { ok: true, userId: data.user_id, name: data.name };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    findByKey: async (storageKey) => {
      const { data, error } = await client
        .from("evidence_items")
        .select(LEDGER_COLUMNS)
        .eq("s3_object_key", storageKey)
        .limit(1);
      if (error) throw new Error(`ledger_read_failed:${error.code}`);
      return (data?.[0] as LedgerRow | undefined) ?? null;
    },
    insert: async (row) => {
      const { data, error } = await client.from("evidence_items").insert(row).select(LEDGER_COLUMNS).single();
      if (error || !data) throw new Error(`ledger_insert_failed:${error?.code ?? "no_row"}`);
      return data as LedgerRow;
    },
  };
}

/** Escapuje zástupné znaky LIKE (`_`, `%`, `\`), aby prefix zodpovedal presne jednému prípadu. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

/**
 * Case metadata for Court Pack, bound to the caller's Bearer token and user id.
 * Uses the anon key + RLS (never the service role). Returns null when the case
 * is missing or not owned — callers must not distinguish those outcomes.
 */
export async function loadOwnedCaseSummary(
  token: string,
  userId: string,
  caseId: string,
): Promise<{ id: string; name: string } | null> {
  if (!token || !userId) return null;
  const client = await userClient(token);
  const { data, error } = await client
    .from("cases")
    .select("id, name")
    .eq("id", caseId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`case_read_failed:${error.code ?? "unknown"}`);
  if (!data?.id) return null;
  return {
    id: String(data.id),
    name: typeof data.name === "string" ? data.name : String(data.name ?? ""),
  };
}

/** Záznamy ledgeru pre prípad (RLS: iba vlastné). */
export async function listLedgerEvidence(token: string, caseId: string): Promise<LedgerRow[]> {
  const client = await userClient(token);
  const { data, error } = await client
    .from("evidence_items")
    .select(LEDGER_COLUMNS)
    .or(`case_id.eq.${caseId},s3_object_key.like.cases/${escapeLike(caseId)}/evidence/%`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`ledger_read_failed:${error.code}`);
  return (data ?? []) as LedgerRow[];
}
