import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  analyzeCase,
  EMPTY_CASE,
  type CaseAnalysis,
  type ForensicCase,
} from "@/lib/forza/forensic";
import {
  listCases,
  loadCase,
  loadCaseDossier,
  loadCaseRevisions,
  type CaseSummary,
} from "@/lib/forza/case-data";
import { SESSION_RESET_EVENT } from "@/lib/forza/session";
import type { ForensicDossier } from "@/lib/forza/types";
import { getSupabaseSessionToken } from "@/lib/forza/access-audit";

export type { ForensicDossier };

type Ctx = {
  cases: CaseSummary[];
  activeCaseId: string | null;
  setActiveCaseId: (id: string | null) => void;
  activeCase: ForensicCase;
  analysis: CaseAnalysis;
  dossier: ForensicDossier | null;
  trustedEvidenceIds: string[];
  trustedEvidenceError: string | null;
  setDossier: (dossier: ForensicDossier | null) => void;
  /** Revízie záznamov pre ochranu pred prepísaním súbežnou úpravou. */
  revisions: Record<string, number>;
  hasCase: boolean;
  loading: boolean;
  refresh: (caseId?: string) => Promise<void>;
};

const ActiveCaseContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "malte:active-case";

async function loadTrustedEvidenceIds(
  caseId: string,
): Promise<{ ids: string[]; error: string | null }> {
  try {
    const token = await getSupabaseSessionToken();
    const response = await fetch(
      `/api/vault?caseId=${encodeURIComponent(caseId)}`,
      { headers: token ? { authorization: `Bearer ${token}` } : undefined },
    );
    if (!response.ok) {
      return {
        ids: [],
        error: "Zoznam dôkazov z nemenného ledgeru sa nepodarilo overiť.",
      };
    }
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== "object" ||
      !("ledgerEvidenceIds" in data) ||
      !Array.isArray(data.ledgerEvidenceIds) ||
      !data.ledgerEvidenceIds.every((id) => typeof id === "string")
    ) {
      return {
        ids: [],
        error: "Odpoveď ledgeru dôkazov nemá platný formát.",
      };
    }
    return { ids: data.ledgerEvidenceIds, error: null };
  } catch {
    return {
      ids: [],
      error: "Zoznam dôkazov z nemenného ledgeru sa nepodarilo načítať.",
    };
  }
}

export function ActiveCaseProvider({ children }: { children: ReactNode }) {
  const [activeCaseId, setActiveCaseIdState] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [activeCase, setActiveCase] = useState<ForensicCase>(EMPTY_CASE);
  const [dossier, setDossier] = useState<ForensicDossier | null>(null);
  const [trustedEvidenceIds, setTrustedEvidenceIds] = useState<string[]>([]);
  const [trustedEvidenceError, setTrustedEvidenceError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = async (caseId?: string) => {
    try {
      setLoading(true);
      setTrustedEvidenceIds([]);
      setTrustedEvidenceError(null);
      const list = await listCases();
      setCases(list);
      const targetId = caseId || activeCaseId || (list[0]?.id ?? null);
      if (targetId) {
        const [loaded, revs, loadedDossier, evidence] = await Promise.all([
          loadCase(targetId),
          loadCaseRevisions(targetId),
          loadCaseDossier(targetId),
          loadTrustedEvidenceIds(targetId),
        ]);
        if (loaded) setActiveCase(loaded);
        if (revs) setRevisions(revs);
        setDossier(loadedDossier);
        setTrustedEvidenceIds(evidence.ids);
        setTrustedEvidenceError(evidence.error);
      } else {
        setTrustedEvidenceIds([]);
        setTrustedEvidenceError(null);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setActiveCaseIdState(stored);
    refresh(stored ?? undefined);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onReset = () => {
      setActiveCaseIdState(null);
      setActiveCase(EMPTY_CASE);
      setDossier(null);
      setTrustedEvidenceIds([]);
      setTrustedEvidenceError(null);
    };
    window.addEventListener(SESSION_RESET_EVENT, onReset);
    return () => window.removeEventListener(SESSION_RESET_EVENT, onReset);
  }, []);

  const setActiveCaseId = (id: string | null) => {
    setActiveCaseIdState(id);
    if (typeof window !== "undefined") {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    }
    if (id) refresh(id);
  };

  const analysis = useMemo(() => analyzeCase(activeCase), [activeCase]);

  const value: Ctx = {
    cases,
    activeCaseId,
    setActiveCaseId,
    activeCase,
    analysis,
    dossier,
    trustedEvidenceIds,
    trustedEvidenceError,
    setDossier,
    revisions,
    hasCase: Boolean(activeCase && activeCase.id),
    loading,
    refresh,
  };

  return (
    <ActiveCaseContext.Provider value={value}>
      {children}
    </ActiveCaseContext.Provider>
  );
}

export function useActiveCase(): Ctx {
  const ctx = useContext(ActiveCaseContext);
  if (!ctx) {
    throw new Error("useActiveCase musí byť použitý v ActiveCaseProvider");
  }

  return ctx;
}
