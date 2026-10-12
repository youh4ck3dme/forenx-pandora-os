import type { ForensicEvidenceItem } from "@/lib/forza/vault-types";

/**
 * Používateľské stavy dôkazu. Úspešný upload NIE JE kryptografické overenie:
 * „Overené“ vzniká výhradne zo serverového stavu `verified` (INV-004/005).
 *
 * „Overuje sa“ zatiaľ nemá zdroj v databáze (ledger rozlišuje iba `pending`
 * a výsledky workera), preto sa zo serverového stavu nikdy neodvodzuje.
 */
export type EvidenceDisplayState =
  | "uploaded"
  | "awaiting_verification"
  | "verifying"
  | "verified"
  | "unverified"
  | "verification_failed"
  | "ledger_recorded";

export type EvidenceStatusTone = "neutral" | "pending" | "success" | "danger";

export type EvidenceStatusInfo = {
  state: EvidenceDisplayState;
  label: string;
  explanation: string;
  nextAction: string;
  tone: EvidenceStatusTone;
};

export const EVIDENCE_STATUS_INFO: Record<EvidenceDisplayState, EvidenceStatusInfo> = {
  uploaded: {
    state: "uploaded",
    label: "Nahrané",
    explanation: "Súbor bol prenesený do trezoru. Nahratie samo osebe nie je overenie integrity.",
    nextAction: "Počkajte na zápis do ledgera a serverové overenie.",
    tone: "neutral",
  },
  ledger_recorded: {
    state: "ledger_recorded",
    label: "Ledger zapísaný",
    explanation: "Dôkaz má záznam v nemennom ledgeri dôkazov (evidence_items).",
    nextAction: "Serverové overenie hashu prebehne automaticky.",
    tone: "neutral",
  },
  awaiting_verification: {
    state: "awaiting_verification",
    label: "Čaká na overenie",
    explanation:
      "Server ešte neprepočítal SHA-256 a veľkosť skutočných bajtov v trezore. Dôkaz zatiaľ nie je overený.",
    nextAction: "Obnovte zoznam neskôr. Analýza je dostupná až po overení.",
    tone: "pending",
  },
  verifying: {
    state: "verifying",
    label: "Overuje sa",
    explanation: "Prebieha serverové overenie integrity.",
    nextAction: "Počkajte na výsledok overenia.",
    tone: "pending",
  },
  verified: {
    state: "verified",
    label: "Overené",
    explanation:
      "Server prepočítal SHA-256 a veľkosť skutočných bajtov v trezore a zhodujú sa so záznamom v ledgeri.",
    nextAction: "Dôkaz je možné použiť vo forenznej analýze.",
    tone: "success",
  },
  unverified: {
    state: "unverified",
    label: "Neoverené",
    explanation:
      "Serverové overenie zistilo nezhodu hashu alebo veľkosti, alebo objekt v trezore chýba.",
    nextAction: "Dôkaz nepoužívajte. Nahrajte originálny súbor znova a skontrolujte audit.",
    tone: "danger",
  },
  verification_failed: {
    state: "verification_failed",
    label: "Overenie zlyhalo",
    explanation:
      "Overenie sa nepodarilo dokončiť pre technickú chybu. Integrita nie je potvrdená ani vyvrátená.",
    nextAction: "Skúste overenie zopakovať neskôr alebo kontaktujte správcu.",
    tone: "danger",
  },
};

type StatusSource = Pick<ForensicEvidenceItem, "integrityStatus"> & {
  verificationStatus?: ForensicEvidenceItem["verificationStatus"];
};

/** Stav dôkazu zo servera → zobrazovaný stav. „Overené“ iba pri serverovom `verified`. */
export function evidenceDisplayState(item: StatusSource): EvidenceDisplayState {
  const raw = item.verificationStatus;
  if (raw) {
    switch (raw) {
      case "verified":
        return item.integrityStatus === "verified" ? "verified" : "awaiting_verification";
      case "mismatch":
      case "object_missing":
        return "unverified";
      case "error":
        return "verification_failed";
      case "pending":
      default:
        return "awaiting_verification";
    }
  }
  if (item.integrityStatus === "verified") return "verified";
  if (item.integrityStatus === "compromised") return "unverified";
  return "awaiting_verification";
}

export function evidenceStatusInfo(item: StatusSource): EvidenceStatusInfo {
  return EVIDENCE_STATUS_INFO[evidenceDisplayState(item)];
}

/**
 * Stavy po dokončení uploadu (poradie pre zobrazenie): Nahrané → Ledger zapísaný
 * (iba ak server potvrdil záznam) → aktuálny stav overenia.
 */
export function ingestStatusTrail(
  item: StatusSource,
  options: { ledgerRecorded: boolean },
): EvidenceStatusInfo[] {
  const trail: EvidenceStatusInfo[] = [EVIDENCE_STATUS_INFO.uploaded];
  if (options.ledgerRecorded) trail.push(EVIDENCE_STATUS_INFO.ledger_recorded);
  trail.push(evidenceStatusInfo(item));
  return trail;
}
