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
