import { describe, expect, it } from "vitest";
import { ARMIVEX_CASE_DOSSIER } from "../demo-dossier";
import {
  collectEvidenceIds,
  collectCustodyEvidenceIds,
  isBoundToEvidence,
  isValidEvidenceReference,
  partitionAdmissibilityAudit,
  partitionAlternativeHypotheses,
  partitionSuspiciousFlows,
  partitionTimeline,
} from "../evidence-binding";
import { buildReportHTML } from "../export-pdf";
import type { ForensicDossier, TimelineEvent } from "../types";

const KNOWN_DOC = "armivex-synthetic-demo";
const UNKNOWN_DOC = "hallucinated-doc-999";

function dossierWith(
  timeline: TimelineEvent[],
): ForensicDossier {
  const base: ForensicDossier = JSON.parse(JSON.stringify(ARMIVEX_CASE_DOSSIER));
  base.custodyLedger = [
    ...(base.custodyLedger ?? []),
    {
      index: 2,
      id: "CL-TEST",
      traceId: KNOWN_DOC,
      timestamp: "2026-01-01T00:00:00Z",
      actor: "Vyšetrovateľ",
      action: "SEIZURE",
      location: "Bratislava",
      payloadHash: "0".repeat(64),
      prevHash: "1".repeat(64),
      hash: "2".repeat(64),
    },
  ];
  base.facts.timeline = timeline;
  base.financialAnalysis = {
    totalVolume: 1000,
    cashVolume: 400,
    transferVolume: 600,
    cashRatioPercent: 40,
    suspiciousFlows: [
      {
        id: "flow-bound",
        date: "2026-01-05",
        payer: "Subjekt A",
        recipient: "Subjekt B",
        amount: 400,
        method: "cash_deposit",
        purpose: "Vklad hotovosti",
        redFlag: "Štruktúrované vklady",
        sourceRef: { documentId: KNOWN_DOC, page: 3 },
      },
      {
        id: "flow-unbound",
        date: "2026-01-06",
        payer: "Subjekt C",
        recipient: "Subjekt D",
        amount: 600,
        method: "wire_transfer",
        purpose: "Prevod bez dokladu",
        redFlag: "Neznámy pôvod",
      },
    ],
    financingConclusion: "Testovací záver",
  };
  return base;
}

const boundEvent: TimelineEvent = {
  time: "2026-01-05 10:00",
  event: "Zadržanie hotovosti pri kontrole",
  source: "Zápisnica č. 7",
  sourceRef: { documentId: KNOWN_DOC, page: 7, excerpt: "Zápisnica s. 7" },
  chainBreak: false,
};

const unboundEvent: TimelineEvent = {
  time: "2026-01-06 12:00",
  event: "UTOK_BEZ_OPORY_V_EVENT",
  source: "",
  chainBreak: false,
};

describe("collectEvidenceIds (P1-01)", () => {
  it("spočíta documentId z analysisMeta a traceId/id z custody ledgera", () => {
    const base = JSON.parse(
      JSON.stringify(ARMIVEX_CASE_DOSSIER),
    ) as ForensicDossier;
    base.custodyLedger = [
      {
        index: 1,
        id: "entry-1",
        traceId: "trace-abc",
        timestamp: "2026-01-01T00:00:00Z",
        actor: "Vyšetrovateľ",
        action: "SEIZURE",
        location: "Bratislava",
        payloadHash: "0".repeat(64),
        prevHash: "0".repeat(64),
        hash: "1".repeat(64),
      },
    ];
    const ids = collectEvidenceIds(base);
    const custodyEvidenceIds = collectCustodyEvidenceIds(base);
    expect(ids.has(KNOWN_DOC)).toBe(true);
    expect(ids.has("trace-abc")).toBe(true);
    expect(ids.has("entry-1")).toBe(false);
    expect(custodyEvidenceIds.has("trace-abc")).toBe(true);
    expect(custodyEvidenceIds.has("entry-1")).toBe(false);
    expect(custodyEvidenceIds.has(KNOWN_DOC)).toBe(false);
    expect(ids.has("   ")).toBe(false);
  });
});

