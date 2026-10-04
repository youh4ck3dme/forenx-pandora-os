import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FileSigningKeyProvider, parseKeyring } from "@/lib/court/signing";
import { buildCourtPack } from "@/lib/court/pack-builder";

const h = vi.hoisted(() => ({
  auth: { userId: "user-1", token: "trusted-token", devBypass: false } as
    | { userId: string; token: string | null; devBypass: boolean }
    | { userId: null; token: null; error: string; status: number },
  ledger: [] as Array<Record<string, unknown>>,
  courtGrade: true,
  signing: null as unknown,
  ledgerCalls: [] as Array<[string, string]>,
  caseCalls: [] as Array<[string, string, string]>,
}));

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () => h.auth),
}));
vi.mock("@/lib/storage/evidence-ledger", () => ({
  listLedgerEvidence: vi.fn(async (token: string, caseId: string) => {
    h.ledgerCalls.push([token, caseId]);
    return h.ledger;
  }),
  loadOwnedCaseSummary: vi.fn(async (token: string, userId: string, caseId: string) => {
    h.caseCalls.push([token, userId, caseId]);
    if (caseId === "missing-case" || caseId === "foreign-case") return null;
    if (userId !== "user-1") return null;
    return { id: caseId, name: "Case One" };
  }),
}));
vi.mock("@/lib/court/pack-builder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/court/pack-builder")>("@/lib/court/pack-builder");
  return {
    buildCourtPack: vi.fn((input: Parameters<typeof actual.buildCourtPack>[0]) => actual.buildCourtPack(input)),
  };
});
vi.mock("@/lib/court/signing-context", () => ({
  courtGradeEnabled: () => h.courtGrade,
  getCourtSigningContext: () => h.signing,
}));
// TSA crypto is unit-tested in timestamp/gates; here we stub the network token so
// the court-grade (requireTimestamp) path can produce a pack deterministically.
// The stub still binds messageImprint to the digest the builder requested.
vi.mock("@/lib/court/timestamp", () => ({
  requestTimestampToken: vi.fn(async (_url: string, digestHex: string) => {
    const { webcrypto } = await import("node:crypto");
    const asn1js = await import("asn1js");
    const pkijs = await import("pkijs");
    pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }));
    const digest = Buffer.from(digestHex, "hex");
    const { certificate, privateKey, root } = tsaFixture;
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
      certificates: [certificate, root],
      signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }) })],
    });
    await signed.sign(privateKey, 0, "SHA-256", tstBer.buffer.slice(tstBer.byteOffset, tstBer.byteOffset + tstBer.byteLength));
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema(true) });
    return { tsr: new Uint8Array(token.toSchema().toBER(false)), genTime: "2026-01-01T00:00:00.000Z" };
  }),
}));

const VERIFY_MJS = join(process.cwd(), "lib", "court", "verify.mjs");
const KID = "route-kid";
let tmp: string;
let tsaFixture: Awaited<ReturnType<typeof createTsaFixture>>;

