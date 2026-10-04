import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/malte/Shell";
import { useForenzxJobEvents } from "@/hooks/useForenzxJobEvents";

export function ForenzxJobProgress({ jobId }: { jobId: string }) {
  const { status, connected, error } = useForenzxJobEvents(jobId);
  if (!status && !error) return null;
  const terminal = status?.state === "COMPLETED" || status?.state === "FAILED" || status?.state === "CANCELLED";
  const failed = status?.state === "FAILED" || status?.state === "CANCELLED" || Boolean(error);

  return (
    <Card className="space-y-2 border-primary/30 bg-black/75 p-3" aria-label="ForenZX priebeh analýzy">
      <div className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        <span>ForenZX analýza · {status?.pack_id ?? "MCP"}</span>
        {failed ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : terminal ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Loader2 className="h-4 w-4 animate-spin text-amber-300" />}
      </div>
      {status ? <Progress value={status.progress_percent} aria-label={`Priebeh ${status.progress_percent}%`} /> : null}
      <p className="text-xs text-foreground">
        {status ? `${status.current_stage} · ${status.progress_percent}% · ${status.state}` : error}
      </p>
      {status?.error_message ? <p className="text-xs text-rose-300">{status.error_message}</p> : null}
      {!connected && !terminal ? <p className="text-[11px] text-muted-foreground">Stream bol prerušený.</p> : null}
    </Card>
  );
}