describe("evidence references for legal conclusions", () => {
  const known = new Set([KNOWN_DOC]);
  it("requires an existing evidence ID and a concrete page or paragraph locator", () => {
    expect(
      isValidEvidenceReference(
        { evidenceId: KNOWN_DOC, page: 2 },
        known,
      ),
    ).toBe(true);
    expect(
      isValidEvidenceReference(
        { evidenceId: KNOWN_DOC, paragraph: "odsek 4" },
        known,
      ),
    ).toBe(true);
    expect(
      isValidEvidenceReference(
        { evidenceId: KNOWN_DOC, paragraph: "§ 119 ods. 2 TP" },
        known,
      ),
    ).toBe(false);
    expect(
      isValidEvidenceReference({ evidenceId: KNOWN_DOC }, known),
    ).toBe(false);
    expect(
      isValidEvidenceReference(
        { evidenceId: UNKNOWN_DOC, page: 2 },
        known,
      ),
    ).toBe(false);
    expect(
      isValidEvidenceReference(
        { evidenceId: KNOWN_DOC, page: 0 },
        known,
      ),
    ).toBe(false);
  });

  it("partitions hypotheses and audit claims fail-closed", () => {
    const dossier = JSON.parse(
      JSON.stringify(ARMIVEX_CASE_DOSSIER),
    ) as ForensicDossier;
    const hypotheses = dossier.alternativeHypotheses ?? [];
    hypotheses[0]!.sourceReferences = [{ evidenceId: KNOWN_DOC, page: 4 }];
    hypotheses[1]!.sourceReferences = [
      { evidenceId: UNKNOWN_DOC, paragraph: "odsek 3" },
    ];
    const hypothesisPartition = partitionAlternativeHypotheses(
      hypotheses,
      known,
    );
    expect(hypothesisPartition.bound.map((item) => item.id)).toEqual(["AH-1"]);
    expect(hypothesisPartition.unbound.map((item) => item.id)).toEqual(["AH-2"]);

    const audit = dossier.admissibilityAudit!;
    audit.sourceReferences = [{ evidenceId: KNOWN_DOC, paragraph: "odsek 2" }];
    audit.defects[0]!.sourceEvidenceId = KNOWN_DOC;
    audit.defects[0]!.sourcePage = 8;
    const auditPartition = partitionAdmissibilityAudit(audit, known);
    expect(auditPartition.summaryBound).toBe(true);
    expect(auditPartition.boundDefects).toHaveLength(1);
    expect(auditPartition.unboundDefects).toHaveLength(1);
  });
});

describe("isBoundToEvidence (P1-01)", () => {
  const known = new Set([KNOWN_DOC]);
  it("bez sourceRef, s prázdnym aj neznámym documentId nie je viazané", () => {
    expect(isBoundToEvidence(undefined, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: "  " }, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: UNKNOWN_DOC }, known)).toBe(false);
  });
  it("známy documentId je viazaný", () => {
    expect(isBoundToEvidence({ documentId: KNOWN_DOC, page: 1 }, known)).toBe(
      true,
    );
  });
});

describe("partition (P1-01)", () => {
  it("chronológia sa delí na zdrojované a nezdrojované udalosti", () => {
    const dossier = dossierWith([boundEvent, unboundEvent]);
    const { bound, unbound } = partitionTimeline(dossier);
    expect(bound).toEqual([boundEvent]);
    expect(unbound).toEqual([unboundEvent]);
  });

  it("toky bez dôkazu padajú do unbound (fail-closed)", () => {
    const dossier = dossierWith([boundEvent]);
    const { bound, unbound } = partitionSuspiciousFlows(dossier);
    expect(bound.map((f) => f.id)).toEqual(["flow-bound"]);
    expect(unbound.map((f) => f.id)).toEqual(["flow-unbound"]);
  });

  it("prázdna množina evidencií znamená, že nič nie je viazané", () => {
    const dossier = dossierWith([boundEvent]);
    dossier.analysisMeta = undefined;
    expect(partitionTimeline(dossier, new Set()).bound).toEqual([]);
    expect(partitionTimeline(dossier, new Set()).unbound).toEqual([boundEvent]);
  });
});

