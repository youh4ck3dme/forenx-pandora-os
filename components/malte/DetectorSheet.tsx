import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskChip } from "@/components/malte/Shell";
import { useCaseStore } from "@/hooks/useCaseStore";
import {
  detectShellCompany,
  formatDate,
  formatEur,
  isShell,
  levelFromScore,
  monitorTransaction,
  scoreFromFlags,
  severityLabel,
  type Flag,
  type Severity,
  type ForensicCase,
} from "@/forensic";
import { useActiveCase } from "@/hooks/useActiveCase";

export type DetectorTarget =
  { kind: "entity"; id: string } | { kind: "transaction"; id: string };

type Result = {
  title: string;
  subtitle: string;
  detector: string;
  score: number;
  level: Severity;
  flags: Flag[];
  facts: { label: string; value: string }[];
  verdict: string;
};

function runDetector(
  target: DetectorTarget,
  activeCase: ForensicCase,
): Result | null {
  if (target.kind === "entity") {
    const entity = activeCase.entities.find((e) => e.id === target.id);
    if (!entity) return null;
    const flags = detectShellCompany(
      entity,
      activeCase,
      activeCase.transactions,
    );
    const score = scoreFromFlags(flags);
    const own = activeCase.transactions.filter(
      (t) =>
        t.fromId === entity.id ||
        t.toId === entity.id ||
        t.payerId === entity.id,
    );
    return {
      title: entity.name,
      subtitle: entity.role,
      detector: "detectShellCompany()",
      score,
      level: levelFromScore(score),
      flags,
      facts: [
        { label: "Deklarovaná adresa", value: entity.address ?? "—" },
        {
          label: "Adresa v ORSR",
          value:
            (entity.ico ? activeCase.orsrAddresses[entity.ico] : undefined) ??
            "nenájdená",
        },
        { label: "IČO", value: entity.ico ?? "—" },
        {
          label: "Transakcie",
          value: `${own.length} • ${formatEur(own.reduce((s, t) => s + t.amount, 0))}`,
        },
        {
          label: "Fyzický inventár",
          value: entity.physicalInventory === false ? "nezistený" : "áno",
        },
      ],
      verdict: isShell(flags)
        ? "Subjekt vykazuje znaky schránkovej firmy."
        : entity.kind === "company"
          ? "Znaky schránkovej firmy neboli potvrdené."
          : "Detektor schránkových firiem sa na fyzickú osobu nevzťahuje.",
    };
  }

  const transaction = activeCase.transactions.find((t) => t.id === target.id);
  if (!transaction) return null;
  const analysis = monitorTransaction(transaction, activeCase.transactions);
  const nameOf = (id?: string) =>
    id ? (activeCase.entities.find((e) => e.id === id)?.name ?? id) : "—";
  return {
    title: transaction.description,
    subtitle: `${formatDate(transaction.date)} • ${formatEur(transaction.amount)}`,
    detector: "monitorTransaction()",
    score: analysis.score,
    level: analysis.level,
    flags: analysis.flags,
    facts: [
      { label: "Odosielateľ", value: nameOf(transaction.fromId) },
      { label: "Príjemca", value: nameOf(transaction.toId) },
      {
        label: "Skutočný platiteľ",
        value: nameOf(transaction.payerId ?? transaction.fromId),
      },
      {
        label: "Forma",
        value: transaction.method === "cash" ? "hotovosť" : "prevod",
      },
      {
        label: "Trasa",
        value: `${transaction.originCountry} → ${transaction.destinationCountry}`,
      },
    ],
    verdict:
      analysis.flags.length === 0
        ? "Transakcia neaktivovala žiadne pravidlo."
        : `Aktivovaných ${analysis.flags.length} pravidiel monitoringu.`,
  };
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return desktop;
}

export function DetectorSheet({
  target,
  onClose,
}: {
  target: DetectorTarget | null;
  onClose: () => void;
}) {
  const { state, logRun, toggleReviewed } = useCaseStore();
  const { activeCase } = useActiveCase();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const desktop = useIsDesktop();

  useEffect(() => {
    if (!target) {
      setResult(null);
      return;
    }
    setRunning(true);
    setResult(null);
    const timer = window.setTimeout(() => {
      const next = runDetector(target, activeCase);
      setResult(next);
      setRunning(false);
      if (next) {
        logRun({
          id: `${target.kind}:${target.id}`,
          target: next.title,
          detector: next.detector,
          score: next.score,
          level: next.level,
          flagCount: next.flags.length,
        });
      }
    }, 320);
    return () => window.clearTimeout(timer);
    // logRun je stabilné cez useMemo v store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id, activeCase]);

  const reviewedId = target ? `${target.kind}:${target.id}` : "";
  const reviewed = state.reviewed.includes(reviewedId);

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={
          desktop
            ? "w-full max-w-[440px] overflow-y-auto p-6"
            : "mx-auto max-h-[85vh] w-full max-w-[420px] overflow-y-auto rounded-t-3xl"
        }
      >
        {running || !result ? (
          <div className="space-y-4 p-2" aria-busy="true">
            <p className="text-caption">Spúšťam detekciu…</p>
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ) : (
          <div className="animate-rise space-y-4">
            <SheetHeader className="px-0 text-left">
              <SheetTitle className="text-base">{result.title}</SheetTitle>
              <SheetDescription>{result.subtitle}</SheetDescription>
            </SheetHeader>

            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-risk-high/12 text-risk-high">
                <ShieldAlert className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {result.detector}
                </p>
                <p className="text-sm font-semibold">{result.verdict}</p>
              </div>
              <span className="ml-auto">
                <RiskChip level={result.level}>
                  {severityLabel[result.level]} {result.score}
                </RiskChip>
              </span>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Zistené príznaky ({result.flags.length})
              </p>
              <div className="space-y-2">
                {result.flags.map((flag) => (
                  <div
                    key={flag.code}
                    className="rounded-xl border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{flag.label}</p>
                      <span className="ml-auto">
                        <RiskChip level={flag.severity}>
                          +{flag.weight}
                        </RiskChip>
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {flag.detail}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {flag.code}
                    </p>
                  </div>
                ))}
                {result.flags.length === 0 ? (
                  <p className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
                    Žiadne pravidlo nebolo aktivované.
                  </p>
                ) : null}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Vstupné údaje
              </p>
              <dl className="space-y-1 rounded-xl border border-border p-3 text-xs">
                {result.facts.map((fact) => (
                  <div
                    key={fact.label}
                    className="flex items-start justify-between gap-4"
                  >
                    <dt className="text-muted-foreground">{fact.label}</dt>
                    <dd className="text-right font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <Button
              variant={reviewed ? "secondary" : "default"}
              className="w-full"
              onClick={() => toggleReviewed(reviewedId)}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {reviewed ? "Označené ako preverené" : "Označiť ako preverené"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
