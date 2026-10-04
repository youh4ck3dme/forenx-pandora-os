import { useSyncExternalStore } from "react";

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
