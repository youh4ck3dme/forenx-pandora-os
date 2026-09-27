import type {
  ForensicDossier,
  AdmissibilityAuditDefect,
  AdmissibilityAuditResult,
  AlternativeHypothesis,
  HypothesisSourceRef,
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
 * alebo traceId z custody ledgera). Tvrdenie s chýbajúcim, prázdnym
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
    if (traceId) ids.add(traceId);
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

export function isValidEvidenceReference(
  sourceRef: HypothesisSourceRef | undefined | null,
  knownEvidence: ReadonlySet<string>,
): boolean {
  const evidenceId = sourceRef?.evidenceId?.trim();
  const paragraph = sourceRef?.paragraph?.trim();
  const hasLocator =
    (Number.isInteger(sourceRef?.page) && (sourceRef?.page ?? 0) > 0) ||
    Boolean(paragraph && !/^§\s*\d/u.test(paragraph));
  return Boolean(evidenceId && knownEvidence.has(evidenceId) && hasLocator);
}

export function resolveEvidenceReference(
  sourceRef: HypothesisSourceRef | undefined | null,
  aliasToEvidenceId: ReadonlyMap<string, string>,
): HypothesisSourceRef | null {
  if (
    !sourceRef ||
    !isValidEvidenceReference(sourceRef, new Set(aliasToEvidenceId.keys()))
  ) {
    return null;
  }
  const evidenceId = sourceRef.evidenceId.trim();
  const resolvedEvidenceId = aliasToEvidenceId.get(evidenceId);
  return resolvedEvidenceId
    ? { ...sourceRef, evidenceId: resolvedEvidenceId }
    : null;
}

function hasValidEvidenceReferences(
  sourceRefs: HypothesisSourceRef[] | undefined,
  knownEvidence: ReadonlySet<string>,
): boolean {
  return Boolean(
    sourceRefs?.length &&
      sourceRefs.every((ref) => isValidEvidenceReference(ref, knownEvidence)),
  );
}

export function partitionAlternativeHypotheses(
  hypotheses: AlternativeHypothesis[] | undefined,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<AlternativeHypothesis> {
  const bound: AlternativeHypothesis[] = [];
  const unbound: AlternativeHypothesis[] = [];
  for (const hypothesis of hypotheses ?? []) {
    (hasValidEvidenceReferences(hypothesis.sourceReferences, knownEvidence)
      ? bound
      : unbound
    ).push(hypothesis);
  }
  return { bound, unbound };
}

export function partitionAdmissibilityAudit(
  audit: AdmissibilityAuditResult | undefined,
  knownEvidence: ReadonlySet<string>,
): {
  summaryBound: boolean;
  boundDefects: AdmissibilityAuditDefect[];
  unboundDefects: AdmissibilityAuditDefect[];
} {
  const boundDefects: AdmissibilityAuditDefect[] = [];
  const unboundDefects: AdmissibilityAuditDefect[] = [];
  for (const defect of audit?.defects ?? []) {
    const sourceRef =
      defect.sourceRef ??
      (defect.sourceEvidenceId
        ? {
            evidenceId: defect.sourceEvidenceId,
            ...(defect.sourcePage ? { page: defect.sourcePage } : {}),
            ...(defect.sourceParagraph
              ? { paragraph: defect.sourceParagraph }
              : {}),
          }
        : undefined);
    (isValidEvidenceReference(sourceRef, knownEvidence)
      ? boundDefects
      : unboundDefects
    ).push(defect);
  }
  return {
    summaryBound: hasValidEvidenceReferences(
      audit?.sourceReferences,
      knownEvidence,
    ),
    boundDefects,
    unboundDefects,
  };
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
