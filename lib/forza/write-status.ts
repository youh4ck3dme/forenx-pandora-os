/**
 * Stavy zápisu na server. „Uložené na serveri“ smie UI zobraziť IBA po
 * potvrdení servera — aplikácia nemá offline write queue ani Background Sync,
 * preto sa nič nesimuluje cez localStorage.
 */
export type ServerWriteState = "pending" | "sending" | "saved" | "failed";

export const SERVER_WRITE_LABELS: Record<ServerWriteState, string> = {
  pending: "Čaká na odoslanie",
  sending: "Odosiela sa",
  saved: "Uložené na serveri",
  failed: "Odoslanie zlyhalo",
};

/**
 * Odvodí stav zápisu z existujúceho stavu volania servera.
 * `lastSavedAt` je nastavené iba po úspešnej odpovedi servera.
 */
export function deriveServerWriteState(input: {
  isSaving: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
}): ServerWriteState {
  if (input.isSaving) return "sending";
  if (input.saveError) return "failed";
  if (input.lastSavedAt) return "saved";
  return "pending";
}
