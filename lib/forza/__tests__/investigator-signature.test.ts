import { describe, expect, it } from "vitest";
import { sha256Hex } from "../provenance/sha256";
import {
  buildInvestigatorSignature,
  verifyInvestigatorSignature,
  type InvestigatorSignature,
} from "../investigator-signature";
import {
  buildReportPackage,
  computeDossierSha256,
  computeReportSha256,
  stripEmbeddedManifest,
  stripEmbeddedSignature,
  withEmbeddedSignature,
} from "../export-pdf";
import { ARMIVEX_CASE_DOSSIER } from "../demo-dossier";

const REPORT_TEXT = "<!DOCTYPE html><html><body><h1>Report</h1></body></html>";
const DOSSIER_SHA = sha256Hex("dossier");
const MANIFEST_SHA = sha256Hex("manifest");

function sign(overrides?: {
  signature?: Partial<InvestigatorSignature>;
  webauthn?: { credentialId: string; clientDataHash: string };
}): InvestigatorSignature {
  const base = buildInvestigatorSignature({
    investigatorId: "vysetrovatel-1",
    investigatorName: "JUDr. Horký",
    caseId: "CASE-KS-2026-881",
    signedAt: "2026-09-27T12:00:00+00:00",
    dossierSha256: DOSSIER_SHA,
    reportSha256: sha256Hex(REPORT_TEXT),
    manifestSha256: MANIFEST_SHA,
    reportText: REPORT_TEXT,
    webauthn: overrides?.webauthn,
  });
  return { ...base, ...overrides?.signature };
}

describe("P1-01 — digitálny podpis vyšetrovateľa", () => {
  it("platný podpis prejde nezávislou verifikáciou", () => {
    const signature = sign();
    const result = verifyInvestigatorSignature(signature, {
      reportText: REPORT_TEXT,
      dossierSha256: DOSSIER_SHA,
      manifestSha256: MANIFEST_SHA,
    });
    expect(result.valid).toBe(true);
    expect(result.problems).toEqual([]);
    expect(signature.version).toBe("forenx-investigator-signature-v1");
    expect(signature.chainHash).not.toBe(signature.signatureHash);
  });

  it("zmenený text reportu preruší hash-chain", () => {
    const signature = sign();
    const result = verifyInvestigatorSignature(signature, {
      reportText: `${REPORT_TEXT}<p>doplnok po podpise</p>`,
      dossierSha256: DOSSIER_SHA,
      manifestSha256: MANIFEST_SHA,
    });
    expect(result.valid).toBe(false);
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining("reportSha256"),
        expect.stringContaining("prerušený"),
      ]),
    );
  });

  it("zmenený podpisový blok (meno, čas, manifest) zneplatní podpis", () => {
    for (const tampered of [
      sign({ signature: { investigatorName: "JUDr. Podvržený" } }),
      sign({ signature: { signedAt: "2026-09-28T10:00:00+00:00" } }),
      sign({ signature: { manifestSha256: sha256Hex("iny-manifest") } }),
    ]) {
      const result = verifyInvestigatorSignature(tampered, {
        reportText: REPORT_TEXT,
        dossierSha256: DOSSIER_SHA,
        manifestSha256: MANIFEST_SHA,
      });
      expect(result.valid).toBe(false);
      expect(result.problems.length).toBeGreaterThan(0);
    }
  });

  it("WebAuthn väzba je súčasťou podpisu", () => {
    const bound = sign({
      webauthn: { credentialId: "cred-abc", clientDataHash: "a".repeat(64) },
    });
    expect(bound.webauthn?.credentialId).toBe("cred-abc");

    const ok = verifyInvestigatorSignature(bound, {
      reportText: REPORT_TEXT,
      dossierSha256: DOSSIER_SHA,
      manifestSha256: MANIFEST_SHA,
    });
    expect(ok.valid).toBe(true);

    const swapped = sign({
      signature: {
        webauthn: { credentialId: "cred-XYZ", clientDataHash: "a".repeat(64) },
      },
    });
    const bad = verifyInvestigatorSignature(swapped, {
      reportText: REPORT_TEXT,
      dossierSha256: DOSSIER_SHA,
      manifestSha256: MANIFEST_SHA,
    });
    expect(bad.valid).toBe(false);
  });

  it("embed/strip podpisového bloku je reverzibilný", () => {
    const signature = sign();
    const embedded = withEmbeddedSignature(REPORT_TEXT, signature);
    expect(embedded).toContain("Digitálny podpis vyšetrovateľa");
    expect(embedded).toContain(signature.chainHash);
    expect(embedded).toContain(signature.investigatorName);

    const stripped = stripEmbeddedSignature(embedded);
    expect(stripped).toBe(REPORT_TEXT);
  });

  it("end-to-end: podpísaný export dossiera prejde verifikáciou po stripnutí", () => {
    const dossier = ARMIVEX_CASE_DOSSIER;
    const pkg = buildReportPackage(dossier);

    const signature = buildInvestigatorSignature({
      investigatorId: "vysetrovatel-1",
      investigatorName: "JUDr. Horký",
      caseId: dossier.caseId,
      dossierSha256: computeDossierSha256(dossier),
      reportSha256: computeReportSha256(pkg.html),
      manifestSha256: pkg.manifestSha256,
      reportText: pkg.html,
    });

    const signedHtml = withEmbeddedSignature(pkg.html, signature);
    // Simulácia finálneho dokumentu aj jeho reverznej analýzy.
    const restored = stripEmbeddedSignature(stripEmbeddedManifest(signedHtml));
    expect(restored).toBe(pkg.html);

    const result = verifyInvestigatorSignature(signature, {
      reportText: restored,
      dossierSha256: computeDossierSha256(dossier),
      manifestSha256: pkg.manifestSha256,
    });
    expect(result.valid).toBe(true);

    // Manipulácia s jedným znakom reportu zneplatní podpis.
    const tampered = verifyInvestigatorSignature(signature, {
      reportText: `${pkg.html} `,
      dossierSha256: computeDossierSha256(dossier),
      manifestSha256: pkg.manifestSha256,
    });
    expect(tampered.valid).toBe(false);
  });
});
