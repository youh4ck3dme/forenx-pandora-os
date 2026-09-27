import type {
  ForensicDossier,
  SourceRef,
  SuspiciousFlowItem,
  TimelineEvent,
} from "./types";

/**
 * P1-01 — deterministické viazanie tvrdení na evidencie (Source Evidence Binding).
 *
 * Skutkové tvrdenie (udalosť chronológie, podozrivý finančný tok) smie byť
 * exportované ako fakt len vtedy, keď sa viaže na konkrétny immutable
 * identifikátor dôkazu evidovaného v spise (documentId z analysisMeta
 * alebo traceId/id z custody ledgera). Tvrdenie s chýbajúcim, prázdnym
 * alebo neznámym identifikátorom nemá platnú oporu v dôkazovom materiáli
 * a NESMIE sa exportovať ako fakt.
 */

/** Immutable identifikátory dôkazov aktuálne evidovaných v spise. */
export function collectEvidenceIds(dossier: ForensicDossier): Set<string> {
  const ids = new Set<string>();
  for (const id of dossier.analysisMeta?.documentIds ?? []) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  for (const entry of dossier.custodyLedger ?? []) {
    const traceId = entry.traceId?.trim();
    const id = entry.id?.trim();
    if (traceId) ids.add(traceId);
    if (id) ids.add(id);
  }
  return ids;
}

/** Overí, či sa tvrdenie viaže na známy immutable dôkaz. */
export function isBoundToEvidence(
  sourceRef: SourceRef | undefined | null,
  knownEvidence: ReadonlySet<string>,
): boolean {
  const documentId = sourceRef?.documentId?.trim();
  if (!documentId) return false;
  return knownEvidence.has(documentId);
}

export type BoundPartition<T> = {
  /** Tvrdenia s platnou oporou v dôkazoch — exportovateľné ako fakt. */
  bound: T[];
  /** Tvrdenia bez opory — nesmú sa exportovať ako fakt. */
  unbound: T[];
};

/** Rozdelí udalosti chronológie na zdrojované (fakty) a nezdrojované. */
export function partitionTimeline(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string> = collectEvidenceIds(dossier),
): BoundPartition<TimelineEvent> {
  const bound: TimelineEvent[] = [];
  const unbound: TimelineEvent[] = [];
  for (const event of dossier.facts.timeline) {
    if (isBoundToEvidence(event.sourceRef, knownEvidence)) bound.push(event);
    else unbound.push(event);
  }
  return { bound, unbound };
}

/** Rozdelí podozrivé finančné toky na viazané (fakty) a neviazané. */
export function partitionSuspiciousFlows(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string> = collectEvidenceIds(dossier),
): BoundPartition<SuspiciousFlowItem> {
  const flows = dossier.financialAnalysis?.suspiciousFlows ?? [];
  const bound: SuspiciousFlowItem[] = [];
  const unbound: SuspiciousFlowItem[] = [];
  for (const flow of flows) {
    if (isBoundToEvidence(flow.sourceRef, knownEvidence)) bound.push(flow);
    else unbound.push(flow);
  }
  return { bound, unbound };
}
