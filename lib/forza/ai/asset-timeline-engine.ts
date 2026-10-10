import type { ForensicAssetCorrelationReport } from "./asset-timeline-schema";

export type TemporalResult = { timeDeltaHours: number | null; precision: "EXACT" | "DATE_ONLY" | "UNKNOWN"; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" };
export function deterministicTemporalDelta(transactionDate: string, actionDate: string): TemporalResult {
  const a = Date.parse(transactionDate), b = Date.parse(actionDate);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { timeDeltaHours: null, precision: "UNKNOWN", severity: "LOW" };
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(transactionDate) || /^\d{4}-\d{2}-\d{2}$/.test(actionDate);
  const hours = Math.abs(a - b) / 3_600_000;
  const severity = hours < 72 ? "CRITICAL" : hours < 24 * 14 ? "HIGH" : hours < 24 * 45 ? "MEDIUM" : "LOW";
  return { timeDeltaHours: dateOnly ? null : hours, precision: dateOnly ? "DATE_ONLY" : "EXACT", severity };
}
export function verifyLiteralQuote(quote: string, evidenceId: string, sources: ReadonlyMap<string, string>): boolean {
  return quote.length >= 15 && quote.length <= 200 && Boolean(sources.get(evidenceId)?.includes(quote));
}
export function enforceDeterminism(report: ForensicAssetCorrelationReport, sources: ReadonlyMap<string, string>): ForensicAssetCorrelationReport {
  return { ...report, temporalCorridors: report.temporalCorridors.map(c => { const t = deterministicTemporalDelta(c.primaryTransaction.date, c.corporateOrCadastralAction.actionDate); const valid = verifyLiteralQuote(c.primaryTransaction.evidenceQuote, c.primaryTransaction.sourceEvidenceId, sources) && verifyLiteralQuote(c.corporateOrCadastralAction.evidenceQuote, c.corporateOrCadastralAction.sourceEvidenceId, sources); return { ...c, timeDeltaHours: t.timeDeltaHours ?? 0, precision: t.precision, severity: t.severity, forensicDeduction: valid ? c.forensicDeduction : "NEOVERENÉ — citácia nebola nájdená v zdroji." }; }) };
}
