import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateStixBundle, parseStixDigestAllowlist, sha256Hex } from "@/lib/court/stix";
import { assertEvidenceAiAllowed, resolveForensicAiEndpoint } from "@/lib/court/ai-boundary";
import { buildTimeStampRequest, requestTimestampToken, verifyTimestampToken } from "@/lib/court/timestamp";
import { buildCourtReportPdf } from "@/lib/court/report";
import { buildCourtPack } from "@/lib/court/pack-builder";
import { parseKeyring, FileSigningKeyProvider } from "@/lib/court/signing";

const enc = (s: string) => new TextEncoder().encode(s);
const VERIFY_MJS = join(process.cwd(), "lib", "court", "verify.mjs");

describe("STIX digest utility (lib/court/stix.ts) — INV-030 support", () => {
  const good = sha256Hex(enc("trusted-bundle"));

  it("trusts a bundle whose digest is on the allowlist", () => {
    expect(evaluateStixBundle(enc("trusted-bundle"), good)).toEqual({ result: "trusted", digest: good });
  });
  it("marks an unknown digest untrusted (never fail-open)", () => {
    expect(evaluateStixBundle(enc("other"), good).result).toBe("untrusted");
  });
  it("returns invalid-config for empty or malformed allowlist", () => {
    expect(evaluateStixBundle(enc("x"), "").result).toBe("invalid-config");
    expect(evaluateStixBundle(enc("x"), "nothex").result).toBe("invalid-config");
    expect(parseStixDigestAllowlist(undefined).ok).toBe(false);
  });
});

describe("Local AI boundary (lib/court/ai-boundary.ts) — INV-032", () => {
  it("permits cloud outside court-grade", () => {
    expect(resolveForensicAiEndpoint({ courtGrade: false })).toEqual({ mode: "cloud-permitted" });
    expect(() => assertEvidenceAiAllowed("cloud", false)).not.toThrow();
  });
  it("requires a local endpoint and blocks cloud in court-grade", () => {
    expect(resolveForensicAiEndpoint({ courtGrade: true, localAiBaseUrl: "http://127.0.0.1:11434", localAiModel: "magistral-small" }))
      .toEqual({ mode: "local", baseUrl: "http://127.0.0.1:11434", model: "magistral-small" });
    expect(() => resolveForensicAiEndpoint({ courtGrade: true })).toThrow(/local endpoint/);
    expect(() => assertEvidenceAiAllowed("cloud", true)).toThrow(/INV-032/);
  });
});

describe("RFC 3161 timestamp (lib/court/timestamp.ts) — INV-031", () => {
  it("builds a DER TimeStampReq over the given digest", () => {
    const digest = sha256Hex(enc("merkle-root"));
    const der = buildTimeStampRequest(digest);
    expect(der.length).toBeGreaterThan(0);
    expect(der[0]).toBe(0x30); // ASN.1 SEQUENCE
  });
  it("rejects a malformed timestamp token offline", async () => {
    const result = await verifyTimestampToken(new Uint8Array([1, 2, 3, 4]), sha256Hex(enc("x")));
    expect(result.ok).toBe(false);
  });

  it("refuses a TSA token whose messageImprint is not the requested digest", async () => {
    const { webcrypto } = await import("node:crypto");
    const asn1js = await import("asn1js");
    const pkijs = await import("pkijs");
    pkijs.setEngine("node-webcrypto", new pkijs.CryptoEngine({ name: "node-webcrypto", crypto: webcrypto as unknown as Crypto }));
    const digest = Buffer.from(sha256Hex(enc("other-manifest")), "hex");
    const tst = new pkijs.TSTInfo({
      version: 1,
      policy: "1.2.3.4",
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: "2.16.840.1.101.3.4.2.1" }),
        hashedMessage: new asn1js.OctetString({ valueHex: digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength) }),
      }),
      serialNumber: new asn1js.Integer({ value: 1 }),
      genTime: new Date("2026-01-01T00:00:00Z"),
    });
    const content = new Uint8Array(tst.toSchema().toBER(false));
    const signed = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: "1.2.840.113549.1.9.16.1.4",
        eContent: new asn1js.OctetString({ valueHex: content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) }),
      }),
      signerInfos: [],
    });
    const token = new pkijs.ContentInfo({ contentType: "1.2.840.113549.1.7.2", content: signed.toSchema() });
    const response = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: token,
    });
    const body = new Uint8Array(response.toSchema().toBER(false));
    const fetchImpl = (async () => new Response(body)) as unknown as typeof fetch;
    await expect(requestTimestampToken("https://tsa.test/ts", sha256Hex(enc("requested-manifest")), fetchImpl)).rejects.toThrow(
      /messageImprint/,
    );
  });
});

