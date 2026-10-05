import { describe, expect, it } from "vitest";
import { buildCourtAnalysisProvenance } from "../analysis-provenance";
import { authoritativeFindingSha256 } from "@/lib/forza/autopilot-meta";

const ledger = [{ id: "e1", sha256_hash: "a".repeat(64), hash_verification_status: "verified" }];

function dossier(text: string, runId = "run-2", derived = "c".repeat(64)) {
  const value = {
    caseId: "case-1",
    caseTitle: "Spis",
    generatedAt: "2026-10-05T00:00:00.000Z",
    facts: { timeline: [{ title: text, sourceRef: { evidenceId: "e1" } }], traces: [] },
    defenseAttack: { overallRisk: "NÍZKE", attacks: [] },
    evidenceStrength: { traces: [], paragraphs: [] },
    judgeReadyText: { summary: text },
    analysisMeta: {
      idempotencyKey: runId,
      promptVersion: "2026.09.2",
      promptSha256: "b".repeat(64),
      model: "model-2",
      provider: "test-provider",
      evidenceInputs: [{ evidenceId: "e1", sha256: "a".repeat(64) }],
      derivedInputSha256: derived,
      createdAt: "2026-10-05T00:00:00.000Z",
      supersedesRunId: "run-1",
    },
  };
  return { ...value, analysisMeta: { ...value.analysisMeta, resultSha256: authoritativeFindingSha256(value) } };
}

describe("court pack analysis provenance", () => {
  it("exports the current run chain", () => {
    const result = buildCourtAnalysisProvenance(dossier("P2"), ledger);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record).toMatchObject({ selectedRunId: "run-2", supersedesRunId: "run-1", derivedInputSha256: "c".repeat(64) });
  });

  it("rejects a finding payload that does not match the stored run hash", () => {
    const current = dossier("P2");
    current.judgeReadyText = { summary: "P1" };
    expect(buildCourtAnalysisProvenance(current, ledger).ok).toBe(false);
  });

  it("rejects evidence provenance for a different verified object", () => {
    const current = dossier("P2");
    current.analysisMeta.evidenceInputs = [{ evidenceId: "e1", sha256: "d".repeat(64) }];
    current.analysisMeta.resultSha256 = authoritativeFindingSha256(current);
    expect(buildCourtAnalysisProvenance(current, ledger).ok).toBe(false);
  });

  it("rejects a historical run id reused as the current run", () => {
    const current = dossier("P2");
    (current.analysisMeta as { lineage?: unknown[] }).lineage = [{ runId: "run-2" }];
    expect(buildCourtAnalysisProvenance(current, ledger).ok).toBe(false);
  });
});

import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { buildCourtPack } from "../pack-builder";
import { FileSigningKeyProvider, parseKeyring } from "../signing";

describe("signed provenance tamper", () => {
  it("fails offline verification when provenance.json is changed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "court-provenance-"));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519", { publicKeyEncoding: { format: "pem", type: "spki" }, privateKeyEncoding: { format: "pem", type: "pkcs8" } });
    const keyPath = join(dir, "key.pem");
    writeFileSync(keyPath, privateKey);
    const keyring = parseKeyring(JSON.stringify([{ kid: "kid", version: 1, status: "active", validFrom: "2020-01-01T00:00:00Z", revokedAt: null, publicKeyPem: publicKey }]), "v1");
    const pack = await buildCourtPack({
      caseId: "case-1",
      report: { caseId: "case-1", title: "Court Pack", generatedAtIso: "2026-01-01T00:00:00.000Z", summary: "x", findings: ["run-2"], evidence: [] },
      chainOfCustody: { caseId: "case-1" },
      hashes: { algorithm: "SHA-256", evidence: [] },
      execution: { packVersion: 1 },
      provenance: { selectedRunId: "run-2", findingSha256: "a".repeat(64) },
      signing: { kid: "kid", keyRef: `file:${keyPath}`, keyring, revoked: new Set(), provider: new FileSigningKeyProvider({ enforcePermissions: false }) },
      verifyMjsSource: readFileSync(join(process.cwd(), "lib", "court", "verify.mjs"), "utf8"),
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(pack.manifest.files.map((file) => file.path)).toContain("provenance.json");
    const archive = await JSZip.loadAsync(pack.zip);
    const out = join(dir, "pack");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(out);
    for (const [name, entry] of Object.entries(archive.files)) {
      if (entry.dir) continue;
      writeFileSync(join(out, name), Buffer.from(await entry.async("uint8array")));
    }
    expect(execFileSync("node", [join(process.cwd(), "lib", "court", "verify.mjs"), out], { encoding: "utf8" })).toMatch(/VERIFIED/);
    writeFileSync(join(out, "provenance.json"), "{\"selectedRunId\":\"run-1\"}");
    expect(() => execFileSync("node", [join(process.cwd(), "lib", "court", "verify.mjs"), out], { encoding: "utf8", stdio: "pipe" })).toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
