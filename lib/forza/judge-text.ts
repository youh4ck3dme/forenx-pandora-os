import type { ForensicDossier } from "./types";
import { listBoundFacts } from "./evidence-binding";

/**
 * Issue #13: judgeReadyText je voľný text modelu bez väzby na dôkazy. Môže
 * opakovať neoverenú alebo podvrhnutú (prompt injection) hypotézu, preto sa
 * nikdy nevydáva za záver — iba za explicitne označený neoverený návrh.
 */
export type JudgeNarrativePart = {
  label: string;
  text: string;
};

export function judgeNarrativeParts(dossier: ForensicDossier): JudgeNarrativePart[] {
  const parts = [
    { label: "I. Skutkový stav", text: dossier.judgeReadyText?.skutkovyStav },
    { label: "II. Vyporiadanie sa s obhajobou", text: dossier.judgeReadyText?.vyporiadanie },
    { label: "III. Vedecké zhodnotenie stôp", text: dossier.judgeReadyText?.vedecke },
  ];
  return parts.filter((part): part is JudgeNarrativePart => Boolean(part.text?.trim()));
}

export const NO_BOUND_FACTS_TEXT =
  "Žiadna okolnosť nie je viazaná na hash-overený dôkaz — skutkový stav nemožno z AI analýzy uviesť.";

/**
 * Text do schránky (§ 168 TP): skutkový stav iba z tvrdení viazaných na
 * hash-overený dôkaz; naratív modelu oddelene ako neoverený návrh.
 */
export function buildJudgeClipboardText(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): string {
  const facts = listBoundFacts(dossier, knownEvidence);
  const factLines =
    facts.length > 0
      ? facts.map((fact) => `- ${fact.when}: ${fact.text} (zdroj: ${fact.source})`).join("\n")
      : NO_BOUND_FACTS_TEXT;

  const sections = [
    `ROZSUDKOVÝ FORMÁT (§ 168 TP) — ${dossier.caseTitle}
Spis: ${dossier.caseId}

I. ZISTENÝ SKUTKOVÝ STAV (iba okolnosti viazané na hash-overený dôkaz):
${factLines}`,
  ];

  const narrative = judgeNarrativePart(dossier);
  if (narrative) sections.push(narrative);
  return sections.join("\n\n");
}

function judgeNarrativePart(dossier: ForensicDossier): string | null {
  const parts = judgeNarrativeParts(dossier);
  if (parts.length === 0) return null;
  return `AI NÁVRH TEXTU ODÔVODNENIA — NEOVERENÝ, NIE JE SÚČASŤOU ZÁVEROV
(voľný text modelu bez väzby na dôkazy; pred použitím overte voči originálu spisu)

${parts.map((part) => `${part.label} — návrh:\n${part.text}`).join("\n\n")}`;
}
