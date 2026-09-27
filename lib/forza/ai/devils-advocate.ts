import type {
  TestimonyContradiction,
  AdmissibilityAuditDefect,
  AdmissibilityAuditResult,
  DefenseAttack,
} from "../types";

/**
 * Vyhodnotí závažnosť rozporu vo výpovediach svedkov alebo spoluobvinených.
 */
export function scoreContradictionSeverity(
  deceitPercentage: number,
  topic: string,
): "critical" | "high" | "medium" {
  if (deceitPercentage >= 75 || /odovzdanie|zbrane|hotovosť|peniaze|podpis/i.test(topic)) {
    return "critical";
  }
  if (deceitPercentage >= 40) {
    return "high";
  }
  return "medium";
}

/**
 * Normalizuje rozpor vo výpovedi a doplní procesný návrh na konfrontáciu (§ 125 TP).
 */
export function normalizeContradiction(input: {
  id?: string;
  topic: string;
  personA: { name: string; status: string; claim: string };
  personB?: { name: string; status: string; claim: string };
  factualRecord: string;
  deceitPercentage?: number;
  contradictionSeverity?: "critical" | "high" | "medium";
  proceduralResolution?: string;
}): TestimonyContradiction {
  const deceitPercentage = input.deceitPercentage ?? 50;
  const contradictionSeverity =
    input.contradictionSeverity ??
    scoreContradictionSeverity(deceitPercentage, input.topic);

  const proceduralResolution =
    input.proceduralResolution ||
    `Nariadiť a vykonať konfrontáciu podľa § 125 TP medzi ${input.personA.name} a ${input.personB?.name ?? "ostatnými svedkami"} k rozporu v otázke: ${input.topic}.`;

  return {
    id: input.id || `TC-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
    topic: input.topic.trim(),
    personA: {
      name: input.personA.name.trim(),
      status: input.personA.status.trim(),
      claim: input.personA.claim.trim(),
    },
    ...(input.personB
      ? {
          personB: {
            name: input.personB.name.trim(),
            status: input.personB.status.trim(),
            claim: input.personB.claim.trim(),
          },
        }
      : {}),
    factualRecord: input.factualRecord.trim(),
    deceitPercentage,
    contradictionSeverity,
    proceduralResolution,
  };
}

/**
 * Vyhodnotí celkový procesný stav použiteľnosti dôkazov podľa § 119 ods. 3 Trestného poriadku.
 */
export function auditAdmissibility(defects: AdmissibilityAuditDefect[]): AdmissibilityAuditResult {
  const criticalDefects = defects.filter((d) => d.severity === "critical");
  const status: "admissible" | "at_risk" | "inadmissible" =
    criticalDefects.length > 0
      ? "inadmissible"
      : defects.length > 0
        ? "at_risk"
        : "admissible";

  const totalDeduction = defects.reduce((acc, d) => {
    if (d.severity === "critical") return acc + 30;
    if (d.severity === "curable") return acc + 15;
    return acc + 5;
  }, 0);

  const score = Math.max(0, 100 - totalDeduction);

  return {
    status,
    score,
    courtReadySummary: `Procesný audit identifikoval ${defects.length} vád dokazovania, z toho ${criticalDefects.length} kritických, ktoré zakladajú dôvod na nezákonnosť dôkazu v zmysle § 119 ods. 3 TP.`,
    defects,
  };
}

/**
 * Generuje protiútoky obhajoby a hypotézy v štýle Devil's Advocate.
 */
export function synthesizeDevilsAdvocateAttacks(
  attacks: DefenseAttack[],
): {
  overallRisk: "KRITICKÉ" | "VYSOKÉ" | "STREDNÉ" | "NÍZKE";
  attacks: DefenseAttack[];
} {
  const highRisk = attacks.filter(
    (a) => a.risk === "VYSOKÉ" || a.risk === "KRITICKÉ",
  );
  const overallRisk: "KRITICKÉ" | "VYSOKÉ" | "STREDNÉ" | "NÍZKE" =
    highRisk.length >= 2
      ? "VYSOKÉ"
      : attacks.length > 0
        ? "STREDNÉ"
        : "NÍZKE";

  return {
    overallRisk,
    attacks,
  };
}
