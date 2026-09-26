import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCaseStore } from "@/hooks/useCaseStore";
import { severityLabel, type Severity } from "@/forensic";

const levels: Severity[] = ["critical", "high", "medium", "low"];

const activeStyles: Record<Severity, string> = {
  critical: "bg-risk-high text-risk-high-foreground border-risk-high",
  high: "bg-risk-high/15 text-risk-high border-risk-high/40",
  medium: "bg-risk-medium/20 text-risk-medium border-risk-medium/40",
  low: "bg-risk-low/20 text-risk-low border-risk-low/40",
};

export function RiskFilter({
  counts,
}: {
  counts?: Partial<Record<Severity, number>>;
}) {
  const { state, toggleRisk, clearRisk } = useCaseStore();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {levels.map((level) => {
        const active = state.riskFilter.includes(level);
        return (
          <button
            key={level}
            type="button"
            onClick={() => toggleRisk(level)}
            aria-pressed={active}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
              active
                ? cn(activeStyles[level], "font-semibold")
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {severityLabel[level]}
            {counts?.[level] !== undefined ? (
              <span className="tnum">{counts[level]}</span>
            ) : null}
          </button>
        );
      })}
      {state.riskFilter.length > 0 ? (
        <button
          type="button"
          onClick={clearRisk}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Zrušiť
        </button>
      ) : null}
    </div>
  );
}
