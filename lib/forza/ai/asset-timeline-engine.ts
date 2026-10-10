import type { ForensicAssetCorrelationReport } from "./asset-timeline-schema";

export type AuthoritativeEvidenceBinding = { evidenceId: string; sha256: string };

export type TemporalSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type TemporalResult = {
  timeDeltaHours: number | null;
  precision: "EXACT" | "DATE_ONLY" | "UNKNOWN";
  severity: TemporalSeverity | null;
};

export function deterministicTemporalDelta(
  transactionDate: string,
  actionDate: string,
): TemporalResult {
  const dateOnly =
    /^\d{4}-\d{2}-\d{2}$/.test(transactionDate) ||
    /^\d{4}-\d{2}-\d{2}$/.test(actionDate);
  const a = Date.parse(transactionDate);
  const b = Date.parse(actionDate);

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { timeDeltaHours: null, precision: "UNKNOWN", severity: null };
  }
  if (dateOnly) {
    return { timeDeltaHours: null, precision: "DATE_ONLY", severity: null };
  }

  const hours = Math.abs(a - b) / 3_600_000;
  const severity: TemporalSeverity =
    hours < 72
      ? "CRITICAL"
      : hours < 24 * 14
        ? "HIGH"
        : hours < 24 * 45
          ? "MEDIUM"
          : "LOW";
  return { timeDeltaHours: hours, precision: "EXACT", severity };
}

export function verifyLiteralQuote(
  quote: string,
  evidenceId: string,
  sources: ReadonlyMap<string, string>,
): boolean {
  return (
    quote.length >= 15 &&
    quote.length <= 200 &&
    Boolean(sources.get(evidenceId)?.includes(quote))
  );
}

export function enforceDeterminism(
  report: ForensicAssetCorrelationReport,
  sources: ReadonlyMap<string, string>,
): ForensicAssetCorrelationReport {
  return {
    ...report,
    temporalCorridors: report.temporalCorridors.map((corridor) => {
      const temporal = deterministicTemporalDelta(
        corridor.primaryTransaction.date,
        corridor.corporateOrCadastralAction.actionDate,
      );
      const valid =
        verifyLiteralQuote(
          corridor.primaryTransaction.evidenceQuote,
          corridor.primaryTransaction.sourceEvidenceId,
          sources,
        ) &&
        verifyLiteralQuote(
          corridor.corporateOrCadastralAction.evidenceQuote,
          corridor.corporateOrCadastralAction.sourceEvidenceId,
          sources,
        );

      return {
        ...corridor,
        timeDeltaHours: temporal.timeDeltaHours,
        precision: temporal.precision,
        severity: temporal.severity,
        forensicDeduction: valid
          ? corridor.forensicDeduction
          : "NEOVERENÉ — citácia nebola nájdená v zdroji.",
      };
    }),
  };
}

export function validateReportSources(
  report: ForensicAssetCorrelationReport,
  sources: ReadonlyMap<string, string>,
): ForensicAssetCorrelationReport {
  const validQuoteRef = (evidenceId: string, evidenceQuote: string) =>
    sources.has(evidenceId) &&
    verifyLiteralQuote(evidenceQuote, evidenceId, sources);

  const legalRefs = report.legalAssessment.sourceReferences.filter((ref) =>
    validQuoteRef(ref.evidenceId, ref.evidenceQuote),
  );

  return {
    ...report,
    temporalCorridors: report.temporalCorridors.filter(
      (corridor) =>
        validQuoteRef(
          corridor.primaryTransaction.sourceEvidenceId,
          corridor.primaryTransaction.evidenceQuote,
        ) &&
        validQuoteRef(
          corridor.corporateOrCadastralAction.sourceEvidenceId,
          corridor.corporateOrCadastralAction.evidenceQuote,
        ),
    ),
    nomineeRiskEntities: report.nomineeRiskEntities.map((entity) =>
      validQuoteRef(entity.sourceEvidenceId, entity.sourceEvidenceQuote)
        ? entity
        : { ...entity, classification: "UNVERIFIED" as const },
    ),
    legalAssessment: {
      ...report.legalAssessment,
      sourceReferences: legalRefs,
      status:
        report.legalAssessment.status === "SUPPORTED" && legalRefs.length === 0
          ? "UNVERIFIED"
          : report.legalAssessment.status,
    },
    proceduralActions: report.proceduralActions.map((action) => {
      const sourceReferences = action.sourceReferences.filter((ref) =>
        validQuoteRef(ref.evidenceId, ref.evidenceQuote),
      );
      return sourceReferences.length
        ? { ...action, sourceReferences }
        : { ...action, sourceReferences, status: "UNVERIFIED" as const };
    }),
  };
}

/** Model supplied hashes and page locators are never trusted as forensic metadata. */
export function bindAuthoritativeEvidenceMetadata(
  report: ForensicAssetCorrelationReport,
  bindings: readonly AuthoritativeEvidenceBinding[],
): ForensicAssetCorrelationReport {
  const hashes = new Map(
    bindings.map((binding) => [binding.evidenceId, binding.sha256]),
  );

  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (!value || typeof value !== "object") return value;

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(source)) {
      if (
        key === "sourcePage" ||
        key === "sourceParagraph" ||
        key === "page" ||
        key === "paragraph"
      ) {
        continue;
      }
      if (key === "sourceSha256") continue;
      if (key === "sha256" && typeof source.evidenceId === "string") {
        const authoritative = hashes.get(source.evidenceId);
        if (authoritative) result[key] = authoritative;
        continue;
      }
      result[key] = bind(child);
    }

    if (typeof result.sourceEvidenceId === "string") {
      const authoritative = hashes.get(result.sourceEvidenceId);
      if (authoritative) result.sourceSha256 = authoritative;
      else delete result.sourceSha256;
    }

    return result;
  };

  return bind(report) as ForensicAssetCorrelationReport;
}
