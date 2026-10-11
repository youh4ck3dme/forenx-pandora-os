import { describe, expect, it } from "vitest";
import {
  EVIDENCE_STATUS_INFO,
  evidenceDisplayState,
  evidenceStatusInfo,
  ingestStatusTrail,
} from "@/lib/forza/evidence-status-labels";

type Integrity = "verified" | "compromised" | "checking";
type Raw = "pending" | "verified" | "mismatch" | "object_missing" | "error";

describe("evidence status labels", () => {
  it("má všetkých 7 požadovaných stavov s vysvetlením a ďalšou akciou", () => {
    expect(Object.values(EVIDENCE_STATUS_INFO).map((i) => i.label).sort()).toEqual(
      [
        "Nahrané",
        "Čaká na overenie",
        "Overuje sa",
        "Overené",
        "Neoverené",
        "Overenie zlyhalo",
        "Ledger zapísaný",
      ].sort(),
    );
    for (const info of Object.values(EVIDENCE_STATUS_INFO)) {
      expect(info.explanation.length).toBeGreaterThan(10);
      expect(info.nextAction.length).toBeGreaterThan(5);
    }
  });

  it("„Overené“ iba pri serverovom verified — nikdy inak", () => {
    const integrities: Integrity[] = ["verified", "compromised", "checking"];
    const raws: (Raw | undefined)[] = [undefined, "pending", "verified", "mismatch", "object_missing", "error"];
    for (const integrityStatus of integrities) {
      for (const verificationStatus of raws) {
        const state = evidenceDisplayState({ integrityStatus, verificationStatus });
        const serverVerified =
          integrityStatus === "verified" &&
          (verificationStatus === undefined || verificationStatus === "verified");
        expect(state === "verified", `${integrityStatus}/${verificationStatus}`).toBe(serverVerified);
      }
    }
  });

  it("odlišuje „Overenie zlyhalo“ od „Čaká na overenie“ podľa verificationStatus", () => {
    expect(evidenceStatusInfo({ integrityStatus: "checking", verificationStatus: "error" }).label).toBe(
      "Overenie zlyhalo",
    );
    expect(evidenceStatusInfo({ integrityStatus: "checking", verificationStatus: "pending" }).label).toBe(
      "Čaká na overenie",
    );
    expect(evidenceStatusInfo({ integrityStatus: "checking" }).label).toBe("Čaká na overenie");
    expect(evidenceStatusInfo({ integrityStatus: "compromised", verificationStatus: "mismatch" }).label).toBe(
      "Neoverené",
    );
    expect(evidenceStatusInfo({ integrityStatus: "compromised" }).label).toBe("Neoverené");
  });

  it("„Overuje sa“ sa zo serverového stavu nikdy neodvodzuje (nemá DB zdroj)", () => {
    const raws: (Raw | undefined)[] = [undefined, "pending", "verified", "mismatch", "object_missing", "error"];
    for (const verificationStatus of raws) {
      for (const integrityStatus of ["verified", "compromised", "checking"] as Integrity[]) {
        expect(evidenceDisplayState({ integrityStatus, verificationStatus })).not.toBe("verifying");
      }
    }
  });

  it("upload trail: Nahrané → Ledger zapísaný (iba ak server potvrdil) → stav overenia", () => {
    expect(
      ingestStatusTrail({ integrityStatus: "checking", verificationStatus: "pending" }, { ledgerRecorded: true }).map(
        (i) => i.label,
      ),
    ).toEqual(["Nahrané", "Ledger zapísaný", "Čaká na overenie"]);
    expect(
      ingestStatusTrail({ integrityStatus: "checking" }, { ledgerRecorded: false }).map((i) => i.label),
    ).toEqual(["Nahrané", "Čaká na overenie"]);
  });
});
