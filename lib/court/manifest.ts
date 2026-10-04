/**
 * Court Pack — deterministic cryptographic manifest.
 *
 * The manifest is the canonical, tamper-evident description of every artifact in
 * a Court Pack. It is what the Ed25519 signature is computed over (see
 * `./signing.ts`) and what the offline verifier (`./verify.mjs`) rebuilds from
 * the raw files to detect any byte-level tampering.
 *
 * Canonicalization rules (MUST match `verify.mjs` exactly, byte-for-byte):
 *  - File entries are sorted by `path` ascending (Unicode codepoint order).
 *  - Serialization is canonical JSON: object keys sorted, no insignificant
 *    whitespace. This guarantees the signed bytes are reproducible offline with
 *    no dependency on object insertion order or formatting.
 */
import { createHash } from "node:crypto";

export type ManifestFileEntry = {
  path: string;
  sha256: string; // hex
  bytes: number;
};

export type CourtPackManifest = {
  manifestVersion: 1;
  algorithm: "SHA-256";
  files: ManifestFileEntry[];
  merkleRoot: string; // hex
};

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical JSON: recursively sorts object keys and emits no insignificant
 * whitespace. Arrays keep their order. This is the exact string that gets
 * hashed/signed, so the algorithm MUST be reproduced identically in verify.mjs.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
}

/**
 * Merkle root over the ordered list of leaf hashes (hex SHA-256 of each file).
 * Odd levels duplicate the last node (Bitcoin-style). Empty input yields the
 * SHA-256 of the empty byte string so the value is always well-defined.
 */
export function computeMerkleRoot(leafHashesHex: string[]): string {
  if (leafHashesHex.length === 0) {
    return createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  }
  let level: Buffer[] = leafHashesHex.map((hex) => Buffer.from(hex, "hex"));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(createHash("sha256").update(Buffer.concat([left, right])).digest());
    }
    level = next;
  }
  return level[0]!.toString("hex");
}

export type ManifestInputFile = {
  path: string;
  content: Uint8Array;
};

export function buildManifest(files: ManifestInputFile[]): CourtPackManifest {
  const seen = new Set<string>();
  const entries: ManifestFileEntry[] = [];
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error(`Duplicate manifest path: ${file.path}`);
    }
    seen.add(file.path);
    entries.push({ path: file.path, sha256: sha256Hex(file.content), bytes: file.content.byteLength });
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    manifestVersion: 1,
    algorithm: "SHA-256",
    files: entries,
    merkleRoot: computeMerkleRoot(entries.map((entry) => entry.sha256)),
  };
}

export function canonicalManifestBytes(manifest: CourtPackManifest): Buffer {
  return Buffer.from(canonicalJson(manifest), "utf8");
}

/**
 * Rebuilds the manifest from raw files and compares it against a reference
 * manifest. Returns the first mismatching artifact (by name) so callers — and
 * the offline verifier — can report exactly which byte tamper was detected.
 */
export function diffManifest(
  reference: CourtPackManifest,
  rebuilt: CourtPackManifest,
): { ok: true } | { ok: false; failingArtifact: string; reason: string } {
  const refByPath = new Map(reference.files.map((entry) => [entry.path, entry]));
  const builtByPath = new Map(rebuilt.files.map((entry) => [entry.path, entry]));

  for (const [path, builtEntry] of builtByPath) {
    const refEntry = refByPath.get(path);
    if (!refEntry) {
      return { ok: false, failingArtifact: path, reason: "file is not listed in the manifest" };
    }
    if (refEntry.sha256 !== builtEntry.sha256) {
      return { ok: false, failingArtifact: path, reason: "SHA-256 mismatch (file content changed)" };
    }
    if (refEntry.bytes !== builtEntry.bytes) {
      return { ok: false, failingArtifact: path, reason: "byte length mismatch" };
    }
  }
  for (const path of refByPath.keys()) {
    if (!builtByPath.has(path)) {
      return { ok: false, failingArtifact: path, reason: "file listed in manifest is missing from the pack" };
    }
  }
  if (reference.merkleRoot !== rebuilt.merkleRoot) {
    return { ok: false, failingArtifact: "merkleRoot", reason: "Merkle root mismatch" };
  }
  return { ok: true };
}
