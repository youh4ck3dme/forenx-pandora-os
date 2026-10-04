/**
 * RFC 3161 timestamping for the Court Pack (INV-031).
 *
 * - `buildTimeStampRequest` produces a DER TimeStampReq over a SHA-256 digest.
 * - `requestTimestampToken` POSTs it to a TSA and returns the DER token bytes
 *   that are written to the pack as `timestamp.tsr` (the only network step).
 * - `verifyTimestampToken` verifies the token OFFLINE: it confirms the token's
 *   messageImprint equals our digest and that the CMS SignedData signature is
 *   cryptographically valid. No secret is required — only the token itself (and
 *   optional trust anchors for full chain validation).
 *
 * The timestamp is computed over the SHA-256 of the canonical manifest bytes
 * (`signature.manifestSha256`), which is the same digest the Ed25519 signature
 * covers. That digest commits to the Merkle root. `timestamp.tsr` is NOT part of
 * the manifest, so there is no circular hashing dependency — the verifier must
 * check the token's messageImprint, not merely that the file exists.
 */
import { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const TIMESTAMPING_EKU_OID = "1.3.6.1.5.5.7.3.8";
const EXTENDED_KEY_USAGE_OID = "2.5.29.37";

let engineReady = false;
function ensureEngine(): void {
  if (engineReady) return;
  pkijs.setEngine(
    "node-webcrypto",
    new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }),
  );
  engineReady = true;
}

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

function hexToBuffer(hex: string): ArrayBuffer {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
    throw new Error("digest must be a hex string of even length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

export function buildTimeStampRequest(digestHex: string, nonce?: Uint8Array): Uint8Array {
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID }),
      hashedMessage: new asn1js.OctetString({ valueHex: hexToBuffer(digestHex) }),
    }),
    certReq: true,
  });
  if (nonce && nonce.length > 0) {
    request.nonce = new asn1js.Integer({ valueHex: toArrayBuffer(nonce) });
  }
  return new Uint8Array(request.toSchema().toBER(false));
}

export type TimestampRequestResult = {
  tsr: Uint8Array; // DER TimeStampToken (ContentInfo), written as timestamp.tsr
  genTime: string | null;
};

/** Network step: POSTs the request to the TSA and returns the token. */
export async function requestTimestampToken(
  tsaUrl: string,
  digestHex: string,
  fetchImpl: typeof fetch = fetch,
  trustedTsaCertsPem: string[] = [],
): Promise<TimestampRequestResult> {
  ensureEngine();
  const body = buildTimeStampRequest(digestHex, webcrypto.getRandomValues(new Uint8Array(16)));
  const response = await fetchImpl(tsaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/timestamp-query" },
    body: toArrayBuffer(body),
  });
  if (!response.ok) {
    throw new Error(`TSA responded with HTTP ${response.status}`);
  }
  const der = new Uint8Array(await response.arrayBuffer());
  const asn1 = asn1js.fromBER(toArrayBuffer(der));
  if (asn1.offset === -1) {
    throw new Error("TSA response is not valid DER");
  }
  const tsResp = new pkijs.TimeStampResp({ schema: asn1.result });
  if (tsResp.status.status !== 0 && tsResp.status.status !== 1) {
    throw new Error(`TSA rejected the request (PKIStatus ${tsResp.status.status})`);
  }
  if (!tsResp.timeStampToken) {
    throw new Error("TSA response contained no timeStampToken");
  }
  const tokenDer = new Uint8Array(tsResp.timeStampToken.toSchema().toBER(false));
  const parsed = parseToken(tokenDer);
  if (!timestampBindsDigest(parsed.tstInfo, digestHex)) {
    throw new Error("TSA token messageImprint does not match the signed canonical manifest digest");
  }
  const trust = await timestampTrustResult(parsed.signed, parsed.content, parsed.tstInfo, trustedTsaCertsPem);
  if (trust) {
    throw new Error(trust);
  }

  const genTime = parsed.tstInfo.genTime instanceof Date ? parsed.tstInfo.genTime.toISOString() : null;
  return { tsr: tokenDer, genTime };
}

