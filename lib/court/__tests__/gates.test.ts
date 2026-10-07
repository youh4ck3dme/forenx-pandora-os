import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildManifest } from "../manifest";
import { signCourtPackManifest, verifyCourtPackSignature, parseKeyring, FileSigningKeyProvider, type Keyring } from "../signing";
import { buildCourtPack } from "../pack-builder";
import { guardCloudEvidenceAi, isCourtGradeRuntime } from "../ai-boundary";
import { verifyTimestampToken } from "../timestamp";

const enc = (s: string) => new TextEncoder().encode(s);
const VERIFY_MJS = join(process.cwd(), "lib", "court", "verify.mjs");

function freshKey() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

describe("Gate 4 — INV-032 cloud AI boundary is wired fail-closed", () => {
  afterEach(() => {
    delete process.env.FORENZX_COURT_GRADE;
  });

  it("guard is a no-op outside court-grade", () => {
    delete process.env.FORENZX_COURT_GRADE;
    expect(isCourtGradeRuntime()).toBe(false);
    expect(() => guardCloudEvidenceAi("mistral")).not.toThrow();
  });

  it("guard throws in court-grade", () => {
    process.env.FORENZX_COURT_GRADE = "true";
    expect(isCourtGradeRuntime()).toBe(true);
    expect(() => guardCloudEvidenceAi("mistral")).toThrow(/INV-032/);
  });

  it("the real cloud provider call site (callMistral) is blocked in court-grade", async () => {
    process.env.FORENZX_COURT_GRADE = "true";
    const { callMistral } = await import("../../forza/ai/mistral.server");
    await expect((callMistral as (o: unknown) => Promise<unknown>)({ messages: [] })).rejects.toThrow(/INV-032/);
  });

  it("callGemini is blocked in court-grade", async () => {
    process.env.FORENZX_COURT_GRADE = "true";
    const { callGemini } = await import("../../forza/ai/gemini.server");
    await expect((callGemini as (o: unknown) => Promise<unknown>)({ messages: [] })).rejects.toThrow(/INV-032/);
  });

  it("callMistralOcr is blocked in court-grade", async () => {
    process.env.FORENZX_COURT_GRADE = "true";
    const { callMistralOcr } = await import("../../forza/ai/mistral.server");
    await expect(callMistralOcr(Buffer.from("dummy"), "test.pdf")).rejects.toThrow(/INV-032/);
  });

  it("generateMistralImage is blocked in court-grade", async () => {
    process.env.FORENZX_COURT_GRADE = "true";
    const { generateMistralImage } = await import("../../ai/mistral-client");
    await expect(generateMistralImage("forensic prompt", "fake-key")).rejects.toThrow(/INV-032/);
  });

  it("generateCompletionStream is blocked in court-grade", async () => {
    process.env.FORENZX_COURT_GRADE = "true";
    const { generateCompletionStream } = await import("../../services/ai-service");
    await expect(generateCompletionStream([], "fake-key")).rejects.toThrow(/INV-032/);
  });
});

