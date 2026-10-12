import { useSyncExternalStore } from "react";

/**
 * Offline režim je READ-ONLY: aplikácia nemá write queue, Background Sync ani
 * serverové potvrdenie offline zápisov, preto sa zápis offline neponúka a nič
 * sa neoznačuje ako „uložené“, kým to nepotvrdí server.
 */
export const OFFLINE_READONLY_MESSAGE =
  "Ste offline. Prehliadanie je dostupné. Zápis bude možný po obnovení pripojenia.";

/** AI-špecifické upozornenie (analýza vyžaduje sieť). */
export const OFFLINE_AI_MESSAGE =
  "Ste offline — prehliadanie funguje, AI analýza vyžaduje internetové pripojenie.";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function getSnapshot() {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
