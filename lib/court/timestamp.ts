/**
 * RFC 3161 timestamping for the Court Pack Merkle root (INV-031).
 *
 * - `buildTimeStampRequest` produces a DER TimeStampReq over a SHA-256 digest.
 * - `requestTimestampToken` POSTs it to a TSA and returns the DER token bytes
 *   that are written to the pack as `timestamp.tsr` (the only network step).
 * - `verifyTimestampToken` verifies the token OFFLINE: it confirms the token's
 *   messageImprint equals our digest and that the CMS SignedData signature is
 *   cryptographically valid. No secret is required — only the token itself (and
 *   optional trust anchors for full chain validation).
 *
 * The timestamp is computed over the Merkle root, which is derived from the
 * signed manifest — `timestamp.tsr` is NOT part of the manifest, so there is no
 * circular hashing dependency.
 */
import { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const SHA256_OID = "2.16.840.1.101.3.4.2.1";

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
  const genTime = extractGenTime(tokenDer);
  return { tsr: tokenDer, genTime };
}

function parseToken(tsrBytes: Uint8Array): { signed: pkijs.SignedData; tstInfo: pkijs.TSTInfo } {
  const asn1 = asn1js.fromBER(toArrayBuffer(tsrBytes));
  if (asn1.offset === -1) {
    throw new Error("timestamp.tsr is not valid DER");
  }
  const contentInfo = new pkijs.ContentInfo({ schema: asn1.result });
  const signed = new pkijs.SignedData({ schema: contentInfo.content });
  if (!signed.encapContentInfo.eContent) {
    throw new Error("timestamp token has no eContent");
  }
  const eContent = signed.encapContentInfo.eContent.getValue();
  const inner = asn1js.fromBER(eContent);
  if (inner.offset === -1) {
    throw new Error("timestamp TSTInfo is not valid DER");
  }
  const tstInfo = new pkijs.TSTInfo({ schema: inner.result });
  return { signed, tstInfo };
}

function extractGenTime(tsrBytes: Uint8Array): string | null {
  try {
    const { tstInfo } = parseToken(tsrBytes);
    return tstInfo.genTime instanceof Date ? tstInfo.genTime.toISOString() : null;
  } catch {
    return null;
  }
}

export type TimestampVerifyResult =
  | { ok: true; genTime: string | null }
  | { ok: false; reason: string };

/**
 * Offline verification. Confirms the token timestamps exactly our digest and
 * that the CMS signature is valid. `trustedCerts` enables full chain validation;
 * without them the signature math is still checked against the embedded signer
 * certificate (leaf), which is reported as `signatureValid` but not chain-trusted.
 */
export async function verifyTimestampToken(
  tsrBytes: Uint8Array,
  digestHex: string,
  options?: { trustedCerts?: pkijs.Certificate[] },
): Promise<TimestampVerifyResult> {
  ensureEngine();
  let signed: pkijs.SignedData;
  let tstInfo: pkijs.TSTInfo;
  try {
    ({ signed, tstInfo } = parseToken(tsrBytes));
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  // 1. messageImprint MUST equal our digest (binds the token to this pack).
  const imprint = new Uint8Array(tstInfo.messageImprint.hashedMessage.getValue());
  const expected = new Uint8Array(hexToBuffer(digestHex));
  if (imprint.length !== expected.length || !imprint.every((b, i) => b === expected[i])) {
    return { ok: false, reason: "timestamp messageImprint does not match the pack Merkle-root digest" };
  }

  // 2. CMS SignedData signature MUST verify. pkijs v3 verify() resolves to a
  //    boolean unless `extended` is requested.
  try {
    const verified = await signed.verify({
      signer: 0,
      trustedCerts: options?.trustedCerts ?? [],
      checkChain: Boolean(options?.trustedCerts && options.trustedCerts.length > 0),
    });
    if (!verified) {
      return { ok: false, reason: "timestamp CMS signature verification failed" };
    }
  } catch (error) {
    return { ok: false, reason: `timestamp signature verification error: ${(error as Error).message}` };
  }

  return { ok: true, genTime: tstInfo.genTime instanceof Date ? tstInfo.genTime.toISOString() : null };
}
