/**
 * Signed Evidence Capability for Pandora → ForenZX Hub M2M trust.
 *
 * Instead of passing a raw presigned URL, Pandora issues a short-lived capability
 * that the Hub verifies before downloading. This ensures:
 *  - The URL cannot be tampered with by an intermediary.
 *  - The capability is tied to a specific evidence_id + case_id + sha256.
 *  - TTL is max 15 minutes (900 s), independent of the S3 URL expiry.
 *  - The Hub MUST verify the HMAC signature before acting on the capability.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const CAPABILITY_TTL_SECONDS = 900; // 15 minutes
export const CAPABILITY_ISSUER = "pandora-evidence-vault";

export type EvidenceLedgerRow = {
  id: string;
  case_id: string;
  sha256_hash: string;
  s3_object_key: string;
};

export type EvidenceCapabilityPayload = {
  evidence_id: string;
  case_id: string;
  expected_sha256: string;
  s3_object_key: string;
  download_url: string;
  download_filename: string;
  issuer: typeof CAPABILITY_ISSUER;
  issued_at: number;
  expires_at: number;
};

export type SignedEvidenceCapability = EvidenceCapabilityPayload & {
  signature: string; // hex-encoded HMAC-SHA256
};

function getM2mSecret(): Buffer {
  const secret = process.env.FORENZX_M2M_SECRET?.trim();
  if (!secret) {
    throw new Error("FORENZX_M2M_SECRET is not configured — cannot issue evidence capability");
  }
  return Buffer.from(secret, "utf8");
}

/**
 * Deterministic canonical string for signing.
 * Fields are sorted to prevent key confusion attacks.
 */
function canonicalString(payload: EvidenceCapabilityPayload): string {
  return [
    payload.evidence_id,
    payload.case_id,
    payload.expected_sha256,
    payload.s3_object_key,
    payload.download_url,
    payload.download_filename,
    payload.issuer,
    String(payload.issued_at),
    String(payload.expires_at),
  ].join("\n");
}

function signPayload(payload: EvidenceCapabilityPayload, secret: Buffer): string {
  return createHmac("sha256", secret).update(canonicalString(payload)).digest("hex");
}

/**
 * Generate a signed evidence capability for the ForenZX Hub.
 *
 * @param evidence   - Verified ledger row (case_id + sha256 are from DB, not caller)
 * @param presignedUrl - Short-lived S3 presigned URL (≤ CAPABILITY_TTL_SECONDS)
 * @param filename   - Filename hint for the Hub's vault
 * @returns Signed capability; Hub MUST call verifyEvidenceCapability before trusting it
 */
export function generateEvidenceCapability(
  evidence: EvidenceLedgerRow,
  presignedUrl: string,
  filename: string,
): SignedEvidenceCapability {
  const secret = getM2mSecret();
  const now = Math.floor(Date.now() / 1000);

  const payload: EvidenceCapabilityPayload = {
    evidence_id: evidence.id,
    case_id: evidence.case_id,
    expected_sha256: evidence.sha256_hash,
    s3_object_key: evidence.s3_object_key,
    download_url: presignedUrl,
    download_filename: filename,
    issuer: CAPABILITY_ISSUER,
    issued_at: now,
    expires_at: now + CAPABILITY_TTL_SECONDS,
  };

  return { ...payload, signature: signPayload(payload, secret) };
}

/**
 * Verify a signed evidence capability (Hub-side or test use).
 * Returns null if the signature is invalid, the capability is expired, or the secret is missing.
 */
export function verifyEvidenceCapability(
  cap: SignedEvidenceCapability,
): { ok: true; payload: EvidenceCapabilityPayload } | { ok: false; reason: string } {
  let secret: Buffer;
  try {
    secret = getM2mSecret();
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Missing secret" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > cap.expires_at) {
    return { ok: false, reason: "Capability expired" };
  }
  if (now < cap.issued_at - 30) {
    // 30-second clock skew allowance
    return { ok: false, reason: "Capability issued in the future (clock skew)" };
  }

  const { signature, ...payload } = cap;
  const expected = signPayload(payload as EvidenceCapabilityPayload, secret);

  const sigBuf = Buffer.from(signature, "hex");
  const expBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, reason: "Signature verification failed" };
  }

  return { ok: true, payload: payload as EvidenceCapabilityPayload };
}
