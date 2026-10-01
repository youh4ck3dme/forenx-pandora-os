import { z } from "zod";

export const ForenzxStartRequestSchema = z.object({
  caseId: z.string().uuid(),
  evidenceId: z.string().uuid(),
  inputType: z.string().min(1).max(64),
  packId: z.string().min(1).max(128).default("mobile_compromise"),
  // Legacy clients may send these; they must match the ledger exactly.
  s3ObjectKey: z.string().min(1).max(2048).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict();

type Query = { data: unknown; error: { message?: string } | null };
type SupabaseLike = { from: (table: string) => any };

export type TrustedForenzxEvidence = {
  caseId: string;
  evidenceId: string;
  s3Key: string;
  sha256: string;
  fileSize: number;
  fileName: string;
};

const safeError = new Error("Dôkaz nebol nájdený, nie je overený alebo k nemu nemáte prístup.");

export async function authorizeForenzxStart(
  supabase: SupabaseLike,
  userId: string,
  input: z.infer<typeof ForenzxStartRequestSchema>,
): Promise<TrustedForenzxEvidence> {
  const [caseResult, evidenceResult] = await Promise.all([
    supabase.from("cases").select("id").eq("id", input.caseId).eq("user_id", userId).maybeSingle() as Promise<Query>,
    supabase.from("evidence_items").select("id, investigator_id, file_name, file_size, sha256_hash, s3_object_key, hash_verification_status").eq("id", input.evidenceId).eq("investigator_id", userId).maybeSingle() as Promise<Query>,
  ]);
  if (caseResult.error || evidenceResult.error || !caseResult.data || !evidenceResult.data) throw safeError;
  const row = evidenceResult.data as Record<string, unknown>;
  const key = typeof row.s3_object_key === "string" ? row.s3_object_key : "";
  const hash = typeof row.sha256_hash === "string" ? row.sha256_hash.toLowerCase() : "";
  const prefix = `cases/${input.caseId}/evidence/`;
  const suffix = key.slice(prefix.length);
  if (!key.startsWith(prefix) || !suffix || suffix.includes("..") || row.hash_verification_status !== "verified") throw safeError;
  if (!/^[a-f0-9]{64}$/.test(hash) || typeof row.file_size !== "number" || row.file_size < 0) throw safeError;
  if (input.s3ObjectKey && input.s3ObjectKey !== key) throw safeError;
  if (input.sha256 && input.sha256.toLowerCase() !== hash) throw safeError;
  return { caseId: input.caseId, evidenceId: input.evidenceId, s3Key: key, sha256: hash, fileSize: row.file_size, fileName: typeof row.file_name === "string" ? row.file_name : "evidence" };
}