describe("export gate — bez opory nie fakt (P1-01)", () => {
  const dossier = dossierWith([boundEvent, unboundEvent]);
  const html = buildReportHTML(dossier);

  const chronologyStart = html.indexOf("<h2>Chronológia skutkov");
  const unboundStart = html.indexOf("<h2>Nezdrojované okolnosti");

  it("zdrojovaná udalosť je v skutkovej chronológií so zdrojom", () => {
    expect(chronologyStart).toBeGreaterThan(-1);
    const chronology = html.slice(chronologyStart, unboundStart);
    expect(chronology).toContain("Zadržanie hotovosti");
    expect(chronology).toContain(KNOWN_DOC);
  });

  it("nezdrojovaná udalosť NIE je v skutkovej chronológií", () => {
    expect(unboundStart).toBeGreaterThan(-1);
    const chronology = html.slice(chronologyStart, unboundStart);
    expect(chronology).not.toContain("UTOK_BEZ_OPORY_V_EVENT");
    const unboundSection = html.slice(unboundStart, unboundStart + 2000);
    expect(unboundSection).toContain("UTOK_BEZ_OPORY_V_EVENT");
    expect(unboundSection).toContain("nie sú skutkom");
  });

  it("viazaný tok je fakt so zdrojom; neviazaný tok nie je v tabuľke faktov", () => {
    const financialStart = html.indexOf("Podozrivé finančné toky");
    const unboundFlowsStart = html.indexOf("Toky bez viazania na dôkaz");
    expect(financialStart).toBeGreaterThan(-1);
    expect(unboundFlowsStart).toBeGreaterThan(financialStart);

    const factTable = html.slice(financialStart, unboundFlowsStart);
    expect(factTable).toContain("Vklad hotovosti");
    expect(factTable).toContain(KNOWN_DOC);

    // Neviazaný tok sa v tabuľke faktov neobjaví.
    expect(factTable).not.toContain("Prevod bez dokladu");
    const unboundFlows = html.slice(unboundFlowsStart);
    expect(unboundFlows).toContain("Prevod bez dokladu");
    expect(unboundFlows).toContain("nie sú skutkom");
  });

  it("sekcie bez nezdrojovaných záznamov sa nevykreslia", () => {
    const clean = dossierWith([boundEvent]);
    clean.financialAnalysis = {
      totalVolume: 400,
      cashVolume: 400,
      transferVolume: 0,
      cashRatioPercent: 100,
      suspiciousFlows: [
        {
          id: "flow-bound",
          date: "2026-01-05",
          payer: "Subjekt A",
          recipient: "Subjekt B",
          amount: 400,
          method: "cash_deposit",
          purpose: "Vklad hotovosti",
          redFlag: "Štruktúrované vklady",
          sourceRef: { documentId: KNOWN_DOC, page: 3 },
        },
      ],
      financingConclusion: "Testovací záver",
    };
    const cleanHtml = buildReportHTML(clean);
    expect(cleanHtml).not.toContain("Nezdrojované okolnosti");
    expect(cleanHtml).not.toContain("Toky bez viazania na dôkaz");
  });

  it("exportuje hypotézy a § 119 posúdenie bez väzby výhradne ako neoverené", () => {
    const dossier = dossierWith([boundEvent]);
    const html = buildReportHTML(dossier);
    const unverifiedStart = html.indexOf(
      "<h2>Neoverené tvrdenia (nie sú skutkom)</h2>",
    );
    expect(unverifiedStart).toBeGreaterThan(-1);
    const unverified = html.slice(unverifiedStart);
    expect(unverified).toContain("Finančné prostriedky boli riadnou pôžičkou");
    expect(unverified).toContain("celkový audit");
    expect(html.slice(0, unverifiedStart)).not.toContain(
      "Finančné prostriedky boli riadnou pôžičkou",
    );
    expect(html.slice(0, unverifiedStart)).not.toContain(
      "Rozpor medzi výpoveďou Petra Nováka",
    );
  });

  it("zdrojovaný audit a hypotéza sa objavia v samostatných overených sekciách", () => {
    const dossier = dossierWith([boundEvent]);
    dossier.alternativeHypotheses![0]!.sourceReferences = [
      { evidenceId: KNOWN_DOC, page: 12 },
    ];
    dossier.admissibilityAudit!.sourceReferences = [
      { evidenceId: KNOWN_DOC, paragraph: "odsek 5" },
    ];
    dossier.admissibilityAudit!.defects[0]!.sourceEvidenceId = KNOWN_DOC;
    dossier.admissibilityAudit!.defects[0]!.sourcePage = 10;
    const html = buildReportHTML(dossier);
    expect(html).toContain("Alternatívne hypotézy viazané na dôkazy");
    expect(html).toContain("Audit procesnej prípustnosti (§ 119 TP)");
    expect(html).toContain("Finančné prostriedky boli riadnou pôžičkou");
    expect(html).toContain("§ 125 TP — curable");
  });
});
