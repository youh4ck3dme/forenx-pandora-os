import { z } from "zod";
import { isClearanceOrInnocenceClaim } from "@/lib/ai/redact";
import { hasValidEvidenceReferences, isValidEvidenceReference, defectSourceRef } from "./evidence-binding";
import type { AdmissibilityAuditResult, AlternativeHypothesis, ForensicDossier, HypothesisSourceRef } from "./types";

/**
 * Task 4 — validácia a vynútenie väzby právnych záverov PRED uložením dossieru.
 *
 * - Hypotézy a § 119 vady z AI prejdú Zod schémou; nevalidné položky sa zahodia.
 * - Odkazy na dôkaz mimo registra (WORM ledger, hash overený) sa odstránia —
 *   vymyslené ID ani custody/traceId sa neuložia.
 * - Tvrdenie o nevine / zbavení viny bez vlastnej platnej väzby sa zahodí úplne.
 * - Ostatné nezdrojované položky ostanú, no UI/PDF ich zobrazí ako „neoverené“.
 */

const RefSchema = z.object({
  evidenceId: z.string().trim().min(1).max(100),
  page: z.number().int().positive().optional(),
  paragraph: z.string().trim().max(200).optional(),
  description: z.string().max(500).optional(),
});

const HypothesisSchema = z.object({
  id: z.string().max(50),
  title: z.string().trim().min(1).max(300),
  scenario: z.string().trim().min(1).max(8000),
  evidence: z.array(z.string().max(500)).max(50).default([]),
  sourceReferences: z.array(z.unknown()).max(20).optional(),
  legalAuthority: z.string().max(300).optional(),
  requiredTraces: z.array(z.string().max(500)).max(50).default([]),
  rebuttal: z.string().max(4000).default(""),
  probabilityScore: z.number().min(0).max(100).default(0),
});

const DefectSchema = z.object({
  id: z.string().max(50).optional(),
  severity: z.enum(["critical", "curable", "formal"]),
  paragraph: z.string().max(200).default(""),
  legalAuthority: z.string().max(300).optional(),
  sourceEvidenceId: z.string().max(100).optional(),
  sourcePage: z.number().int().positive().optional(),
  sourceParagraph: z.string().max(200).optional(),
  sourceRef: z.unknown().optional(),
  defectType: z
    .enum(["unlawful_acquisition", "missing_caution", "unauthorized_organ", "chain_of_custody_break", "formal_flaw"])
    .optional(),
  description: z.string().trim().min(1).max(4000),
  remedyAction: z.string().max(4000).default(""),
  remediationRisk: z.enum(["high", "medium", "low"]).optional(),
});

const AuditSchema = z.object({
  status: z.enum(["admissible", "at_risk", "inadmissible"]),
  score: z.number().min(0).max(100),
  defects: z.array(z.unknown()).max(100).default([]),
  courtReadySummary: z.string().max(8000).default(""),
  sourceReferences: z.array(z.unknown()).max(20).optional(),
  remediationPlan: z.array(z.unknown()).optional(),
});

/** Iba odkazy na dôkazy z registra; ostatné sa zahodia. */
function keepKnownRefs(refs: unknown, registry: ReadonlySet<string>): HypothesisSourceRef[] {
  return (Array.isArray(refs) ? refs : [])
    .map((ref) => RefSchema.safeParse(ref))
    .filter((r): r is z.SafeParseSuccess<z.infer<typeof RefSchema>> => r.success)
    .map((r) => r.data)
    .filter((ref) => registry.has(ref.evidenceId));
}

export type SanitizeReport = {
  droppedMalformed: number;
  droppedUnsupportedInnocence: number;
  strippedUnknownRefs: number;
};

