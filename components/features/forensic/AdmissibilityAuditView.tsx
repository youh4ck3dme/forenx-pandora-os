import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import type { AdmissibilityAuditResult } from "@/lib/forza/types";

export function clampAuditScore(score: number) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function auditStatusLabel(status: AdmissibilityAuditResult["status"]) {
  return {
    admissible: "Prípustné na hlavnom pojednávaní",
    at_risk: "Prípustnosť je ohrozená",
    inadmissible: "Obsahuje neprípustné dôkazy",
  }[status];
}

const defectStyle = {
  critical: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  curable: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  formal: "border-amber-500/30 bg-amber-500/10 text-amber-300",
};

export function AdmissibilityAuditView({
  audit,
}: {
  audit?: AdmissibilityAuditResult;
}) {
  if (!audit) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        Audit procesnej prípustnosti zatiaľ nie je k dispozícii. Spustite
        Autopilota alebo audit v triážnych úlohách.
      </section>
    );
  }

  const score = clampAuditScore(audit.score);
  const scoreColor =
    score >= 80 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-rose-400";

  return (
    <section className="space-y-3" aria-label="Procesná prípustnosť dôkazov">
      <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
        <div className="flex aspect-square flex-col items-center justify-center rounded-full border-8 border-cyan-500/25 bg-cyan-500/5 text-center shadow-[0_0_30px_rgba(34,211,238,.12)]">
          <span className={`font-mono text-3xl font-black ${scoreColor}`}>{score}%</span>
          <span className="mt-1 px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Procesná čistota
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
            <Scale className="h-4 w-4" /> {auditStatusLabel(audit.status)}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {audit.courtReadySummary}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Procesné vady ({audit.defects.length})
        </p>
        {audit.defects.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> Audit neidentifikoval procesnú vadu.
          </div>
        ) : (
          audit.defects.map((defect) => (
            <article key={`${defect.paragraph}-${defect.description}`} className={`rounded-lg border p-3 ${defectStyle[defect.severity]}`}>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="flex items-center gap-1.5 text-xs font-bold">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {defect.paragraph}
                </p>
                <div className="flex items-center gap-1">
                  {defect.sourceEvidenceId && (
                    <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                      Dôkaz: #{defect.sourceEvidenceId}
                    </span>
                  )}
                  {defect.legalAuthority && (
                    <span className="rounded bg-black/30 px-1.5 py-0.5 text-[10px] font-medium text-foreground/80">
                      {defect.legalAuthority}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs leading-relaxed">{defect.description}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-2 text-[11px] leading-relaxed opacity-95">
                <p>
                  <strong>Procesná náprava:</strong> {defect.remedyAction}
                </p>
                {defect.remediationRisk && (
                  <span className="text-[10px] font-bold uppercase tracking-wider">
                    Riziko: {defect.remediationRisk}
                  </span>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
