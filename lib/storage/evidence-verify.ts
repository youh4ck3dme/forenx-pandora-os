import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Serverové overenie integrity dôkazov v S3.
 *
 * Hash v `evidence_items.sha256_hash` počíta prehliadač — nie je to dôkaz, že
 * v S3 leží presne tento súbor. Worker preto objekt stiahne (stream, bez
 * načítania do RAM), spočíta SHA-256 a veľkosť a výsledok zapíše cez RPC
 * `record_evidence_verification` (iba service_role; stav `verified` DB prijme
 * len pri zhode hashu aj veľkosti a zapíše auditnú udalosť).
 */

export type VerificationStatus = "verified" | "mismatch" | "object_missing" | "error";

export type PendingEvidence = {
  id: string;
  s3_object_key: string;
  sha256_hash: string;
  file_size: number;
};

export type VerificationResult = {
  id: string;
  status: VerificationStatus;
  sha256: string | null;
  size: number | null;
  error: string | null;
};

export type ObjectSource = (
  key: string,
) => Promise<
  | { ok: true; body: ReadableStream<Uint8Array> }
  | { ok: false; status: number }
>;

export type VerificationDeps = {
  openObject: ObjectSource;
  record: (result: VerificationResult) => Promise<void>;
  /**
   * Called after a successful `verified` record is committed.
   * Must not throw in a way that rolls back verification: the runner swallows errors.
   */
  drainVerified?: (evidenceId: string) => Promise<void>;
};

/** SHA-256 a veľkosť streamu po častiach (pamäť nezávisí od veľkosti súboru). */
export async function sha256OfStream(
  body: ReadableStream<Uint8Array>,
): Promise<{ sha256: string; size: number }> {
  const hash = createHash("sha256");
  let size = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    size += value.byteLength;
  }
  return { sha256: hash.digest("hex"), size };
}

export async function verifyEvidenceItem(
  item: PendingEvidence,
  deps: VerificationDeps,
): Promise<VerificationResult> {
  let result: VerificationResult;
  try {
    const object = await deps.openObject(item.s3_object_key);
    if (!object.ok) {
      result = {
        id: item.id,
        status: object.status === 404 ? "object_missing" : "error",
        sha256: null,
        size: null,
        error: `S3 HTTP ${object.status}`,
      };
    } else {
      const { sha256, size } = await sha256OfStream(object.body);
      const matches = sha256 === item.sha256_hash.toLowerCase() && size === item.file_size;
      result = { id: item.id, status: matches ? "verified" : "mismatch", sha256, size, error: null };
    }
  } catch (error) {
    // Hodnoty (kľúče, URL s podpisom) sa do chyby nedávajú — iba typ.
    result = {
      id: item.id,
      status: "error",
      sha256: null,
      size: null,
      error: error instanceof Error ? error.name : "unknown_error",
    };
  }
  await deps.record(result);
  return result;
}

/** Bearer token v konštantnom čase; bez nastaveného tajomstva je endpoint zatvorený. */
export function isAuthorizedCronRequest(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Po tomto čase sa položka so stavom `error` (dočasná chyba S3/siete) overí znova. */
export const ERROR_RETRY_AFTER_MS = 60 * 60 * 1000;

/** Filter pre čakajúce položky: `pending` + `error` staršie ako back-off. */
export function pendingVerificationFilter(now: Date = new Date()): string {
  const retryBefore = new Date(now.getTime() - ERROR_RETRY_AFTER_MS).toISOString();
  return `hash_verification_status.eq.pending,and(hash_verification_status.eq.error,hash_verified_at.lt.${retryBefore})`;
}

/** Produkčné závislosti: presigned GET na S3 + RPC cez service role. */
export async function runPendingEvidenceVerification(limit = 10): Promise<VerificationResult[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { getPresignedDossierUrl } = await import("@/lib/storage/s3-vault");

  const { data, error } = await supabaseAdmin
    .from("evidence_items")
    .select("id, s3_object_key, sha256_hash, file_size")
    .or(pendingVerificationFilter())
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Načítanie čakajúcich dôkazov zlyhalo (${error.code})`);

  const deps: VerificationDeps = {
    openObject: async (key) => {
      const url = await getPresignedDossierUrl(key, 300);
      const res = await fetch(url);
      if (!res.ok || !res.body) return { ok: false, status: res.status };
      return { ok: true, body: res.body };
    },
    record: async (result) => {
      const { error: rpcError } = await supabaseAdmin.rpc("record_evidence_verification", {
        _item: result.id,
        _status: result.status,
        _verified_sha256: result.sha256,
        _verified_size: result.size,
        _error: result.error,
      });
      if (rpcError) throw new Error(`Zápis výsledku overenia zlyhal (${rpcError.code})`);
    },
  };

  return verifyAndDrain((data ?? []) as PendingEvidence[], {
    ...deps,
    drainVerified: async (evidenceId) => {
      const { drainForenzxDispatchOutbox } = await import("@/lib/forza/forenzx-dispatch-drain.server");
      // Short drain of the row the verified trigger just inserted. Errors stay on the outbox row.
      await drainForenzxDispatchOutbox({ evidenceId, limit: 1, fetchTimeoutMs: 8_000 });
    },
  });
}

/**
 * Verify each item, then drain the ForenZX outbox for rows that became verified.
 * Drain failures are swallowed: the ledger status is already committed and the outbox row remains.
 */
export async function verifyAndDrain(
  items: PendingEvidence[],
  deps: VerificationDeps,
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const item of items) {
    const result = await verifyEvidenceItem(item, deps);
    results.push(result);
    if (result.status !== "verified" || !deps.drainVerified) continue;
    try {
      await deps.drainVerified(result.id);
    } catch {
      // Verified state must stand. The outbox row stays pending/failed with last_error.
    }
  }
  return results;
}

/**
 * Re-hash current storage bytes before an authoritative export.
 * A previously stored `verified` status is not proof that the object is unchanged.
 */
export async function confirmEvidenceByteBinding(
  items: Array<{ id: string; s3_object_key: string; sha256_hash: string; file_size: number }>,
  openObject: ObjectSource,
): Promise<{ ok: true } | { ok: false; id: string; status: "mismatch" | "object_missing" | "error" }> {
  for (const item of items) {
    const object = await openObject(item.s3_object_key);
    if (!object.ok) {
      return { ok: false, id: item.id, status: object.status === 404 ? "object_missing" : "error" };
    }
    const actual = await sha256OfStream(object.body);
    if (actual.sha256 !== item.sha256_hash.toLowerCase() || actual.size !== item.file_size) {
      return { ok: false, id: item.id, status: "mismatch" };
    }
  }
  return { ok: true };
}
