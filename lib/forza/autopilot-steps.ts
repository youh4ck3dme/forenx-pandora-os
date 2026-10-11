/**
 * Kroky Forenzného Autopilota odvodené výhradne z existujúceho stavu UI.
 * Nemení backend kontrakt ani logiku súhlasu (consentVersion) — iba ju zobrazuje.
 */
export const AUTOPILOT_STEPS = [
  { id: 1, label: "Vybrať prípad" },
  { id: 2, label: "Pridať dokument" },
  { id: 3, label: "Skontrolovať náhľad" },
  { id: 4, label: "Udeliť AI súhlas" },
  { id: 5, label: "Spustiť a sledovať workflow" },
] as const;

export type AutopilotStepId = (typeof AUTOPILOT_STEPS)[number]["id"];
export type AutopilotStepStatus = "done" | "current" | "upcoming" | "error";

export type AutopilotStepInput = {
  hasCase: boolean;
  queuedFileCount: number;
  /** Dialóg súhlasu s náhľadom je otvorený (čaká sa na rozhodnutie). */
  awaitingConsent: boolean;
  stage: "idle" | "extracting" | "analyzing";
  /** Existuje reálny (nie demo) výsledok analýzy. */
  hasResult: boolean;
  /** Posledný pokus skončil chybou. */
  failed?: boolean;
};

export type AutopilotStepState = {
  current: AutopilotStepId;
  completed: boolean;
  statuses: Record<AutopilotStepId, AutopilotStepStatus>;
};

export function deriveAutopilotStep(input: AutopilotStepInput): AutopilotStepState {
  let current: AutopilotStepId;
  let completed = false;

  if (!input.hasCase) current = 1;
  else if (input.awaitingConsent) current = 4;
  else if (input.stage !== "idle") current = 5;
  else if (input.hasResult) {
    current = 5;
    completed = true;
  } else if (input.queuedFileCount > 0) current = 3;
  else current = 2;

  const statuses = {} as Record<AutopilotStepId, AutopilotStepStatus>;
  for (const step of AUTOPILOT_STEPS) {
    if (step.id < current) statuses[step.id] = "done";
    else if (step.id === current) {
      statuses[step.id] = completed
        ? "done"
        : input.failed && current === 5
          ? "error"
          : "current";
    } else statuses[step.id] = "upcoming";
  }
  // Pri chybe sa vraciame na kontrolu dávky — krok 5 ostáva označený chybou.
  if (input.failed && current !== 5 && input.hasCase) {
    statuses[5] = "error";
  }
  return { current, completed, statuses };
}

export const AUTOPILOT_STEP_STATUS_LABELS: Record<AutopilotStepStatus, string> = {
  done: "hotové",
  current: "aktuálny krok",
  upcoming: "čaká",
  error: "zlyhalo",
};
