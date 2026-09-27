/**
 * Klientsky priamy upload dôkazu do S3 + zápis do ledgeru.
 *
 * 1. PUT na presigned URL so VŠETKÝMI hlavičkami z `requiredHeaders` — sú súčasťou
 *    SigV4 podpisu (x-amz-content-sha256, x-amz-meta-*); bez nich S3 upload odmietne.
 * 2. Až po úspešnom PUT commit do `/api/vault/commit` (záznam v `evidence_items`).
 * 3. Úspech sa hlási iba ak prešli oba kroky; stav integrity je zo servera
 *    (`checking`, kým worker hash neoverí) — nikdy nie natvrdo `verified`.
 */

export type PresignData = {
  uploadUrl: string;
  storageKey: string;
  bucket?: string;
  requiredHeaders: Record<string, string>;
};

export type DirectUploadInput = {
  file: Blob;
  fileName: string;
  caseId: string;
  sha256Hash: string;
  presign: PresignData;
  token: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type DirectUploadResult =
  | {
      ok: true;
      evidenceId: string | null;
      persisted: boolean;
      integrityStatus: "verified" | "compromised" | "checking";
    }
  | { ok: false; stage: "s3_put" | "ledger_commit"; status: number; error: string };

function isDevFallback(url: string): boolean {
  return url.includes("vault_mode=fallback");
}

export async function uploadEvidenceDirect(input: DirectUploadInput): Promise<DirectUploadResult> {
  const doFetch = input.fetchImpl ?? fetch;
  const mimeType = input.presign.requiredHeaders["Content-Type"] || "application/octet-stream";

  // Dev fallback (bez S3) nemá kam PUT-ovať; server ho v produkcii nevydá.
  if (!isDevFallback(input.presign.uploadUrl)) {
    let put: Response;
    try {
      put = await doFetch(input.presign.uploadUrl, {
        method: "PUT",
        headers: { ...input.presign.requiredHeaders },
        body: input.file,
        signal: input.signal,
      });
    } catch (error) {
      return {
        ok: false,
        stage: "s3_put",
        status: 0,
        error: error instanceof Error && error.name === "AbortError" ? "Upload bol prerušený." : "S3 nie je dostupné.",
      };
    }
    if (!put.ok) {
      return { ok: false, stage: "s3_put", status: put.status, error: `S3 odmietlo upload (HTTP ${put.status}).` };
    }
  }

  let commit: Response;
  try {
    commit = await doFetch("/api/vault/commit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      body: JSON.stringify({
        caseId: input.caseId,
        storageKey: input.presign.storageKey,
        fileName: input.fileName,
        fileSizeBytes: input.file.size,
        mimeType,
        sha256Hash: input.sha256Hash,
      }),
      signal: input.signal,
    });
  } catch {
    return { ok: false, stage: "ledger_commit", status: 0, error: "Zápis do ledgeru zlyhal (sieť)." };
  }
  const payload = (await commit.json().catch(() => ({}))) as {
    error?: string;
    evidenceId?: string | null;
    persisted?: boolean;
    integrityStatus?: "verified" | "compromised" | "checking";
  };
  if (!commit.ok) {
    return {
      ok: false,
      stage: "ledger_commit",
      status: commit.status,
      error: payload.error || `Zápis do ledgeru zlyhal (HTTP ${commit.status}).`,
    };
  }
  return {
    ok: true,
    evidenceId: payload.evidenceId ?? null,
    persisted: payload.persisted === true,
    integrityStatus: payload.integrityStatus ?? "checking",
  };
}
