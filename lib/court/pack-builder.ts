/**
 * Court Pack builder — assembles the deterministic, signed evidence package.
 *
 * Hashing layering (NO circular dependency):
 *   manifest.json   = SHA-256 + Merkle over the CONTENT artifacts only
 *                     (report.pdf, chain-of-custody.json, hashes.json,
 *                      execution.json, VERIFY.md, verify.mjs)
 *   signature.json  = Ed25519 over the canonical manifest  (derived from manifest)
 *   merkle.json     = Merkle tree view of the manifest       (derived from manifest)
 *   timestamp.tsr   = RFC 3161 token over the SHA-256 of the canonical manifest
 *                     (signature.manifestSha256), which commits to the Merkle root
 * signature.json / merkle.json / timestamp.tsr are NEVER listed in the manifest,
 * so the signed bytes never depend on them. The offline verifier rebuilds the
 * manifest from the content artifacts, excluding exactly those three control
 * files plus manifest.json.
 */
import JSZip from "jszip";
import { buildManifest, canonicalJson, type CourtPackManifest } from "./manifest";
import { buildCourtReportPdf, type CourtReportInput } from "./report";
import { signCourtPackManifest, type CourtPackSignature, type Keyring, type SigningKeyProvider } from "./signing";
import { requestTimestampToken } from "./timestamp";

const FIXED_ZIP_DATE = new Date("2000-01-01T00:00:00Z"); // deterministic zip entries

export type CourtPackInput = {
  caseId: string;
  report: Omit<CourtReportInput, "merkleRoot" | "signingKid">;
  chainOfCustody: unknown;
  hashes: unknown;
  execution: unknown;
  provenance?: unknown;
  signing: {
    kid: string;
    keyRef: string;
    keyring: Keyring;
    revoked: Set<string>;
    provider: SigningKeyProvider;
  };
  verifyMjsSource: string;
  tsaUrl?: string | null;
  /** Fail-closed: when true (court-grade), a missing TSA aborts the build. */
  requireTimestamp?: boolean;
  now?: Date;
  fetchImpl?: typeof fetch;
};

export type CourtPackResult = {
  zip: Uint8Array;
  manifest: CourtPackManifest;
  signature: CourtPackSignature;
  merkleRoot: string;
  timestamped: boolean;
};

const enc = (value: unknown): Uint8Array => new TextEncoder().encode(canonicalJson(value));

function verifyMarkdown(caseId: string, kid: string): string {
  return [
    "# Court Pack — Offline Verification",
    "",
    `Case: ${caseId}`,
    `Signing key id: ${kid}`,
    "",
    "This package is self-verifying and requires **no PANDORA backend and no secret**.",
    "",
    "## Verify",
    "```",
    "node verify.mjs .",
    "```",
    "Optionally cross-check against a trusted keyring / revocation list:",
    "```",
    "node verify.mjs . --keyring keyring.json --revoked <revoked-kid-csv>",
    "```",
    "",
    "## What is checked",
    "1. Every artifact's SHA-256 is recomputed and compared to `manifest.json`.",
    "2. The Merkle root is recomputed and compared.",
    "3. The Ed25519 signature in `signature.json` is verified over the canonical manifest.",
    "4. A revoked signing `kid` is rejected.",
    "5. If present, `timestamp.tsr` must bind the SHA-256 of the canonical manifest.",
    "",
    "Any tampered byte makes verification fail and names the exact failing artifact.",
    "",
  ].join("\n");
}

export async function buildCourtPack(input: CourtPackInput): Promise<CourtPackResult> {
  // 1. Content artifacts (these — and only these — are covered by the manifest).
  const reportPdf = await buildCourtReportPdf({
    ...input.report,
    signingKid: input.signing.kid,
    merkleRoot: "pending", // placeholder; recomputed below with the real root
  });

  const chainBytes = enc(input.chainOfCustody);
  const hashesBytes = enc(input.hashes);
  const executionBytes = enc(input.execution);
  const verifyBytes = new TextEncoder().encode(input.verifyMjsSource);
  const verifyMdBytes = new TextEncoder().encode(verifyMarkdown(input.caseId, input.signing.kid));

  const contentFiles = [
    { path: "report.pdf", content: reportPdf },
    { path: "chain-of-custody.json", content: chainBytes },
    { path: "hashes.json", content: hashesBytes },
    { path: "execution.json", content: executionBytes },
    { path: "provenance.json", content: enc(input.provenance ?? { selectedRunId: null }) },
    { path: "VERIFY.md", content: verifyMdBytes },
    { path: "verify.mjs", content: verifyBytes },
  ];

  // 2. Manifest + signature (manifest covers content only).
  const manifest = buildManifest(contentFiles);
  const signature = signCourtPackManifest({
    manifest,
    kid: input.signing.kid,
    keyRef: input.signing.keyRef,
    keyring: input.signing.keyring,
    revoked: input.signing.revoked,
    provider: input.signing.provider,
    now: input.now,
  });

  // 3. Derived, non-manifest control files.
  const merkleJson = {
    algorithm: "SHA-256",
    merkleRoot: manifest.merkleRoot,
    leaves: manifest.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
  };

  // INV-031 fail-closed: court-grade packs MUST be timestamped. The RFC 3161
  // token is bound to signature.manifestSha256 (SHA-256 of the canonical
  // manifest). A token that timestamps anything else is rejected.
  if (input.requireTimestamp && !input.tsaUrl) {
    throw new Error(
      "Court-grade Court Pack requires a TSA (FORENZX_TSA_URL); refusing to build an un-timestamped pack (fail-closed).",
    );
  }
  let timestamped = false;
  let tsrBytes: Uint8Array | null = null;
  if (input.tsaUrl) {
    const result = await requestTimestampToken(input.tsaUrl, signature.manifestSha256, input.fetchImpl ?? fetch);
    tsrBytes = result.tsr;
    timestamped = true;
  }

  // 4. Deterministic ZIP.
  const zip = new JSZip();
  const add = (name: string, data: Uint8Array) => zip.file(name, data, { date: FIXED_ZIP_DATE });
  for (const file of contentFiles) add(file.path, file.content);
  add("manifest.json", new TextEncoder().encode(canonicalJson(manifest)));
  add("signature.json", new TextEncoder().encode(canonicalJson(signature)));
  add("merkle.json", new TextEncoder().encode(canonicalJson(merkleJson)));
  if (tsrBytes) add("timestamp.tsr", tsrBytes);

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });

  return { zip: zipBytes, manifest, signature, merkleRoot: manifest.merkleRoot, timestamped };
}
