import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Loader2 } from "lucide-react";
import { Card } from "@/components/malte/Shell";
import type { ForensicWorkflowRun } from "@/lib/forza/forensic-workflow.types";

type Props = {
  caseId: string;
  loadRuns: (caseId: string) => Promise<{ runs: ForensicWorkflowRun[] }>;
  onCompleted?: () => void;
};

function duration(run: ForensicWorkflowRun) {
  const milliseconds =
    run.durationMs ??
    (run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : null);
  if (milliseconds == null) return "čaká";
  return `${Math.max(0, Math.round(milliseconds / 1000))} s`;
}

export function ForensicWorkflowInspector({ caseId, loadRuns, onCompleted }: Props) {
  const [runs, setRuns] = useState<ForensicWorkflowRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let completed = false;
    const refresh = async () => {
      try {
        const result = await loadRuns(caseId);
        if (!mounted) return;
        setRuns(result.runs);
        setError(null);
        if (!completed && result.runs.some((run) => run.status === "completed")) {
          completed = true;
          onCompleted?.();
        }
      } catch {
        if (mounted) setError("Stav trvalého spracovania sa nepodarilo načítať.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [caseId, loadRuns, onCompleted]);

  if (runs.length === 0 && !error) return null;
  return (
    <Card className="border-primary/30 bg-black/75 p-3 space-y-2" aria-label="Forenzný priebeh">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <Clock3 className="h-3.5 w-3.5 text-primary" /> Trvalý forenzný priebeh
      </div>
      {error ? <p role="alert" className="text-xs text-rose-300">{error}</p> : null}
      <div className="space-y-1.5">
        {runs.map((run) => {
          const active = run.status === "queued" || run.status === "running";
          return (
            <div key={run.id} className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-2 text-xs">
              <div className="min-w-0">
                <p className="font-mono text-[10px] text-primary">{run.workflowType}</p>
                <p className="capitalize text-foreground">{run.status} · pokus {run.attemptCount}</p>
                {run.errorMessage ? <p className="mt-1 text-rose-300">{run.errorMessage}</p> : null}
              </div>
              <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                {active ? <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-300" /> : run.status === "completed" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />}
                {duration(run)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
