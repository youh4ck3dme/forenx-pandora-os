"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseSessionToken } from "@/lib/forza/access-audit";
import {
  NO_VERIFIED_EVIDENCE,
  verifiedEvidenceIds,
  type LedgerEvidence,
} from "@/lib/forza/evidence-binding";

export type VerifiedEvidenceState = {
  /** ID hash-overených dôkazov z WORM ledgera — jediný zdroj väzby tvrdení. */
  knownEvidence: ReadonlySet<string>;
  items: LedgerEvidence[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** Načíta záznamy WORM ledgera prípadu (bez prístupu → prázdna množina, fail-closed). */
export async function loadVerifiedEvidence(
  caseId: string,
  fetcher: Fetcher = fetch,
  token: string | null = null,
): Promise<{ items: LedgerEvidence[]; knownEvidence: ReadonlySet<string> }> {
  const res = await fetcher(`/api/vault?caseId=${encodeURIComponent(caseId)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw new Error(`Ledger dôkazov nie je dostupný (HTTP ${res.status}).`);
  const data = (await res.json()) as { items?: unknown };
  const items = (Array.isArray(data.items) ? data.items : []).filter(
    (item): item is LedgerEvidence =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as LedgerEvidence).id === "string" &&
      typeof (item as LedgerEvidence).integrityStatus === "string",
  );
  return { items, knownEvidence: verifiedEvidenceIds(items) };
}

export function useVerifiedEvidence(caseId: string | null | undefined): VerifiedEvidenceState {
  const [items, setItems] = useState<LedgerEvidence[]>([]);
  const [knownEvidence, setKnownEvidence] = useState<ReadonlySet<string>>(NO_VERIFIED_EVIDENCE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Iba posledná požiadavka smie zapísať stav (prepnutie prípadu počas načítania).
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    // Nový prípad: okamžite bez väzby, kým sa jeho ledger nenačíta.
    setItems([]);
    setKnownEvidence(NO_VERIFIED_EVIDENCE);
    if (!caseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const token = await getSupabaseSessionToken();
      const result = await loadVerifiedEvidence(caseId, fetch, token);
      if (current !== generation.current) return;
      setItems(result.items);
      setKnownEvidence(result.knownEvidence);
      setError(null);
    } catch (e) {
      if (current !== generation.current) return;
      // Fail-closed: bez ledgera nie je nič viazané na dôkaz.
      setItems([]);
      setKnownEvidence(NO_VERIFIED_EVIDENCE);
      setError(e instanceof Error ? e.message : "Ledger dôkazov nie je dostupný.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { knownEvidence, items, loading, error, reload };
}