function certificateFromPem(pem: string): pkijs.Certificate {
  const body = pem.replace(/-----(?:BEGIN|END) CERTIFICATE-----|\s/g, "");
  if (!body) throw new Error("trusted TSA certificate is not PEM");
  const der = Buffer.from(body, "base64");
  const asn1 = asn1js.fromBER(toArrayBuffer(der));
  if (asn1.offset === -1) throw new Error("trusted TSA certificate is not valid DER");
  return new pkijs.Certificate({ schema: asn1.result });
}

function hasTimestampingEku(cert: pkijs.Certificate): boolean {
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

async function timestampTrustResult(
  signed: pkijs.SignedData,
  content: Uint8Array,
  tstInfo: pkijs.TSTInfo,
  trustedTsaCertsPem: string[],
): Promise<string | null> {
  if (trustedTsaCertsPem.length === 0) return "timestamp trust anchors are not configured";
  if (!(await cmsSignatureMatches(signed, content))) return "timestamp CMS signature verification failed";
  const signer = signed.signerInfos[0];
  const certificates = signed.certificates ?? [];
  const cert = signer && certificates.find(
    (item): item is pkijs.Certificate =>
      item instanceof pkijs.Certificate &&
      signer.sid instanceof pkijs.IssuerAndSerialNumber &&
      item.issuer.isEqual(signer.sid.issuer) &&
      item.serialNumber.isEqual(signer.sid.serialNumber),
  );
  if (!cert) return "timestamp signer certificate was not found";
  if (!hasTimestampingEku(cert)) return "timestamp signer certificate lacks the timestamping EKU";
  let trustedCerts: pkijs.Certificate[];
  try {
    trustedCerts = trustedTsaCertsPem.map(certificateFromPem);
  } catch (error) {
    return `timestamp trust configuration is invalid: ${(error as Error).message}`;
  }
  const checkDate = tstInfo.genTime instanceof Date ? tstInfo.genTime : new Date();
  try {
    const result = await new pkijs.CertificateChainValidationEngine({
      trustedCerts,
      certs: certificates.filter((item): item is pkijs.Certificate => item instanceof pkijs.Certificate),
      checkDate,
    }).verify();
    return result.result ? null : `timestamp signer chain is not trusted: ${result.resultMessage}`;
  } catch (error) {
    return `timestamp signer chain validation failed: ${(error as Error).message}`;
  }
}

function parseToken(tsrBytes: Uint8Array): { signed: pkijs.SignedData; tstInfo: pkijs.TSTInfo; content: Uint8Array } {
  const asn1 = asn1js.fromBER(toArrayBuffer(tsrBytes));
  if (asn1.offset === -1) {
    throw new Error("timestamp.tsr is not valid DER");
  }
  const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
  if (contentInfo.contentType !== "1.2.840.113549.1.7.2") {
    throw new Error("timestamp token is not CMS SignedData");
  }
  const signed = new pkijs.SignedData({ schema: contentInfo.content });
  if (!signed.encapContentInfo.eContent) {
    throw new Error("timestamp token has no eContent");
  }
  const eContent = new Uint8Array(signed.encapContentInfo.eContent.getValue());
  const inner = asn1js.fromBER(toArrayBuffer(eContent));
  if (inner.offset === -1) {
    throw new Error("timestamp TSTInfo is not valid DER");
  }
  const tstInfo = new pkijs.TSTInfo({ schema: inner.result });
  return { signed, tstInfo, content: eContent };
}

const MESSAGE_DIGEST_OID = "1.2.840.113549.1.9.4";

function signatureAlgorithm(oid: string): Algorithm | EcdsaParams | null {
  if (oid === "1.2.840.113549.1.1.11" || oid === "1.2.840.113549.1.1.1") return { name: "RSASSA-PKCS1-v1_5" };
  if (oid === "1.2.840.1.101.3.4.3.2") return { name: "ECDSA", hash: "SHA-256" };
  return null;
}

/** CMS signature over the encapsulated TSTInfo, including signedAttrs when present. */
async function cmsSignatureMatches(signed: pkijs.SignedData, content: Uint8Array): Promise<boolean> {
  const signer = signed.signerInfos[0];
  const certificates = signed.certificates ?? [];
  if (!signer || certificates.length === 0) return false;
  const cert = certificates.find(
    (item): item is pkijs.Certificate =>
      item instanceof pkijs.Certificate &&
      signer.sid instanceof pkijs.IssuerAndSerialNumber &&
      item.issuer.isEqual(signer.sid.issuer) &&
      item.serialNumber.isEqual(signer.sid.serialNumber),
  );
  if (!cert) return false;
  const algorithm = signatureAlgorithm(signer.signatureAlgorithm.algorithmId);
  if (!algorithm) return false;
  let signedBytes: Uint8Array = content;
  if (signer.signedAttrs) {
    const digestAttr = signer.signedAttrs.attributes.find((attr) => attr.type === MESSAGE_DIGEST_OID);
    const claimed = digestAttr ? new Uint8Array(digestAttr.values[0]?.valueBlock?.valueHexView ?? []) : new Uint8Array();
    const actual = new Uint8Array(await webcrypto.subtle.digest("SHA-256", toArrayBuffer(content)));
    if (claimed.length !== actual.length || claimed.some((byte, index) => byte !== actual[index])) return false;
    signedBytes = new Uint8Array(signer.signedAttrs.toSchema().toBER(false));
    signedBytes[0] = 0x31;
  }
  try {
    const publicKey = await cert.getPublicKey();
    return await webcrypto.subtle.verify(algorithm, publicKey, new Uint8Array(signer.signature.valueBlock.valueHexView), toArrayBuffer(signedBytes));
  } catch {
    return false;
  }
}

function timestampBindsDigest(tstInfo: pkijs.TSTInfo, digestHex: string): boolean {
  if (tstInfo.messageImprint.hashAlgorithm.algorithmId !== SHA256_OID) return false;
  const imprint = new Uint8Array(tstInfo.messageImprint.hashedMessage.getValue());
  const expected = new Uint8Array(hexToBuffer(digestHex));
  if (imprint.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < imprint.length; i += 1) mismatch |= (imprint[i] ?? 0) ^ (expected[i] ?? 0);
  return mismatch === 0;
}

export type TimestampVerifyResult =
  | { ok: true; genTime: string | null }
  | { ok: false; reason: string };

/**
 * Offline verification. Confirms the token timestamps exactly our digest and
 * that the CMS signature is valid and that its signer chains to explicit TSA
 * trust anchors. Trust is mandatory; a self-signed or otherwise untrusted signer
 * is never accepted merely because its embedded certificate verifies the CMS.
 */
export async function verifyTimestampToken(
  tsrBytes: Uint8Array,
  digestHex: string,
  options?: { trustedCertsPem?: string[] },
): Promise<TimestampVerifyResult> {
  ensureEngine();
  let signed: pkijs.SignedData;
  let tstInfo: pkijs.TSTInfo;
  let content: Uint8Array;
  try {
    ({ signed, tstInfo, content } = parseToken(tsrBytes));
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  // The digest is SHA-256 of the canonical manifest bytes (signature.manifestSha256).
  if (!timestampBindsDigest(tstInfo, digestHex)) {
    return { ok: false, reason: "timestamp messageImprint does not match the signed canonical manifest digest" };
  }

  // pkijs SignedData.verify() mis-parses RFC 3161 eContent (OCTET STRING of TSTInfo)
  // and rejects valid tokens. Verify the CMS signature over the encapsulated content.
  const trust = await timestampTrustResult(signed, content, tstInfo, options?.trustedCertsPem ?? []);
  if (trust) return { ok: false, reason: trust };

  return { ok: true, genTime: tstInfo.genTime instanceof Date ? tstInfo.genTime.toISOString() : null };
}
