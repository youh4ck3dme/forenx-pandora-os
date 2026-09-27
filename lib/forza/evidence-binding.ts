import type {
  ForensicDossier,
  AdmissibilityAuditDefect,
  AdmissibilityAuditResult,
  AlternativeHypothesis,
  DefenseAttack,
  EvidenceRow,
  HypothesisSourceRef,
  SourceRef,
  SuspiciousFlowItem,
  TimelineEvent,
} from "./types";
import { formatSourceRef } from "./types";

/**
 * Task 4 / P1-01 — viazanie tvrdení a právnych záverov na nemenné dôkazy.
 *
 * JEDINÝ zdroj nemenných dôkazov je WORM ledger `evidence_items` (Supabase):
 * záznam s identitou zapísanou raz (WORM trigger) a hashom overeným serverovým
 * workerom (`hash_verification_status = 'verified'`). Do UI prichádza cez
 * `GET /api/vault` ako položka s `integrityStatus: "verified"`.
 *
 * NIKDY sa za dôkaz nepovažuje:
 * - `dossier.custodyLedger` — generuje ho AI (vrátane ID aj hashov), podvrhnutý
 *   text v spise by si vedel „vyrobiť“ dôkaz,
 * - `analysisMeta.documentIds` — sú to názvy súborov z klienta,
 * - dôkaz so stavom pending / mismatch / object_missing / error.
 *
 * Tvrdenie bez platnej väzby (známe overené evidenceId + konkrétna strana alebo
 * odsek) sa exportuje/zobrazuje iba ako „neoverené — nie je skutkom“.
 * Bez načítaného ledgera je množina dôkazov prázdna → nič nie je viazané (fail-closed).
 */

/** Záznam z WORM ledgera tak, ako ho vracia `GET /api/vault` (ForensicEvidenceItem). */
export type LedgerEvidence = {
  id: string;
  sha256Hash?: string;
  fileName?: string;
  integrityStatus: string;
};

/** Množina ID dôkazov, na ktoré sa smú viazať tvrdenia: iba hash-overené záznamy WORM ledgera. */
export function verifiedEvidenceIds(items: readonly LedgerEvidence[] | undefined | null): Set<string> {
  const ids = new Set<string>();
  for (const item of items ?? []) {
    const id = item.id?.trim();
    if (id && item.integrityStatus === "verified") ids.add(id);
  }
  return ids;
}

/** Prázdna množina — nič nie je viazané, kým sa ledger nenačíta. */
export const NO_VERIFIED_EVIDENCE: ReadonlySet<string> = new Set<string>();

function hasLocator(ref: { page?: number | undefined; paragraph?: string | undefined } | undefined | null): boolean {
  const paragraph = ref?.paragraph?.trim();
  return (
    (Number.isInteger(ref?.page) && (ref?.page ?? 0) > 0) ||
    // Samotná citácia zákona („§ 119 TP“) nie je locator do dôkazu.
    Boolean(paragraph && !/^§\s*\d/u.test(paragraph))
  );
}

/**
 * Skutkové tvrdenie (chronológia, tok): väzba cez `sourceRef.evidenceId` na
 * overený dôkaz + konkrétna strana alebo odsek (rovnako ako pri právnych
 * záveroch). Legacy `documentId` (názov súboru) sa za dôkaz nepovažuje.
 */
export function isBoundToEvidence(
  sourceRef: SourceRef | undefined | null,
  knownEvidence: ReadonlySet<string>,
): boolean {
  const evidenceId = sourceRef?.evidenceId?.trim();
  return Boolean(evidenceId && knownEvidence.has(evidenceId) && hasLocator(sourceRef));
}

/** Právny záver: overené evidenceId + konkrétna strana alebo odsek. */
export function isValidEvidenceReference(
  sourceRef: HypothesisSourceRef | undefined | null,
  knownEvidence: ReadonlySet<string>,
): boolean {
  const evidenceId = sourceRef?.evidenceId?.trim();
  return Boolean(evidenceId && knownEvidence.has(evidenceId) && hasLocator(sourceRef));
}

/** Každý odkaz musí byť platný a musí existovať aspoň jeden. */
export function hasValidEvidenceReferences(
  sourceRefs: HypothesisSourceRef[] | undefined,
  knownEvidence: ReadonlySet<string>,
): boolean {
  return Boolean(
    sourceRefs?.length && sourceRefs.every((ref) => isValidEvidenceReference(ref, knownEvidence)),
  );
}

