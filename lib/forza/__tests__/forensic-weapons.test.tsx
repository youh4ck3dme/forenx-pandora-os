/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  DevilsAdvocatePanel,
  probabilityTone,
} from "@/components/features/forensic/DevilsAdvocatePanel";
import {
  AdmissibilityAuditView,
  auditStatusLabel,
  clampAuditScore,
} from "@/components/features/forensic/AdmissibilityAuditView";
import {
  CustodyLedgerViewer,
  hasLinkedIntegrity,
  shortHash,
} from "@/components/features/forensic/CustodyLedgerViewer";
import type {
  AdmissibilityAuditResult,
  AlternativeHypothesis,
  CustodyLedgerEntry,
} from "../types";

const hypothesis: AlternativeHypothesis = {
  id: "AH-1",
  title: "Legitímna pôžička",
  scenario: "Platba mohla byť riadnym financovaním.",
  evidence: ["Zmluva o pôžičke"],
  requiredTraces: ["Splátkový kalendár"],
  rebuttal: "Vyžiadať účtovníctvo veriteľa.",
  probabilityScore: 42,
  sourceReferences: [{ evidenceId: "doc-1", page: 2 }],
};

const audit: AdmissibilityAuditResult = {
  status: "at_risk",
  score: 88.4,
  defects: [
    {
      severity: "curable",
      paragraph: "§ 114 TP",
      description: "Chýba poučenie svedka.",
      remedyAction: "Vykonať doplňujúci výsluch.",
      sourceEvidenceId: "doc-1",
      sourcePage: 3,
    },
  ],
  courtReadySummary: "Dôkazy sú použiteľné po doplnení vady.",
  sourceReferences: [{ evidenceId: "doc-1", paragraph: "odsek 4" }],
};

const ledger: CustodyLedgerEntry[] = [
  {
    index: 0,
    id: "CL-1",
    traceId: "TR-1",
    timestamp: "2026-09-27T08:00:00.000Z",
    actor: "Vyšetrovateľ",
    action: "SEIZURE",
    location: "Bratislava",
    payloadHash: "a".repeat(64),
    prevHash: "GENESIS",
    hash: "b".repeat(64),
  },
  {
    index: 1,
    id: "CL-2",
    traceId: "TR-1",
    timestamp: "2026-09-27T09:00:00.000Z",
    actor: "Znalec",
    action: "ANALYSIS",
    location: "KEÚ PZ",
    payloadHash: "c".repeat(64),
    prevHash: "b".repeat(64),
    hash: "d".repeat(64),
  },
];

describe("forenzné superzbrane", () => {
  it("vykreslí alternatívnu hypotézu s dôkazmi, chýbajúcimi stopami a protiargumentom", () => {
    render(
      <DevilsAdvocatePanel
        hypotheses={[hypothesis]}
        knownEvidence={new Set(["doc-1"])}
      />,
    );
    expect(screen.getByText("Legitímna pôžička")).toBeDefined();
    expect(screen.getByText("Zmluva o pôžičke")).toBeDefined();
    expect(screen.getByText("Splátkový kalendár")).toBeDefined();
    expect(screen.getByText("Vyžiadať účtovníctvo veriteľa.")).toBeDefined();
    expect(screen.getByText("42 % ALTERNATÍVA")).toBeDefined();
    expect(probabilityTone(70)).toContain("rose");
  });

  it("označí hypotézu bez existujúceho dôkazu a lokátora ako neoverenú", () => {
    render(
      <DevilsAdvocatePanel
        hypotheses={[
          {
            ...hypothesis,
            sourceReferences: [{ evidenceId: "unknown" }],
          },
        ]}
        knownEvidence={new Set(["doc-1"])}
      />,
    );
    expect(
      screen.getByText("Neoverené tvrdenia (nie sú skutkom)"),
    ).toBeDefined();
    expect(screen.queryByText("42 % ALTERNATÍVA")).toBeNull();
  });

  it("clampne a vykreslí skóre procesnej prípustnosti aj vadu", () => {
    render(
      <AdmissibilityAuditView
        audit={audit}
        knownEvidence={new Set(["doc-1"])}
      />,
    );
    expect(screen.getByText("88%")).toBeDefined();
    expect(screen.getByText("§ 114 TP")).toBeDefined();
    expect(screen.getByText("Vykonať doplňujúci výsluch.")).toBeDefined();
    expect(clampAuditScore(120)).toBe(100);
    expect(clampAuditScore(-3)).toBe(0);
    expect(auditStatusLabel("at_risk")).toContain("ohrozená");
  });

  it("zobrazí overenú kryptografickú reťaz a odhalí prerušenie", () => {
    render(<CustodyLedgerViewer entries={ledger} />);
    expect(screen.getByText("VERIFIED INTEGRITY")).toBeDefined();
    expect(screen.getByText("Zaistenie")).toBeDefined();
    expect(screen.getByText("Analýza")).toBeDefined();
    expect(hasLinkedIntegrity(ledger)).toBe(true);
    expect(hasLinkedIntegrity([{ ...ledger[1]!, prevHash: "wrong" }])).toBe(true);
    expect(
      hasLinkedIntegrity([ledger[0]!, { ...ledger[1]!, prevHash: "wrong" }]),
    ).toBe(false);
    expect(shortHash("a".repeat(64))).toBe(`${"a".repeat(10)}…${"a".repeat(10)}`);
  });
});
