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
import { createHash, createPublicKey, verify as edVerify, webcrypto } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

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

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";
const SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const TIMESTAMPING_EKU_OID = "1.3.6.1.5.5.7.3.8";
const EXTENDED_KEY_USAGE_OID = "2.5.29.37";

function loadPkijs() {
  const attempts = [createRequire(import.meta.url)];
  try {
    attempts.push(createRequire(pathToFileURL(join(process.cwd(), "package.json"))));
  } catch {
    // cwd may not contain a package.json; the script-local require is enough in-repo.
  }
  let last;
  for (const require of attempts) {
    try {
      return { pkijs: require("pkijs"), asn1js: require("asn1js") };
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

function signatureAlgorithm(oid) {
  if (oid === "1.2.840.113549.1.1.11" || oid === "1.2.840.113549.1.1.1") return { name: "RSASSA-PKCS1-v1_5" };
  if (oid === "1.2.840.1.101.3.4.3.2") return { name: "ECDSA", hash: "SHA-256" };
  return null;
}

function toArrayBuffer(u8) {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

function certificateFromPem(pkijs, asn1js, pem) {
  const body = pem.replace(/-----(?:BEGIN|END) CERTIFICATE-----|\s/g, "");
  if (!body) throw new Error("trusted TSA certificate is not PEM");
  const asn1 = asn1js.fromBER(toArrayBuffer(Buffer.from(body, "base64")));
  if (asn1.offset === -1) throw new Error("trusted TSA certificate is not valid DER");
  return new pkijs.Certificate({ schema: asn1.result });
}

function hasTimestampingEku(pkijs, asn1js, cert) {
  const extension = cert.extensions?.find((item) => item.extnID === EXTENDED_KEY_USAGE_OID);
  if (!extension) return false;
  const asn1 = asn1js.fromBER(extension.extnValue.valueBlock.valueHex);
  if (asn1.offset === -1) return false;
  try {
    return new pkijs.ExtKeyUsage({ schema: asn1.result }).keyPurposes.includes(TIMESTAMPING_EKU_OID);
  } catch {
    return false;
  }
}

/**
 * A timestamp binds only if it is a CMS SignedData token whose messageImprint is
 * the canonical-manifest digest AND whose signer certificate signature verifies.
 * A bare OID+digest blob is not a timestamp.
 */
async function timestampBindsManifest(tsr, expectedDigest, trustedTsaCertsPem) {
  const { pkijs, asn1js } = loadPkijs();
  pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto }));
  const asn1 = asn1js.fromBER(toArrayBuffer(tsr));
  if (asn1.offset === -1) return "timestamp.tsr is not valid DER";
  const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
  if (contentInfo.contentType !== SIGNED_DATA_OID) return "timestamp token is not CMS SignedData";
  const signed = new pkijs.SignedData({ schema: contentInfo.content });
  if (!signed.encapContentInfo.eContent) return "timestamp token has no eContent";
  const content = new Uint8Array(signed.encapContentInfo.eContent.getValue());
  const inner = asn1js.fromBER(toArrayBuffer(content));
  if (inner.offset === -1) return "timestamp TSTInfo is not valid DER";
  const tstInfo = new pkijs.TSTInfo({ schema: inner.result });
  if (tstInfo.messageImprint.hashAlgorithm.algorithmId !== SHA256_OID) {
    return "timestamp hash algorithm is not SHA-256";
  }
  const imprint = Buffer.from(tstInfo.messageImprint.hashedMessage.getValue()).toString("hex");
  if (imprint !== expectedDigest) return "timestamp messageImprint does not match the signed canonical manifest digest";
  const signer = signed.signerInfos[0];
  const certificates = signed.certificates || [];
  if (!signer || certificates.length === 0) return "timestamp token has no signer certificate";
  const cert = certificates.find(
    (item) =>
      item instanceof pkijs.Certificate &&
      signer.sid instanceof pkijs.IssuerAndSerialNumber &&
      item.issuer.isEqual(signer.sid.issuer) &&
      item.serialNumber.isEqual(signer.sid.serialNumber),
  );
  if (!cert) return "timestamp signer certificate was not found";
  if (!hasTimestampingEku(pkijs, asn1js, cert)) return "timestamp signer certificate lacks the timestamping EKU";
  const algorithm = signatureAlgorithm(signer.signatureAlgorithm.algorithmId);
  if (!algorithm) return "timestamp signature algorithm is not supported";
  let signedBytes = content;
  if (signer.signedAttrs) {
    const digestAttr = signer.signedAttrs.attributes.find((attr) => attr.type === MESSAGE_DIGEST_OID);
    const claimed = digestAttr ? Buffer.from(digestAttr.values[0].valueBlock.valueHexView) : Buffer.alloc(0);
    const actual = Buffer.from(await webcrypto.subtle.digest("SHA-256", toArrayBuffer(content)));
    if (!claimed.equals(actual)) return "timestamp signedAttrs message-digest does not match TSTInfo";
    signedBytes = Buffer.from(signer.signedAttrs.toSchema().toBER(false));
    signedBytes[0] = 0x31;
  }
  const publicKey = await cert.getPublicKey();
  const ok = await webcrypto.subtle.verify(algorithm, publicKey, signer.signature.valueBlock.valueHexView, toArrayBuffer(signedBytes));
  if (!ok) return "timestamp CMS signature verification failed";
  if (!Array.isArray(trustedTsaCertsPem) || trustedTsaCertsPem.length === 0) {
    return "timestamp trust anchors are not configured";
  }
  let trustedCerts;
  try {
    trustedCerts = trustedTsaCertsPem.map((pem) => certificateFromPem(pkijs, asn1js, pem));
  } catch (error) {
    return `timestamp trust configuration is invalid: ${error.message}`;
  }
  try {
    const result = await new pkijs.CertificateChainValidationEngine({
      trustedCerts,
      certs: certificates.filter((item) => item instanceof pkijs.Certificate),
      checkDate: tstInfo.genTime instanceof Date ? tstInfo.genTime : new Date(),
    }).verify();
    return result.result ? null : `timestamp signer chain is not trusted: ${result.resultMessage}`;
  } catch (error) {
    return `timestamp signer chain validation failed: ${error.message}`;
  }
}

function fail(artifact, reason) {
  console.error(`FAILED [${artifact}]: ${reason}`);
  process.exit(1);
}

async function main() {
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

  // 5. RFC 3161 timestamp. The token is outside the signed manifest, so it must
  //    itself be a CMS-signed TSTInfo whose messageImprint is the SHA-256 of the
  //    canonical manifest. A substituted blob that merely contains that digest
  //    is rejected.
  const requireTimestamp = args.includes("--require-timestamp");
  let tsNote = "no timestamp.tsr";
  let tsr;
  try {
    tsr = readFileSync(join(packDir, "timestamp.tsr"));
  } catch {
    tsr = null;
  }
  if (!tsr) {
    if (requireTimestamp) fail("timestamp.tsr", "missing required RFC 3161 timestamp token");
  } else if (tsr.length === 0) {
    fail("timestamp.tsr", "timestamp.tsr is empty (0 bytes)");
  } else {
    let tsaTrust;
    try {
      tsaTrust = JSON.parse(readFileSync(join(packDir, "tsa-trust.json"), "utf8"));
    } catch {
      tsaTrust = { trustedCertsPem: [] };
    }
    let reason;
    try {
      reason = await timestampBindsManifest(tsr, sha256Hex(canonicalBytes), tsaTrust.trustedCertsPem);
    } catch (error) {
      fail("timestamp.tsr", `timestamp CMS verification unavailable: ${error.message}`);
    }
    if (reason) fail("timestamp.tsr", reason);
    tsNote = "timestamp.tsr CMS signature binds the signed canonical manifest digest";
  }

  console.log(`VERIFIED: ${diskFiles.length} artifact(s), kid=${signature.kid}, merkleRoot=${merkleRoot}`);
  console.log(tsNote);
  process.exit(0);
}

main();