async function createTsaFixture() {
  const { webcrypto } = await import("node:crypto");
  const asn1js = await import("asn1js");
  const pkijs = await import("pkijs");
  pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }));
  const algorithm = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
  const usages: KeyUsage[] = ["sign", "verify"];
  const rootKeys = await webcrypto.subtle.generateKey(algorithm, true, usages);
  const signerKeys = await webcrypto.subtle.generateKey(algorithm, true, usages);
  const rootDn = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Test TSA Root" }) })];
  const root = new pkijs.Certificate();
  root.version = 2;
  root.serialNumber = new asn1js.Integer({ value: 1 });
  root.issuer.typesAndValues.push(...rootDn);
  root.subject.typesAndValues.push(...rootDn);
  root.notBefore.value = new Date("2020-01-01T00:00:00Z");
  root.notAfter.value = new Date("2030-01-01T00:00:00Z");
  root.extensions = [new pkijs.Extension({ extnID: "2.5.29.19", critical: true, extnValue: new pkijs.BasicConstraints({ cA: true }).toSchema().toBER(false) })];
  await root.subjectPublicKeyInfo.importKey(rootKeys.publicKey);
  await root.sign(rootKeys.privateKey, "SHA-256");

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 2 });
  const signerDn = [new pkijs.AttributeTypeAndValue({ type: "2.5.4.3", value: new asn1js.Utf8String({ value: "Test TSA" }) })];
  certificate.issuer.typesAndValues.push(...rootDn);
  certificate.subject.typesAndValues.push(...signerDn);
  certificate.notBefore.value = new Date("2020-01-01T00:00:00Z");
  certificate.notAfter.value = new Date("2030-01-01T00:00:00Z");
  certificate.extensions = [new pkijs.Extension({ extnID: "2.5.29.37", extnValue: new pkijs.ExtKeyUsage({ keyPurposes: ["1.3.6.1.5.5.7.3.8"] }).toSchema().toBER(false) })];
  await certificate.subjectPublicKeyInfo.importKey(signerKeys.publicKey);
  await certificate.sign(rootKeys.privateKey, "SHA-256");

  return {
    root,
    certificate,
    privateKey: signerKeys.privateKey,
    rootPem: `-----BEGIN CERTIFICATE-----\n${Buffer.from(root.toSchema().toBER(false)).toString("base64")}\n-----END CERTIFICATE-----\n`,
  };
}

function ledgerRow(over: Partial<Record<string, unknown>>) {
  return {
    id: "e1",
    case_id: "case-1",
    case_name: "Case One",
    file_name: "evidence-1.bin",
    file_size: 10,
    mime_type: "application/octet-stream",
    s3_object_key: "cases/case-1/e1.bin",
    sha256_hash: "a".repeat(64),
    hash_verification_status: "verified",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "court-route-"));
  tsaFixture = await createTsaFixture();
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const keyPath = join(tmp, "ed25519.pem");
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  h.signing = {
    kid: KID,
    keyRef: `file:${keyPath}`,
    keyring: parseKeyring(
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem: publicKey }]),
      "v1",
    ),
    revoked: new Set<string>(),
    provider: new FileSigningKeyProvider({ enforcePermissions: false }),
    tsaUrl: "https://tsa.test/ts", // stubbed by the timestamp mock
    trustedTsaCerts: [tsaFixture.rootPem],
  };
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

beforeEach(() => {
  h.auth = { userId: "user-1", token: "trusted-token", devBypass: false };
  h.ledger = [];
  h.courtGrade = true;
  h.ledgerCalls = [];
  h.caseCalls = [];
  vi.mocked(buildCourtPack).mockClear();
});

