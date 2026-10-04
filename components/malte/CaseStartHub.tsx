import Link from "next/link";
import { FileSearch, Sparkles } from "lucide-react";
import { Card } from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";

/**
 * Hub po založení prípadu — jasne rozlišuje Autopilot (bulk AI) vs Sandbox (entity).
 */
export function CaseStartHub({ caseId }: { caseId?: string }) {
  const caseParam = caseId ? `&case=${caseId}` : "";
  return (
    <Card
      className="space-y-3 border-primary/30 bg-primary/5"
      id="case-start-hub"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">
          Ako chcete pokračovať?
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          Autopilot = hromadné nahrávanie spisov, OCR a AI pracovná analýza +
          PDF. Sandbox = entity, kontroly a postupné dopĺňanie grafu.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild className="min-h-11 w-full justify-start gap-2">
          <Link href="/forza/asistent">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block text-xs font-bold">
                Forenzný Autopilot
              </span>
              <span className="block text-[10px] font-normal opacity-90">
                Spis → analýza → PDF
              </span>
            </span>
          </Link>
        </Button>
        <Button
          asChild
          variant="outline"
          className="min-h-11 w-full justify-start gap-2"
        >
          <Link href={`/forza/sandbox?upload=1${caseParam}`}>
            <FileSearch className="h-4 w-4 shrink-0" aria-hidden />
            <span className="text-left leading-tight">
              <span className="block text-xs font-bold">AI Sandbox</span>
              <span className="block text-[10px] font-normal opacity-90">
                Entity a kontroly
              </span>
            </span>
          </Link>
        </Button>
      </div>
    </Card>
  );
}
