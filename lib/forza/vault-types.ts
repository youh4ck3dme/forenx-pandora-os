import { z } from "zod";

export const CaseIdSchema = z
  .string()
  .min(1, "Neplatný alebo prázdny CaseId.")
  .max(128, "CaseId je príliš dlhé.")
  .regex(/^[A-Za-z0-9_-]+$/, "CaseId obsahuje nepovolené znaky.")
  .brand<"CaseId">();
export type CaseId = z.infer<typeof CaseIdSchema>;

export const EvidenceIdSchema = z
  .string()
  .min(1, "Neplatný formát EvidenceId.")
  .brand<"EvidenceId">();
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

export const Sha256HashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, "Neplatný 64-znakový SHA-256 hex reťazec.")
  .transform((val) => val.toLowerCase())
  .brand<"Sha256Hash">();
export type Sha256Hash = z.infer<typeof Sha256HashSchema>;

export const S3StorageKeySchema = z
  .string()
  .min(5, "Neplatný S3 Storage Key.")
  .brand<"S3StorageKey">();
export type S3StorageKey = z.infer<typeof S3StorageKeySchema>;

// ─── 2. DOMÉNOVÉ SCHÉMY DÔKAZOV ──────────────────────────────────
export const EvidenceTagSchema = z.enum(["zmluva", "vypis", "screenshot", "komunikacia", "ine"]);
export type EvidenceTag = z.infer<typeof EvidenceTagSchema>;

export const ForensicEvidenceItemSchema = z.object({
  id: EvidenceIdSchema,
  caseId: CaseIdSchema,
  fileName: z.string().min(1, "Názov súboru nesmie byť prázdny."),
  fileSizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  sha256Hash: Sha256HashSchema,
  s3StorageKey: S3StorageKeySchema,
  s3Bucket: z.string().min(1),
  uploadedAt: z.string().datetime(),
  uploadedBy: z.string().min(1),
  integrityStatus: z.enum(["verified", "compromised", "checking"]),
  aiAnalyzed: z.boolean().default(false),
  tags: z.array(EvidenceTagSchema).default(["ine"]),
});
export type ForensicEvidenceItem = z.infer<typeof ForensicEvidenceItemSchema>;

// ─── 3. STAVOVÝ AUTOMAT PRE INGEST (DISCRIMINATED UNION) ─────────
export type IngestProgressState =
  | { readonly status: "idle" }
  | { readonly status: "hashing"; readonly progressPercent: number }
  | { readonly status: "uploading"; readonly progressPercent: number; readonly clientHash: Sha256Hash }
  | { readonly status: "persisting"; readonly clientHash: Sha256Hash }
  | { readonly status: "ready"; readonly item: ForensicEvidenceItem }
  | { readonly status: "error"; readonly errorMessage: string; readonly code?: string };

// ─── 4. RESULT PATTERN PRE VAULT OPERÁCIE ─────────────────────────
export type VaultError =
  | { readonly kind: "IntegrityMismatch"; readonly clientHash: string; readonly serverHash: string }
  | { readonly kind: "PayloadTooLarge"; readonly sizeBytes: number; readonly maxBytes: number }
  | { readonly kind: "ValidationError"; readonly message: string; readonly issues: z.ZodIssue[] }
  | { readonly kind: "StorageError"; readonly message: string; readonly s3Code?: string }
  | { readonly kind: "AuthUnauthorized"; readonly message: string };

export type Result<T, E = VaultError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