export function sanitizeLegalConclusions(
  dossier: ForensicDossier,
  registry: ReadonlySet<string>,
): { dossier: ForensicDossier; report: SanitizeReport } {
  const report: SanitizeReport = { droppedMalformed: 0, droppedUnsupportedInnocence: 0, strippedUnknownRefs: 0 };
  const next: ForensicDossier = { ...dossier };

  // Chronológia a toky: evidenceId iba z registra.
  const stripRef = <T extends { sourceRef?: { evidenceId?: string } }>(item: T): T => {
    const id = item.sourceRef?.evidenceId;
    if (id && !registry.has(id)) {
      report.strippedUnknownRefs += 1;
      const { evidenceId: _removed, ...rest } = item.sourceRef ?? {};
      return { ...item, sourceRef: rest } as T;
    }
    return item;
  };
  next.facts = { ...dossier.facts, timeline: (dossier.facts?.timeline ?? []).map(stripRef) };
  if (dossier.financialAnalysis) {
    next.financialAnalysis = {
      ...dossier.financialAnalysis,
      suspiciousFlows: (dossier.financialAnalysis.suspiciousFlows ?? []).map(stripRef),
    };
  }

  if (dossier.alternativeHypotheses !== undefined) {
    const hypotheses: AlternativeHypothesis[] = [];
    for (const raw of Array.isArray(dossier.alternativeHypotheses) ? dossier.alternativeHypotheses : []) {
      const parsed = HypothesisSchema.safeParse(raw);
      if (!parsed.success) {
        report.droppedMalformed += 1;
        continue;
      }
      const before = Array.isArray(parsed.data.sourceReferences) ? parsed.data.sourceReferences.length : 0;
      const refs = keepKnownRefs(parsed.data.sourceReferences, registry);
      report.strippedUnknownRefs += before - refs.length;
      const hypothesis: AlternativeHypothesis = { ...parsed.data, sourceReferences: refs };
      const claim = `${hypothesis.title} ${hypothesis.scenario} ${hypothesis.legalAuthority ?? ""}`;
      if (isClearanceOrInnocenceClaim(claim) && !hasValidEvidenceReferences(refs, registry)) {
        report.droppedUnsupportedInnocence += 1;
        continue;
      }
      hypotheses.push(hypothesis);
    }
    next.alternativeHypotheses = hypotheses;
  }

  if (dossier.admissibilityAudit !== undefined) {
    const parsed = AuditSchema.safeParse(dossier.admissibilityAudit);
    if (!parsed.success) {
      report.droppedMalformed += 1;
      delete next.admissibilityAudit;
    } else {
      const defects: AdmissibilityAuditResult["defects"] = [];
      for (const raw of parsed.data.defects) {
        const d = DefectSchema.safeParse(raw);
        if (!d.success) {
          report.droppedMalformed += 1;
          continue;
        }
        const defect = { ...d.data } as AdmissibilityAuditResult["defects"][number];
        const ref = defectSourceRef(defect);
        if (ref && !registry.has(ref.evidenceId)) {
          report.strippedUnknownRefs += 1;
          delete defect.sourceEvidenceId;
          delete defect.sourceRef;
        } else if (defect.sourceRef) {
          const [clean] = keepKnownRefs([defect.sourceRef], registry);
          if (clean) defect.sourceRef = clean;
          else delete defect.sourceRef;
        }
        defects.push(defect);
      }
      const before = Array.isArray(parsed.data.sourceReferences) ? parsed.data.sourceReferences.length : 0;
      const summaryRefs = keepKnownRefs(parsed.data.sourceReferences, registry);
      report.strippedUnknownRefs += before - summaryRefs.length;
      let summary = parsed.data.courtReadySummary;
      if (isClearanceOrInnocenceClaim(summary) && !hasValidEvidenceReferences(summaryRefs, registry)) {
        report.droppedUnsupportedInnocence += 1;
        summary = "";
      }
      next.admissibilityAudit = {
        status: parsed.data.status,
        score: parsed.data.score,
        defects,
        courtReadySummary: summary,
        sourceReferences: summaryRefs,
        ...(dossier.admissibilityAudit.remediationPlan ? { remediationPlan: dossier.admissibilityAudit.remediationPlan } : {}),
      };
    }
  }

  // Custody ledger z AI nikdy nie je dôkaz — ponecháva sa len ako neoverený opis.
  return { dossier: next, report };
}

/** Pre case-úlohy (alt_devil / admiss_audit) po preklade E1… → UUID: položka bez väzby → unverified. */
export function enforceTaskEvidenceBinding<
  T extends {
    hypotheses?: { title?: string; scenario?: string; sourceReferences?: HypothesisSourceRef[] }[];
    defects?: { description?: string; paragraph?: string; sourceEvidenceId?: string; sourcePage?: number; sourceParagraph?: string }[];
    courtReadySummary?: string;
    sourceReferences?: HypothesisSourceRef[];
    unverified?: string[];
  },
>(output: T, registry: ReadonlySet<string>): T {
  const unverified = [...(output.unverified ?? [])];
  const result = { ...output };
  if (Array.isArray(output.hypotheses)) {
    result.hypotheses = output.hypotheses.filter((h) => {
      if (hasValidEvidenceReferences(h.sourceReferences, registry)) return true;
      const claim = `${h.title ?? ""} ${h.scenario ?? ""}`;
      if (!isClearanceOrInnocenceClaim(claim) && h.title?.trim()) {
        unverified.push(`Hypotéza bez väzby na overený dôkaz: ${h.title.trim()}`);
      }
      return false;
    });
  }
  if (Array.isArray(output.defects)) {
    result.defects = output.defects.filter((d) => {
      const ref = d.sourceEvidenceId
        ? { evidenceId: d.sourceEvidenceId, ...(d.sourcePage ? { page: d.sourcePage } : {}), ...(d.sourceParagraph ? { paragraph: d.sourceParagraph } : {}) }
        : undefined;
      if (isValidEvidenceReference(ref, registry)) return true;
      if (d.description?.trim()) unverified.push(`Vada bez väzby na overený dôkaz: ${d.paragraph || ""} ${d.description.trim()}`.trim());
      return false;
    });
  }
  if (
    typeof output.courtReadySummary === "string" &&
    isClearanceOrInnocenceClaim(output.courtReadySummary) &&
    !hasValidEvidenceReferences(output.sourceReferences, registry)
  ) {
    result.courtReadySummary = "";
  }
  result.unverified = unverified.slice(0, 40);
  return result;
}