export type BoundPartition<T> = {
  /** Tvrdenia s platnou oporou v dôkazoch — exportovateľné ako fakt. */
  bound: T[];
  /** Tvrdenia bez opory — nesmú sa exportovať ako fakt. */
  unbound: T[];
};

export function partitionAlternativeHypotheses(
  hypotheses: AlternativeHypothesis[] | undefined,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<AlternativeHypothesis> {
  const bound: AlternativeHypothesis[] = [];
  const unbound: AlternativeHypothesis[] = [];
  for (const hypothesis of hypotheses ?? []) {
    (hasValidEvidenceReferences(hypothesis.sourceReferences, knownEvidence) ? bound : unbound).push(hypothesis);
  }
  return { bound, unbound };
}

export function defectSourceRef(defect: AdmissibilityAuditDefect): HypothesisSourceRef | undefined {
  if (defect.sourceRef) return defect.sourceRef;
  if (!defect.sourceEvidenceId) return undefined;
  return {
    evidenceId: defect.sourceEvidenceId,
    ...(defect.sourcePage ? { page: defect.sourcePage } : {}),
    ...(defect.sourceParagraph ? { paragraph: defect.sourceParagraph } : {}),
  };
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
    (isValidEvidenceReference(defectSourceRef(defect), knownEvidence) ? boundDefects : unboundDefects).push(defect);
  }
  return {
    summaryBound: hasValidEvidenceReferences(audit?.sourceReferences, knownEvidence),
    boundDefects,
    unboundDefects,
  };
}

/** Rozdelí udalosti chronológie na zdrojované (fakty) a nezdrojované. */
export function partitionTimeline(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<TimelineEvent> {
  const bound: TimelineEvent[] = [];
  const unbound: TimelineEvent[] = [];
  for (const event of dossier.facts.timeline) {
    (isBoundToEvidence(event.sourceRef, knownEvidence) ? bound : unbound).push(event);
  }
  return { bound, unbound };
}

/** Rozdelí podozrivé finančné toky na viazané (fakty) a neviazané. */
export function partitionSuspiciousFlows(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<SuspiciousFlowItem> {
  const bound: SuspiciousFlowItem[] = [];
  const unbound: SuspiciousFlowItem[] = [];
  for (const flow of dossier.financialAnalysis?.suspiciousFlows ?? []) {
    (isBoundToEvidence(flow.sourceRef, knownEvidence) ? bound : unbound).push(flow);
  }
  return { bound, unbound };
}

/** Rozdelí body útoku obhajoby na viazané (súčasť záveru II.) a neviazané. */
export function partitionDefenseAttacks(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<DefenseAttack> {
  const bound: DefenseAttack[] = [];
  const unbound: DefenseAttack[] = [];
  for (const attack of dossier.defenseAttack?.attacks ?? []) {
    (isBoundToEvidence(attack.sourceRef, knownEvidence) ? bound : unbound).push(attack);
  }
  return { bound, unbound };
}

/** Rozdelí stopy dôkazovej matice na viazané (súčasť záveru III.) a neviazané. */
export function partitionEvidenceTraces(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): BoundPartition<EvidenceRow> {
  const bound: EvidenceRow[] = [];
  const unbound: EvidenceRow[] = [];
  for (const trace of dossier.evidenceStrength?.traces ?? []) {
    (isBoundToEvidence(trace.sourceRef, knownEvidence) ? bound : unbound).push(trace);
  }
  return { bound, unbound };
}

/** Okolnosť viazaná na hash-overený dôkaz — jediný obsah skutkového stavu. */
export type BoundFact = {
  when: string;
  text: string;
  source: string;
};

/**
 * Issue #13: skutkový stav (záver I.) sa skladá výlučne z udalostí chronológie
 * a finančných tokov viazaných na hash-overený dôkaz — nikdy z voľného textu
 * modelu (judgeReadyText).
 */
export function listBoundFacts(
  dossier: ForensicDossier,
  knownEvidence: ReadonlySet<string>,
): BoundFact[] {
  return [
    ...partitionTimeline(dossier, knownEvidence).bound.map((event) => ({
      when: event.time,
      text: event.event,
      source: formatSourceRef(event.sourceRef) || event.source?.trim() || "—",
    })),
    ...partitionSuspiciousFlows(dossier, knownEvidence).bound.map((flow) => ({
      when: flow.date,
      text: `${flow.payer} ➔ ${flow.recipient}, ${flow.amount.toLocaleString("sk-SK")} € — ${flow.purpose}`,
      source: formatSourceRef(flow.sourceRef),
    })),
  ];
}
