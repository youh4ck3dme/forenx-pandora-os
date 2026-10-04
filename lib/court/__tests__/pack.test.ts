import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { evaluateStixBundle, parseStixDigestAllowlist, sha256Hex } from "@/lib/court/stix";
import { assertEvidenceAiAllowed, resolveForensicAiEndpoint } from "@/lib/court/ai-boundary";
import { buildTimeStampRequest, verifyTimestampToken } from "@/lib/court/timestamp";
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
    const out = execFileSync("node", [VERIFY_MJS, dir], { encoding: "utf8" });
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
