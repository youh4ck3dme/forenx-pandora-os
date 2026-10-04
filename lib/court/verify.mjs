#!/usr/bin/env node
/**
 * Court Pack — STANDALONE OFFLINE VERIFIER.
 *
 * Re-verifies a Court Pack with NO access to PANDORA, no network, and NO secret
 * — only the public key (carried in signature.json) and, optionally, a trusted
 * keyring / revocation list. This file is intentionally self-contained: it does
 * not import the app. Its canonicalization/Merkle logic MUST stay byte-for-byte
 * identical to `lib/court/manifest.ts`.
 *
 * Usage:
 *   node verify.mjs <packDir> [--revoked kid1,kid2] [--keyring keyring.json]
 *
 * Exit code 0 => VERIFIED. Non-zero => failure, with the exact failing artifact
 * named on stderr.
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

function sha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

function computeMerkleRoot(leafHashesHex) {
  if (leafHashesHex.length === 0) return createHash("sha256").update(Buffer.alloc(0)).digest("hex");
  let level = leafHashesHex.map((hex) => Buffer.from(hex, "hex"));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      next.push(createHash("sha256").update(Buffer.concat([left, right])).digest());
    }
    level = next;
  }
  return level[0].toString("hex");
}

function walkFiles(root, dir = root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(root, full));
    } else {
      out.push(relative(root, full).split(sep).join("/"));
    }
  }
  return out;
}

function fail(artifact, reason) {
  console.error(`FAILED [${artifact}]: ${reason}`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const packDir = args.find((a) => !a.startsWith("--"));
  if (!packDir) {
    console.error("Usage: node verify.mjs <packDir> [--revoked kid1,kid2] [--keyring keyring.json]");
    process.exit(2);
  }
  const revokedArg = args.includes("--revoked") ? args[args.indexOf("--revoked") + 1] : "";
  const revoked = new Set((revokedArg || "").split(",").map((s) => s.trim()).filter(Boolean));
  const keyringPath = args.includes("--keyring") ? args[args.indexOf("--keyring") + 1] : null;
  // Optional TRUSTED time (e.g. from a verified RFC 3161 timestamp) enabling the
  // pre-revocation exception: a pack signed before the key was revoked stays valid.
  const asOfArg = args.includes("--as-of") ? args[args.indexOf("--as-of") + 1] : null;
  const asOf = asOfArg ? new Date(asOfArg) : null;

  // 1. Load manifest + signature.
  let manifest;
  let signature;
  try {
    manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8"));
  } catch {
    fail("manifest.json", "missing or not valid JSON");
  }
  try {
    signature = JSON.parse(readFileSync(join(packDir, "signature.json"), "utf8"));
  } catch {
    fail("signature.json", "missing or not valid JSON");
  }

  // 2. Rebuild manifest from the actual files on disk (excluding the control
  //    files, which are DERIVED from the manifest and never listed inside it).
  const control = new Set(["manifest.json", "signature.json", "merkle.json", "timestamp.tsr"]);
  const diskFiles = walkFiles(packDir).filter((p) => !control.has(p));
  const rebuilt = diskFiles
    .map((path) => ({ path, sha256: sha256Hex(readFileSync(join(packDir, path))), bytes: statSync(join(packDir, path)).size }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const refByPath = new Map((manifest.files || []).map((e) => [e.path, e]));
  const builtByPath = new Map(rebuilt.map((e) => [e.path, e]));
  for (const [path, built] of builtByPath) {
    const ref = refByPath.get(path);
    if (!ref) fail(path, "file present in pack but not listed in manifest");
    if (ref.sha256 !== built.sha256) fail(path, "SHA-256 mismatch (content changed)");
    if (ref.bytes !== built.bytes) fail(path, "byte length mismatch");
  }
  for (const path of refByPath.keys()) {
    if (!builtByPath.has(path)) fail(path, "file listed in manifest is missing from the pack");
  }

  // 3. Recompute Merkle root and cross-check the derived merkle.json (if present).
  const merkleRoot = computeMerkleRoot(rebuilt.map((e) => e.sha256));
  if (merkleRoot !== manifest.merkleRoot) fail("merkleRoot", "Merkle root mismatch");
  try {
    const merkleJsonRaw = readFileSync(join(packDir, "merkle.json"), "utf8");
    const merkleJson = JSON.parse(merkleJsonRaw);
    if (merkleJson.merkleRoot && merkleJson.merkleRoot !== merkleRoot) {
      fail("merkle.json", "merkle.json root does not match recomputed Merkle root");
    }
  } catch (error) {
    if (error && error.code !== "ENOENT") fail("merkle.json", "merkle.json is present but not valid JSON");
  }

  // 4. Verify the signature over the canonical manifest.
  const canonicalBytes = Buffer.from(canonicalJson(manifest), "utf8");
  if (sha256Hex(canonicalBytes) !== signature.manifestSha256) {
    fail("signature.json", "manifest hash does not match signature.manifestSha256");
  }
  if (signature.algorithm !== "Ed25519") fail("signature.json", `unsupported algorithm ${signature.algorithm}`);

  // Trust context: the pack self-describes its signing-time key record
  // (signature.keyRecord). CURRENT revocation comes from an external trusted
  // keyring and/or the --revoked list — never from the pack's frozen keyRecord.
  // Fail-closed, with a pre-revocation exception when a TRUSTED --as-of time is
  // strictly before the key's revokedAt. The self-asserted signedAt is ignored.
  let keyringRecord = null;
  if (keyringPath) {
    let keyring;
    try {
      keyring = JSON.parse(readFileSync(keyringPath, "utf8"));
    } catch {
      fail("keyring", "trusted keyring is missing or not valid JSON");
    }
    keyringRecord = (Array.isArray(keyring) ? keyring : keyring.keys || []).find((k) => k.kid === signature.kid) || null;
    if (!keyringRecord) fail("signature.json", `kid ${signature.kid} not in trusted keyring`);
    const a = createPublicKey(keyringRecord.publicKeyPem).export({ type: "spki", format: "der" });
    const b = createPublicKey(signature.publicKeyPem).export({ type: "spki", format: "der" });
    if (!a.equals(b)) fail("signature.json", "public key does not match trusted keyring");
  }

  const currentRevokedAt = keyringRecord && keyringRecord.revokedAt ? new Date(keyringRecord.revokedAt) : null;
  const isRevoked =
    revoked.has(signature.kid) || (keyringRecord && keyringRecord.status === "revoked") || currentRevokedAt !== null;
  if (isRevoked) {
    const trustedBeforeRevocation = asOf && currentRevokedAt && asOf.getTime() < currentRevokedAt.getTime();
    if (!trustedBeforeRevocation) fail("signature.json", `signing kid is revoked: ${signature.kid}`);
  }

  let publicKey;
  try {
    publicKey = createPublicKey(signature.publicKeyPem);
  } catch {
    fail("signature.json", "invalid public key PEM");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("signature.json", "public key is not Ed25519");

  const valid = edVerify(null, canonicalBytes, publicKey, Buffer.from(signature.signature, "base64"));
  if (!valid) fail("signature.json", "Ed25519 signature verification failed");

  // 5. RFC 3161 timestamp presence (cryptographic TSR verification uses the
  //    pkijs-based verifier; this zero-dependency script reports presence only).
  let tsNote = "no timestamp.tsr";
  try {
    const size = statSync(join(packDir, "timestamp.tsr")).size;
    tsNote = `timestamp.tsr present (${size} bytes) — verify RFC 3161 token with the pkijs verifier`;
  } catch {
    /* no timestamp */
  }

  console.log(`VERIFIED: ${diskFiles.length} artifact(s), kid=${signature.kid}, merkleRoot=${merkleRoot}`);
  console.log(tsNote);
  process.exit(0);
}

main();
