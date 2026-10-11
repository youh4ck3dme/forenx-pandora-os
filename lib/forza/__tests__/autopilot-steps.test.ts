import { describe, expect, it } from "vitest";
import { AUTOPILOT_STEPS, deriveAutopilotStep, type AutopilotStepInput } from "@/lib/forza/autopilot-steps";

const base: AutopilotStepInput = {
  hasCase: true,
  queuedFileCount: 0,
  awaitingConsent: false,
  stage: "idle",
  hasResult: false,
};

describe("deriveAutopilotStep", () => {
  it("má presne 5 krokov v správnom poradí", () => {
    expect(AUTOPILOT_STEPS.map((s) => s.label)).toEqual([
      "Vybrať prípad",
      "Pridať dokument",
      "Skontrolovať náhľad",
      "Udeliť AI súhlas",
      "Spustiť a sledovať workflow",
    ]);
  });

  it("prechody: prípad → dokument → náhľad → súhlas → workflow → hotovo", () => {
    expect(deriveAutopilotStep({ ...base, hasCase: false }).current).toBe(1);
    expect(deriveAutopilotStep(base).current).toBe(2);
    expect(deriveAutopilotStep({ ...base, queuedFileCount: 2 }).current).toBe(3);
    expect(
      deriveAutopilotStep({ ...base, queuedFileCount: 2, stage: "extracting", awaitingConsent: true }).current,
    ).toBe(4);
    expect(deriveAutopilotStep({ ...base, queuedFileCount: 2, stage: "analyzing" }).current).toBe(5);
    const done = deriveAutopilotStep({ ...base, hasResult: true });
    expect(done).toMatchObject({ current: 5, completed: true });
    expect(Object.values(done.statuses).every((s) => s === "done")).toBe(true);
  });

  it("súhlasová brána: kým čaká súhlas, krok 5 nie je aktívny ani hotový", () => {
    const s = deriveAutopilotStep({ ...base, queuedFileCount: 1, stage: "extracting", awaitingConsent: true });
    expect(s.statuses[4]).toBe("current");
    expect(s.statuses[5]).toBe("upcoming");
    expect(s.completed).toBe(false);
  });

  it("bez prípadu je všetko ostatné „čaká“, aj keď sú súbory vo fronte", () => {
    const s = deriveAutopilotStep({ ...base, hasCase: false, queuedFileCount: 3 });
    expect(s.statuses).toEqual({ 1: "current", 2: "upcoming", 3: "upcoming", 4: "upcoming", 5: "upcoming" });
  });

  it("chyba posledného behu sa zobrazí na kroku 5", () => {
    expect(deriveAutopilotStep({ ...base, queuedFileCount: 1, failed: true }).statuses[5]).toBe("error");
    expect(deriveAutopilotStep({ ...base, stage: "analyzing", failed: true }).statuses[5]).toBe("error");
  });
});
