/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { AutopilotTabsView } from "../assistant/AutopilotTabsView";
import { ARMIVEX_CASE_DOSSIER } from "@/lib/forza/demo-dossier";
import { NO_VERIFIED_EVIDENCE } from "@/lib/forza/evidence-binding";
import type { ForensicDossier } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Issue #16: v pracovnom UI sa neviazané AI tvrdenia zobrazujú, ale zreteľne
// ako neoverené — nikdy ako „zistený skutkový záver“.
const VERIFIED = "11111111-1111-4111-8111-111111111111";
const known: ReadonlySet<string> = new Set([VERIFIED]);
const boundRef = { documentId: "zapisnica.pdf", evidenceId: VERIFIED, page: 4 };

function dossier(): ForensicDossier {
  const d = JSON.parse(JSON.stringify(ARMIVEX_CASE_DOSSIER)) as ForensicDossier;
  for (const q of Object.values(d.investigativeAnswers!)) delete q.sourceRef;
  delete d.financialAnalysis!.sourceRef;
  for (const p of d.evidenceStrength.paragraphs) delete p.sourceRef;
  return d;
}

function renderTab(d: ForensicDossier, tab: string, evidence: ReadonlySet<string>) {
  return render(
    <AutopilotTabsView
      dossier={d}
      showTimestory={false}
      autopilotTab={tab}
      setAutopilotTab={() => {}}
      knownEvidence={evidence}
      onSimulateDevilsAdvocate={() => {}}
    />,
  );
}

describe("AutopilotTabsView labels unbound AI claims (issue #16)", () => {
  it("marks unbound investigative answers and never shows the model's question text", () => {
    const d = dossier();
    d.investigativeAnswers!.q1_buyer_seller.question = "PODVRHNUTA_OTAZKA";
    const { container } = renderTab(d, "otazky", NO_VERIFIED_EVIDENCE);
    const text = container.textContent ?? "";
    expect(text).not.toContain("PODVRHNUTA_OTAZKA");
    expect(text).toContain("Kto zbrane nakupoval a následne predával alebo odovzdával?");
    expect(text.match(/Neoverené — bez väzby na dôkaz/g)).toHaveLength(3);
    expect(text).not.toContain("Zistený skutkový záver:");
    expect(text).not.toContain("Preukázanosť:");
  });

  it("shows a bound answer as a finding with its source", () => {
    const d = dossier();
    d.investigativeAnswers!.q3_financier.sourceRef = boundRef;
    const text = renderTab(d, "otazky", known).container.textContent ?? "";
    expect(text.match(/Zistený skutkový záver:/g)).toHaveLength(1);
    expect(text.match(/Neoverené — bez väzby na dôkaz/g)).toHaveLength(2);
    expect(text).toContain("Zdroj: zapisnica.pdf · s.4");
  });

  it("marks an unbound financing conclusion as an unverified AI draft", () => {
    const d = dossier();
    const unbound = renderTab(d, "transakcie", NO_VERIFIED_EVIDENCE).container.textContent ?? "";
    expect(unbound).toContain("AI návrh záveru o financovaní (neoverený)");
    expect(unbound).not.toContain("Záver forenzného vyšetrovania tokov financií");

    d.financialAnalysis!.sourceRef = boundRef;
    const bound = renderTab(d, "transakcie", known).container.textContent ?? "";
    expect(bound).toContain("Záver forenzného vyšetrovania tokov financií");
    expect(bound).not.toContain("AI návrh záveru o financovaní");
  });

  it("marks unbound legal-element statuses as unverified", () => {
    const d = dossier();
    const count = d.evidenceStrength.paragraphs.length;
    expect(count).toBeGreaterThan(0);
    const text = renderTab(d, "defense", NO_VERIFIED_EVIDENCE).container.textContent ?? "";
    expect(text.match(/\(neoverené\)/g)).toHaveLength(count);
  });
});
