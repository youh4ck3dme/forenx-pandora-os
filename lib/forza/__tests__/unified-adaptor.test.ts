import { describe, it, expect } from "vitest";
import {
  isForensicCaseUnified,
  mapUnifiedToForensicCase,
  mapUnifiedToForensicDossier,
  mapForensicCaseToUnified,
  type ForensicCaseUnified,
} from "../unified-adaptor";
import { analyzeCase } from "../forensic";

describe("ForensicCaseUnified Adaptor Layer", () => {
  const sampleUnified: ForensicCaseUnified = {
    version: "2.0.0",
    id: "case-alpha-1",
    title: "Operácia Tiger",
    subtitle: "Forenzné vyšetrovanie reťazca",
    referenceDate: "2026-09-27",
    baseCurrency: "EUR",
    entities: [
      {
        id: "ent-1",
        name: "Subjekt A s.r.o.",
        kind: "company",
        role: "distribútor",
        country: "SK",
        ico: "12345678",
        x: 100,
        y: 150,
      },
      {
        id: "ent-2",
        name: "Ján Novák",
        kind: "person",
        role: "konateľ",
        country: "SK",
        x: 200,
        y: 250,
      },
    ],
    transactions: [
      {
        id: "tx-1",
        date: "2026-09-27",
        amount: 50000,
        currency: "EUR",
        fromId: "ent-1",
        toId: "ent-2",
        method: "transfer",
        purpose: "Konzultácie a prevod zisku",
      },
    ],
    weapons: [
      {
        id: "wp-1",
        brand: "Glock",
        model: "17",
        serial: "GL123456",
        holderId: "ent-2",
      },
    ],
    relations: [
      {
        fromId: "ent-2",
        toId: "ent-1",
        label: "štatutár",
      },
    ],
    events: [
      {
        date: "2026-09-27",
        title: "Razia NAKA",
        detail: "Zaistené účtovné doklady a zbrane",
        severity: "critical",
      },
    ],
    registries: {
      europolSerials: ["GL123456"],
      validLicences: ["LIC-SK-999"],
      orsrAddresses: { "12345678": "Bratislava, Prievozská 6" },
    },
    dossier: {
      caseId: "case-alpha-1",
      caseTitle: "Operácia Tiger",
      defendabilityIndex: 85,
      generatedAt: "2026-09-27T00:00:00.000Z",
      facts: {
        timeline: [],
        traces: [],
      },
      defenseAttack: {
        overallRisk: "VYSOKÉ",
        attacks: [],
      },
      evidenceStrength: {
        traces: [],
        paragraphs: [],
      },
      judgeReadyText: {
        skutkovyStav: "Obžaloba preukazuje nezákonné prevody.",
        vyporiadanie: "Obhajoba nepreukázala legálny pôvod financií.",
        vedecke: "Digitálne stopy a transakčné logy sú autentické.",
      },
    },
  };

  it("isForensicCaseUnified správne validuje štruktúru prípadu", () => {
    expect(isForensicCaseUnified(sampleUnified)).toBe(true);
    expect(isForensicCaseUnified(null)).toBe(false);
    expect(isForensicCaseUnified({})).toBe(false);
    expect(isForensicCaseUnified({ id: "123" })).toBe(false);
  });

  it("mapUnifiedToForensicCase namapuje model kompatibilný s analyzeCase", () => {
    const forensicCase = mapUnifiedToForensicCase(sampleUnified);
    expect(forensicCase.id).toBe("case-alpha-1");
    expect(forensicCase.name).toBe("Operácia Tiger");
    expect(forensicCase.entities).toHaveLength(2);
    expect(forensicCase.transactions).toHaveLength(1);
    expect(forensicCase.weapons).toHaveLength(1);
    expect(forensicCase.weapons[0]?.serial).toBe("GL123456");
    expect(forensicCase.events[0]?.severity).toBe("critical");

    // Overenie, že výsledok prejde cez analyzeCase bez pádu
    const analysis = analyzeCase(forensicCase);
    expect(analysis).toBeDefined();
    expect(analysis.caseScore).toBeGreaterThanOrEqual(0);
    expect(analysis.totals.entities).toBe(2);
    expect(analysis.totals.transactions).toBe(1);
  });

  it("mapUnifiedToForensicDossier extrahuje a normalizuje dosiér", () => {
    const dossier = mapUnifiedToForensicDossier(sampleUnified);
    expect(dossier).toBeDefined();
    expect(dossier?.caseId).toBe("case-alpha-1");
    expect(dossier?.defendabilityIndex).toBe(85);
  });

  it("mapForensicCaseToUnified vykonáva obojsmernú reverznú konverziu", () => {
    const forensicCase = mapUnifiedToForensicCase(sampleUnified);
    const dossier = mapUnifiedToForensicDossier(sampleUnified);
    const convertedUnified = mapForensicCaseToUnified(forensicCase, dossier);

    expect(convertedUnified.id).toBe(forensicCase.id);
    expect(convertedUnified.title).toBe(forensicCase.name);
    expect(convertedUnified.entities).toHaveLength(forensicCase.entities.length);
    expect(convertedUnified.transactions).toHaveLength(forensicCase.transactions.length);
    expect(convertedUnified.dossier?.defendabilityIndex).toBe(85);
  });
});
