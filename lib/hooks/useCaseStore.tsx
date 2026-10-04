import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { idbClear, idbGet, idbSet } from "@/lib/forza/idb";
import { SESSION_RESET_EVENT } from "@/lib/forza/session";
import type { Severity } from "@/lib/forza/forensic";

export type RunLogEntry = {
  id: string;
  at: number;
  target: string;
  detector: string;
  score: number;
  level: Severity;
  flagCount: number;
};

export type ThemeMode = "light" | "dark" | "system" | "amber";

export type CaseState = {
  riskFilter: Severity[];
  reviewed: string[];
  runLog: RunLogEntry[];
  exports: number;
  theme: ThemeMode;
};

export const THEME_STORAGE_KEY = "malte:theme";

export function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system" || saved === "amber")
      return saved;
  } catch {
    // ignore
  }
  return null;
}

export function applyDocumentTheme(theme: ThemeMode) {
  if (typeof document === "undefined") return;
  let systemDark = false;
  try {
    systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    // ignore
  }
  const root = document.documentElement;
  root.classList.remove("amber");

  if (theme === "amber") {
    root.classList.add("dark", "amber");
    root.style.colorScheme = "dark";
    return;
  }

  const dark = theme === "dark" || (theme === "system" && systemDark);
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

function getInitialTheme(): ThemeMode {
  return readStoredTheme() ?? "light";
}

const EMPTY: CaseState = {
  riskFilter: [],
  reviewed: [],
  runLog: [],
  exports: 0,
  theme: getInitialTheme(),
};
const KEY = "malte:case-state";

type Ctx = {
  state: CaseState;
  ready: boolean;
  toggleRisk: (level: Severity) => void;
  clearRisk: () => void;
  toggleReviewed: (id: string) => void;
  markAllReviewed: (ids: string[]) => void;
  clearReviewed: () => void;
  logRun: (entry: Omit<RunLogEntry, "at">) => void;
  countExport: () => void;
  setTheme: (theme: ThemeMode) => void;
  reset: () => void;
};

const CaseStoreContext = createContext<Ctx | null>(null);

export function CaseStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CaseState>(EMPTY);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    let active = true;
    idbGet<CaseState>(KEY)
      .then((stored) => {
        if (!active) return;
        const lsTheme = readStoredTheme();
        if (stored) {
          const theme = lsTheme ?? stored.theme ?? "light";
          if (!lsTheme && stored.theme) {
            try {
              localStorage.setItem(THEME_STORAGE_KEY, stored.theme);
            } catch {
              // ignore
            }
          }
          setState({ ...EMPTY, ...stored, theme });
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((next: (prev: CaseState) => CaseState) => {
    setState((prev: CaseState) => {
      const value = next(prev);
      void idbSet(KEY, value).catch(() => undefined);
      return value;
    });
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const onReset = () => setState({ ...EMPTY, theme: getInitialTheme() });
    window.addEventListener(SESSION_RESET_EVENT, onReset);
    return () => window.removeEventListener(SESSION_RESET_EVENT, onReset);
  }, []);

  useLayoutEffect(() => {
    applyDocumentTheme(state.theme);

    // Live system preference listener (OS day/night transitions)
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onMediaChange = () => applyDocumentTheme(state.theme);
    media.addEventListener("change", onMediaChange);

    // Multi-tab sync via localStorage 'storage' event
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;
      const newTheme = e.newValue as ThemeMode;
      if (newTheme === "light" || newTheme === "dark" || newTheme === "system" || newTheme === "amber") {
        setState((prev) => ({ ...prev, theme: newTheme }));
        applyDocumentTheme(newTheme);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      media.removeEventListener("change", onMediaChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [state.theme]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      ready,
      toggleRisk: (level: Severity) =>
        update((prev: CaseState) => ({
          ...prev,
          riskFilter: prev.riskFilter.includes(level)
            ? prev.riskFilter.filter((l: Severity) => l !== level)
            : [...prev.riskFilter, level],
        })),
      clearRisk: () => update((prev: CaseState) => ({ ...prev, riskFilter: [] })),
      toggleReviewed: (id: string) =>
        update((prev: CaseState) => ({
          ...prev,
          reviewed: prev.reviewed.includes(id)
            ? prev.reviewed.filter((r: string) => r !== id)
            : [...prev.reviewed, id],
        })),
      markAllReviewed: (ids: string[]) =>
        update((prev: CaseState) => ({
          ...prev,
          reviewed: Array.from(new Set([...prev.reviewed, ...ids])),
        })),
      clearReviewed: () => update((prev: CaseState) => ({ ...prev, reviewed: [] })),
      logRun: (entry: Omit<RunLogEntry, "at">) =>
        update((prev: CaseState) => ({
          ...prev,
          runLog: [
            { ...entry, at: Date.now() },
            ...prev.runLog.filter((r: RunLogEntry) => r.id !== entry.id),
          ].slice(0, 30),
        })),
      countExport: () =>
        update((prev: CaseState) => ({ ...prev, exports: prev.exports + 1 })),
      setTheme: (theme: ThemeMode) => {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, theme);
        } catch {
          // ignore
        }
        update((prev: CaseState) => ({ ...prev, theme }));
      },
      reset: () => {
        void idbClear().catch(() => undefined);
        setState(EMPTY);
      },
    }),
    [state, ready, update],
  );

  return (
    <CaseStoreContext.Provider value={value}>
      {children}
    </CaseStoreContext.Provider>
  );
}

export function useCaseStore(): Ctx {
  const ctx = useContext(CaseStoreContext);
  if (!ctx) {
    throw new Error("useCaseStore musí byť použitý v CaseStoreProvider");
  }
  return ctx;
}

export function passesFilter(filter: Severity[], level: Severity): boolean {
  return filter.length === 0 || filter.includes(level);
}
