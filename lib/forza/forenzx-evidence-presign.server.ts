/**
 * Pandora → ForenZX Hub: S3 Presigned URL helper (server-only).
 *
 * Generates a short-lived presigned GET URL for an evidence file in S3/R2/MinIO.
 * The URL is passed to the ForenZX MCP Hub via `tools/call forenzx_analysis_start`
 * so the Hub can stream-download the file into its local vault before running
 * the forensic Docker pack.
 *
 * Security:
 *  - This file is server-only (no "use client" — never shipped to the browser).
 *  - AWS credentials live in server env vars only (FORENZX_S3_*).
 *  - URLs expire after PRESIGNED_EXPIRY_SECONDS (default: 3600 s = 1 h).
 *  - The caller MUST also pass `expected_sha256` (from the DB evidence ledger)
 *    so the Hub can verify integrity after download.
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ── Config (server-only env vars) ────────────────────────────────────────────

const PRESIGNED_EXPIRY_SECONDS = parseInt(
  process.env.FORENZX_PRESIGNED_EXPIRY_SECONDS ?? "3600",
  10
);

/**
 * Builds an S3Client from FORENZX_S3_* environment variables.
 * Compatible with AWS S3, Cloudflare R2, DigitalOcean Spaces, and MinIO.
 */
function buildS3Client(): S3Client {
  const region = process.env.FORENZX_S3_REGION;
  const accessKeyId = process.env.FORENZX_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FORENZX_S3_SECRET_ACCESS_KEY;
  const endpoint = process.env.FORENZX_S3_ENDPOINT; // optional, for R2/MinIO

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Missing S3 credentials: set FORENZX_S3_REGION, FORENZX_S3_ACCESS_KEY_ID, FORENZX_S3_SECRET_ACCESS_KEY"
    );
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvidencePresignedUrl {
  /** The presigned GET URL to pass to the Hub. Expires in PRESIGNED_EXPIRY_SECONDS. */
  url: string;
  /** ISO-8601 timestamp when the URL expires. */
  expiresAt: string;
  /** Original S3 key (for logging / audit, NOT stored in DB). */
  s3Key: string;
  /** Filename hint the Hub should use when saving the file in the vault. */
  filename: string;
}

// ── Core function ─────────────────────────────────────────────────────────────

/**
 * Generate a presigned GET URL for an evidence file stored in S3.
 *
 * @param s3Key  - Full S3 object key, e.g. "evidence/case-123/dump.tar.gz"
 * @param bucket - S3 bucket name (defaults to FORENZX_S3_BUCKET env var)
 * @returns      EvidencePresignedUrl with URL + metadata
 */
export async function generateEvidencePresignedUrl(
  s3Key: string,
  bucket?: string
): Promise<EvidencePresignedUrl> {
  const resolvedBucket = bucket ?? process.env.FORENZX_S3_BUCKET;
  if (!resolvedBucket) {
    throw new Error(
      "S3 bucket not specified: set FORENZX_S3_BUCKET or pass bucket explicitly."
    );
  }

  const client = buildS3Client();
  const command = new GetObjectCommand({ Bucket: resolvedBucket, Key: s3Key });

  const url = await getSignedUrl(client, command, {
    expiresIn: PRESIGNED_EXPIRY_SECONDS,
  });

  const expiresAt = new Date(
    Date.now() + PRESIGNED_EXPIRY_SECONDS * 1000
  ).toISOString();

  // Extract filename from S3 key
  const filename = s3Key.split("/").pop() ?? "evidence.bin";

  return { url, expiresAt, s3Key, filename };
}

/**
 * Build the full `arguments` payload for `tools/call forenzx_analysis_start`
 * including the presigned URL, so the Hub can self-download the evidence.
 *
 * @param params.caseId        - ForenZX case_id
 * @param params.evidenceId    - ForenZX evidence_id
 * @param params.packId        - Pack to run (e.g. "mobile_compromise")
 * @param params.inputType     - Evidence type (e.g. "ios_backup")
 * @param params.s3Key         - S3 object key of the evidence file
 * @param params.sha256        - Expected SHA-256 from the Pandora evidence ledger
 * @param params.bucket        - Optional S3 bucket override
 * @param params.idempotencyKey - Optional idempotency key for deduplication
 */
import { generateEvidenceCapability, type SignedEvidenceCapability } from "@/lib/forenzx/capability";

export async function buildForenzxStartPayload(params: {
  caseId: string;
  evidenceId: string;
  packId: string;
  inputType: string;
  s3Key: string;
  sha256: string;
  bucket?: string;
  idempotencyKey?: string;
}): Promise<Record<string, unknown>> {
  const { url, filename, expiresAt } = await generateEvidencePresignedUrl(
    params.s3Key,
    params.bucket
  );

  let evidenceCapability: SignedEvidenceCapability | undefined;
  if (process.env.FORENZX_M2M_SECRET?.trim()) {
    try {
      evidenceCapability = generateEvidenceCapability(
        {
          id: params.evidenceId,
          case_id: params.caseId,
          sha256_hash: params.sha256,
          s3_object_key: params.s3Key,
        },
        url,
        filename,
      );
    } catch {
      // In non-production or when secret is omitted, proceed without capability
    }
  }

  return {
    case_id: params.caseId,
    evidence_id: params.evidenceId,
    pack_id: params.packId,
    input_type: params.inputType,
    claimed_sha256: params.sha256,
    download_url: url,
    download_filename: filename,
    idempotency_key: params.idempotencyKey,
    ...(evidenceCapability ? { evidence_capability: evidenceCapability } : {}),
  };
}