describe("Gate 1/2/3 — Court Pack TSA fail-closed, self-contained trust, revocation", () => {
  let tmp: string;
  let keyRef: string;
  let keyring: Keyring;
  let publicKeyPem: string;
  const provider = new FileSigningKeyProvider({ enforcePermissions: false });
  const KID = "gate-kid";

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "court-gates-"));
    const { publicKey, privateKey } = freshKey();
    publicKeyPem = publicKey;
    const keyPath = join(tmp, "ed25519.pem");
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
    keyRef = `file:${keyPath}`;
    keyring = parseKeyring(
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem }]),
      "v1",
    );
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const baseInput = () => ({
    caseId: "c",
    report: { caseId: "c", title: "t", generatedAtIso: "2026-01-01T00:00:00.000Z", summary: "s", findings: [], evidence: [] },
    chainOfCustody: {},
    hashes: {},
    execution: {},
    signing: { kid: KID, keyRef, keyring, revoked: new Set<string>(), provider },
    verifyMjsSource: readFileSync(VERIFY_MJS, "utf8"),
    now: new Date("2026-01-01T00:00:00Z"),
  });

  async function extractTo(zip: Uint8Array, dir: string) {
    const archive = await JSZip.loadAsync(zip);
    mkdirSync(dir, { recursive: true });
    for (const [name, entry] of Object.entries(archive.files)) {
      if (entry.dir) continue;
      const out = join(dir, name);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, Buffer.from(await entry.async("uint8array")));
    }
  }

  // GATE 1
  it("GATE 1: court-grade build without a TSA fails closed", async () => {
    await expect(buildCourtPack({ ...baseInput(), requireTimestamp: true })).rejects.toThrow(/TSA|fail-closed/i);
  });

  // GATE 2
  it("GATE 2: the pack carries full self-contained trust context", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "g2");
    await extractTo(pack.zip, dir);
    const sig = JSON.parse(readFileSync(join(dir, "signature.json"), "utf8"));
    expect(sig.kid).toBe(KID);
    expect(typeof sig.publicKeyPem).toBe("string");
    expect(sig.keyRecord).toMatchObject({ version: 1, status: "active", validFrom: expect.any(String) });
    expect(sig.keyRecord).toHaveProperty("revokedAt");
    // Fully offline, no --keyring, no secret, no network:
    expect(execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8" })).toMatch(/VERIFIED/);
  });

  // GATE 3 (app level)
  it("GATE 3: historical pack valid before revocation, invalid after (app verifier)", () => {
    const manifest = buildManifest([{ path: "a.txt", content: enc("x") }]);
    const sig = signCourtPackManifest({ manifest, kid: KID, keyRef, keyring, revoked: new Set(), provider, now: new Date("2026-01-01T00:00:00Z") });
    const revokedKeyring = parseKeyring(
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: "2026-06-01T00:00:00Z", publicKeyPem }]),
      "v1",
    );
    // No trusted time -> fail-closed.
    expect(verifyCourtPackSignature(manifest, sig, { keyring: revokedKeyring }).ok).toBe(false);
    // Trusted time before revocation -> still valid.
    expect(verifyCourtPackSignature(manifest, sig, { keyring: revokedKeyring, asOf: new Date("2026-03-01T00:00:00Z") }).ok).toBe(true);
    // Trusted time after revocation -> invalid.
    expect(verifyCourtPackSignature(manifest, sig, { keyring: revokedKeyring, asOf: new Date("2026-09-01T00:00:00Z") }).ok).toBe(false);
  });

  // GATE 3 (offline verifier)
  it("GATE 3: offline verifier honors revocation + pre-revocation --as-of", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "g3");
    await extractTo(pack.zip, dir);
    const revokedKeyringPath = join(tmp, "revoked-keyring.json");
    writeFileSync(
      revokedKeyringPath,
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: "2026-06-01T00:00:00Z", publicKeyPem }]),
    );
    const run = (extra: string[]) => {
      try {
        execFileSync("node", [VERIFY_MJS, dir, "--keyring", revokedKeyringPath, ...extra], { encoding: "utf8", stdio: "pipe" });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? 1;
      }
    };
    expect(run([])).not.toBe(0); // revoked, no trusted time -> reject
    expect(run(["--as-of", "2026-03-01T00:00:00Z"])).toBe(0); // signed before revocation -> accept
    expect(run(["--as-of", "2026-09-01T00:00:00Z"])).not.toBe(0); // after revocation -> reject
  });

  function tsrForDigest(digestHex: string): Buffer {
    return Buffer.concat([
      Buffer.from("0609608648016503040201", "hex"),
      Buffer.from([0x04, 0x20]),
      Buffer.from(digestHex, "hex"),
    ]);
  }

  it("offline verifier rejects a timestamp blob that only contains the signed digest", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "bad-tsa");
    await extractTo(pack.zip, dir);
    const sig = JSON.parse(readFileSync(join(dir, "signature.json"), "utf8")) as { manifestSha256: string };
    writeFileSync(join(dir, "timestamp.tsr"), tsrForDigest(sig.manifestSha256));
    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--require-timestamp"], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow(/CMS|signer certificate|SignedData/);
  });

  it("offline verifier rejects a timestamp that does not bind the signed manifest", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "bad-tsa");
    await extractTo(pack.zip, dir);
    const sig = JSON.parse(readFileSync(join(dir, "signature.json"), "utf8")) as { manifestSha256: string };
    writeFileSync(join(dir, "timestamp.tsr"), tsrForDigest("ab".repeat(32)));
    expect(sig.manifestSha256).not.toBe("ab".repeat(32));
    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--require-timestamp"], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow(/messageImprint|CMS|SignedData|signer certificate/);
  });

  it("accepts a timestamp only when its TSA signer is explicitly trusted", async () => {
    const { webcrypto } = await import("node:crypto");
    const asn1js = await import("asn1js");
    const pkijs = await import("pkijs");
    pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }));
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "good-tsa");
    await extractTo(pack.zip, dir);
    const sig = JSON.parse(readFileSync(join(dir, "signature.json"), "utf8")) as { manifestSha256: string };
    const digest = Buffer.from(sig.manifestSha256, "hex");
    const rootKeys = await webcrypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const keys = await webcrypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const root = new pkijs.Certificate();
    root.version = 2;
    root.serialNumber = new asn1js.Integer({ value: 1 });
    const rootDn = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Test TSA Root" }) })];
    root.issuer.typesAndValues.push(...rootDn);
    root.subject.typesAndValues.push(...rootDn);
    root.notBefore.value = new Date("2020-01-01T00:00:00Z");
    root.notAfter.value = new Date("2030-01-01T00:00:00Z");
    root.extensions = [new pkijs.Extension({ extnID: "2.5.29.19", critical: true, extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false) })];
    await root.subjectPublicKeyInfo.importKey(rootKeys.publicKey);
    await root.sign(rootKeys.privateKey, "SHA-256");
    const cert = new pkijs.Certificate();
    cert.version = 2;
    cert.serialNumber = new asn1js.Integer({ value: 2 });
    const dn = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Test TSA" }) })];
    cert.issuer.typesAndValues.push(...rootDn);
    cert.subject.typesAndValues.push(...dn);
    cert.notBefore.value = new Date("2020-01-01T00:00:00Z");
    cert.notAfter.value = new Date("2030-01-01T00:00:00Z");
    cert.extensions = [
      new pkijs.Extension({
        extnID: "2.5.29.37",
        extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }).toSchema().toBER(false),
      }),
    ];
    await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
    await cert.sign(rootKeys.privateKey, "SHA-256");
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: "1.2.3.4",
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: "2.16.840.1.101.3.4.2.1", algorithmParams: new asn1js.Null() }),
        hashedMessage: new asn1js.OctetString({ valueHex: digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) }),
      }),
      serialNumber: new asn1js.Integer({ value: 7 }),
      genTime: new Date("2026-01-01T00:00:00Z"),
    });
    const tstBer = new Uint8Array(tst.toSchema().toBER(false));
    const signed = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: "1.2.840.113549.1.9.16.1.4",
        eContent: new asn1js.OctetString({ valueHex: tstBer.buffer.slice(tstBer.byteOffset, tstBer.byteOffset + tstBer.byteLength) }),
      }),
      certificates: [cert, root],
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }) })],
    });
    await signed.sign(keys.privateKey, 0, "SHA-256", tstBer.buffer.slice(tstBer.byteOffset, tstBer.byteOffset + tstBer.byteLength));
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
    const tokenDer = new Uint8Array(token.toSchema().toBER(false));
    const rootPem = `-----BEGIN CERTIFICATE-----\n${Buffer.from(root.toSchema().toBER(false)).toString("base64")}\n-----END CERTIFICATE-----\n`;
    const trustedResult = await verifyTimestampToken(tokenDer, sig.manifestSha256, { trustedCertsPem: [rootPem] });
    if (!trustedResult.ok) throw new Error(trustedResult.reason);
    expect(trustedResult.genTime).toBe("2026-01-01T00:00:00.000Z");
    await expect(verifyTimestampToken(tokenDer, sig.manifestSha256)).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/trust anchors/),
    });
    const attackerKeys = await webcrypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const attackerCert = new pkijs.Certificate();
    attackerCert.version = 2;
    attackerCert.serialNumber = new asn1js.Integer({ value: 99 });
    const attackerDn = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Attacker TSA" }) })];
    attackerCert.issuer.typesAndValues.push(...attackerDn);
    attackerCert.subject.typesAndValues.push(...attackerDn);
    attackerCert.notBefore.value = new Date("2020-01-01T00:00:00Z");
    attackerCert.notAfter.value = new Date("2030-01-01T00:00:00Z");
    attackerCert.extensions = [new pkijs.Extension({ extnID: "2.5.29.37", extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }).toSchema().toBER(false) })];
    await attackerCert.subjectPublicKeyInfo.importKey(attackerKeys.publicKey);
    await attackerCert.sign(attackerKeys.privateKey, "SHA-256");
    const attackerSigned = new pkijs.SignedData({
      version: 3,
      encapContentInfo: signed.encapContentInfo,
      certificates: [attackerCert],
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: attackerCert.issuer, serialNumber: attackerCert.serialNumber }) })],
    });
    await attackerSigned.sign(attackerKeys.privateKey, 0, "SHA-256", tstBer.buffer.slice(tstBer.byteOffset, tstBer.byteOffset + tstBer.byteLength));
    const attackerToken = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: attackerSigned.toSchema(true) });
    await expect(verifyTimestampToken(new Uint8Array(attackerToken.toSchema().toBER(false)), sig.manifestSha256, { trustedCertsPem: [rootPem] })).resolves.toMatchObject({
      ok: false,
      reason: expect.stringMatching(/chain is not trusted/),
    });
    writeFileSync(join(dir, "timestamp.tsr"), tokenDer);
    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--require-timestamp"], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow(/trust anchors/);
  });

  it("offline verifier rejects tampered manifest.json", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "tampered-manifest");
    await extractTo(pack.zip, dir);
    const manifestPath = join(dir, "manifest.json");
    const manifestObj = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifestObj.merkleRoot = "0000000000000000000000000000000000000000000000000000000000000000";
    writeFileSync(manifestPath, JSON.stringify(manifestObj));

    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  });

  it("offline verifier rejects tampered signature.json", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "tampered-sig");
    await extractTo(pack.zip, dir);
    const sigPath = join(dir, "signature.json");
    const sigObj = JSON.parse(readFileSync(sigPath, "utf8"));
    sigObj.signature = Buffer.from("invalidsignaturebytes").toString("base64");
    writeFileSync(sigPath, JSON.stringify(sigObj));

    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  });

  it("offline verifier rejects unknown KID when checked against keyring", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "unknown-kid");
    await extractTo(pack.zip, dir);
    const otherKeyringPath = join(tmp, "other-keyring.json");
    writeFileSync(
      otherKeyringPath,
      JSON.stringify([{ kid: "different-kid", version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", publicKeyPem }]),
    );

    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--keyring", otherKeyringPath], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  });

  it("offline verifier rejects when public key does not match trusted keyring", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "wrong-pubkey");
    await extractTo(pack.zip, dir);
    const { publicKey: otherPub } = freshKey();
    const wrongKeyringPath = join(tmp, "wrong-keyring.json");
    writeFileSync(
      wrongKeyringPath,
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", publicKeyPem: otherPub }]),
    );

    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--keyring", wrongKeyringPath], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow();
  });

  it("offline verifier fails closed when --require-timestamp is passed but timestamp.tsr is missing", async () => {
    const pack = await buildCourtPack(baseInput());
    const dir = join(tmp, "missing-tsa");
    await extractTo(pack.zip, dir);

    expect(() =>
      execFileSync("node", [VERIFY_MJS, dir, "--require-timestamp"], { encoding: "utf8", stdio: "pipe" }),
    ).toThrow(/timestamp\.tsr/);
  });
});
