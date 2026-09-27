import { describe, expect, it } from "vitest";
import { ARMIVEX_CASE_DOSSIER } from "../demo-dossier";
import {
  collectEvidenceIds,
  isBoundToEvidence,
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
    expect(ids.has(KNOWN_DOC)).toBe(true);
    expect(ids.has("trace-abc")).toBe(true);
    expect(ids.has("entry-1")).toBe(true);
    expect(ids.has("   ")).toBe(false);
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
});