describe("Court report (lib/court/report.ts)", () => {
  it("produces a deterministic, parseable PDF", async () => {
    const input = {
      caseId: "case-1",
      title: "T",
      generatedAtIso: "2026-01-01T00:00:00.000Z",
      summary: "s",
      findings: ["f1"],
      evidence: [{ path: "a.bin", sha256: "a".repeat(64) }],
      signingKid: "kid-1",
      merkleRoot: "b".repeat(64),
    };
    const a = await buildCourtReportPdf(input);
    const b = await buildCourtReportPdf(input);
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe("%PDF-");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true); // deterministic
  });
});

describe("Court Pack builder (lib/court/pack-builder.ts)", () => {
  let tmp: string;
  let keyRef: string;
  let keyring: ReturnType<typeof parseKeyring>;
  const provider = new FileSigningKeyProvider({ enforcePermissions: false });
  const KID = "court-pack-kid";

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "court-pack-"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const keyPath = join(tmp, "ed25519.pem");
    writeFileSync(keyPath, privateKey, { mode: 0o600 });
    keyRef = `file:${keyPath}`;
    keyring = parseKeyring(
      JSON.stringify([{ kid: KID, version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem: publicKey }]),
      "v1",
    );
  });

  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  async function build() {
    return buildCourtPack({
      caseId: "case-xyz",
      report: {
        caseId: "case-xyz",
        title: "Court Pack — case-xyz",
        generatedAtIso: "2026-01-01T00:00:00.000Z",
        summary: "Signed evidence package.",
        findings: ["finding one"],
        evidence: [{ path: "evidence-1.bin", sha256: "c".repeat(64) }],
      },
      chainOfCustody: { caseId: "case-xyz", ledger: [] },
      hashes: { algorithm: "SHA-256", evidence: [] },
      execution: { packVersion: 1, caseId: "case-xyz" },
      signing: { kid: KID, keyRef, keyring, revoked: new Set<string>(), provider },
      verifyMjsSource: readFileSync(VERIFY_MJS, "utf8"),
      now: new Date("2026-01-01T00:00:00Z"),
    });
  }

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

  it("does not list derived control files in the manifest (no circular hashing)", async () => {
    const pack = await build();
    const paths = pack.manifest.files.map((f) => f.path);
    expect(paths).not.toContain("signature.json");
    expect(paths).not.toContain("merkle.json");
    expect(paths).not.toContain("timestamp.tsr");
    expect(paths).not.toContain("manifest.json");
    expect(paths).toContain("report.pdf");
    expect(paths).toContain("chain-of-custody.json");
    expect(paths).toContain("verify.mjs");
  });

  it("builds a pack the standalone offline verifier accepts (no secret, no backend)", async () => {
    const pack = await build();
    const dir = join(tmp, "extract-ok");
    await extractTo(pack.zip, dir);
    expect(existsSync(join(dir, "node_modules", "pkijs", "package.json"))).toBe(true);
    const out = execFileSync("node", ["verify.mjs", "."], { cwd: dir, encoding: "utf8" });
    expect(out).toMatch(/VERIFIED/);
  });

  it("fails offline verification when a packed artifact is tampered", async () => {
    const pack = await build();
    const dir = join(tmp, "extract-tampered");
    await extractTo(pack.zip, dir);
    writeFileSync(join(dir, "chain-of-custody.json"), "{\"tampered\":true}");
    let code = 0;
    let stderr = "";
    try {
      execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const e = error as { status?: number; stderr?: string };
      code = e.status ?? 1;
      stderr = e.stderr ?? "";
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/chain-of-custody\.json/);
  });
});