async function post(caseId: string, body?: unknown) {
  const { POST } = await import("@/app/api/cases/[id]/court-pack/route");
  const req = new NextRequest("http://localhost/api/cases/case-1/court-pack", {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  return POST(req, { params: Promise.resolve({ id: caseId }) });
}

async function extract(zip: Uint8Array): Promise<Record<string, string>> {
  const archive = await JSZip.loadAsync(zip);
  const out: Record<string, string> = {};
  const dir = mkdtempSync(join(tmp, "x-"));
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const abs = join(dir, name);
    mkdirSync(dirname(abs), { recursive: true });
    const bytes = Buffer.from(await entry.async("uint8array"));
    writeFileSync(abs, bytes);
    out[name] = bytes.toString("utf8");
  }
  out.__dir = dir;
  return out;
}

describe("Gate 5 — Court Pack route provenance & E2E", () => {
  it("authenticated investigator → case → verified ledger → pack → offline verify", async () => {
    h.ledger = [ledgerRow({ file_name: "verified-a.bin", sha256_hash: "a".repeat(64) })];
    const res = await post("case-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");

    const zip = new Uint8Array(await res.arrayBuffer());
    const files = await extract(zip);
    expect(execFileSync("node", [VERIFY_MJS, files.__dir], { encoding: "utf8" })).toMatch(/VERIFIED/);
    expect(files["hashes.json"]).toContain("verified-a.bin");
    const custody = JSON.parse(files["chain-of-custody.json"]);
    expect(custody.caseName).toBe("Case One");
    // ledger and case metadata were queried with the request token, user, and case id
    expect(h.ledgerCalls).toEqual([["trusted-token", "case-1"]]);
    expect(h.caseCalls).toEqual([["trusted-token", "user-1", "case-1"]]);
    expect(buildCourtPack).toHaveBeenCalledTimes(1);
  });

  it("uses SERVER-authoritative ledger, never client-supplied evidence", async () => {
    h.ledger = [ledgerRow({ file_name: "server-truth.bin" })];
    const res = await post("case-1", { evidence: [{ fileName: "CLIENT-FAKE.txt", sha256: "f".repeat(64) }] });
    expect(res.status).toBe(200);
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    expect(files["hashes.json"]).toContain("server-truth.bin");
    expect(files["hashes.json"]).not.toContain("CLIENT-FAKE");
    expect(files["chain-of-custody.json"]).not.toContain("CLIENT-FAKE");
  });

  it("excludes unverified evidence from the report evidence set", async () => {
    h.ledger = [ledgerRow({ file_name: "ok.bin", hash_verification_status: "verified" }), ledgerRow({ id: "e2", file_name: "bad.bin", hash_verification_status: "mismatch" })];
    const res = await post("case-1");
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    const execution = JSON.parse(files["execution.json"]);
    expect(execution.evidenceCount).toBe(2);
    expect(execution.verifiedCount).toBe(1);
  });

  it("rejects an unauthenticated request (401)", async () => {
    h.auth = { userId: null, token: null, error: "no auth", status: 401 };
    const res = await post("case-1");
    expect(res.status).toBe(401);
  });

  it("rejects when not in court-grade mode (409)", async () => {
    h.courtGrade = false;
    const res = await post("case-1");
    expect(res.status).toBe(409);
  });

  it("rejects an invalid case id (400)", async () => {
    const res = await post("bad id!!");
    expect(res.status).toBe(400);
  });

  it("builds a valid (empty-evidence) pack when the case has no ledger evidence", async () => {
    h.ledger = [];
    const res = await post("case-1");
    expect(res.status).toBe(200);
    const files = await extract(new Uint8Array(await res.arrayBuffer()));
    expect(JSON.parse(files["execution.json"]).evidenceCount).toBe(0);
    expect(execFileSync("node", [VERIFY_MJS, files.__dir], { encoding: "utf8" })).toMatch(/VERIFIED/);
  });

  it("returns 404 and does not build a ZIP when the case is missing", async () => {
    h.ledger = [ledgerRow({ file_name: "should-not-pack.bin" })];
    const res = await post("missing-case");
    expect(res.status).toBe(404);
    expect(h.caseCalls).toEqual([["trusted-token", "user-1", "missing-case"]]);
    expect(buildCourtPack).not.toHaveBeenCalled();
    const missing = await res.json();

    h.caseCalls = [];
    const foreign = await post("foreign-case");
    expect(foreign.status).toBe(404);
    expect(h.caseCalls).toEqual([["trusted-token", "user-1", "foreign-case"]]);
    expect(buildCourtPack).not.toHaveBeenCalled();
    expect(await foreign.json()).toEqual(missing);
  });

  it("returns 404 and does not build a ZIP when the case is not owned", async () => {
    h.ledger = [ledgerRow({ file_name: "should-not-pack.bin" })];
    const res = await post("foreign-case");
    expect(res.status).toBe(404);
    expect(h.caseCalls).toEqual([["trusted-token", "user-1", "foreign-case"]]);
    expect(buildCourtPack).not.toHaveBeenCalled();
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });
});
