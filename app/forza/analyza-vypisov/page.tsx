"use client";

import { TransactionList } from "@/components/malte/RecordLists";
import { AddPanel, TransactionForm } from "@/components/malte/CaseForms";
import { useActiveCase } from "@/hooks/useActiveCase";
import { EmptyState, ForzaModuleSkeleton } from "@/components/malte/EmptyState";
import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Globe2,
  Layers,
  Loader2,
} from "lucide-react";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  RiskChip,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { BalanceChart, DonutChart } from "@/components/malte/Charts";
import { Button } from "@/components/ui/button";
import { RiskFilter } from "@/components/malte/RiskFilter";
import {
  DetectorSheet,
  type DetectorTarget,
} from "@/components/malte/DetectorSheet";
import { useCaseStore, passesFilter } from "@/hooks/useCaseStore";
import { exportCaseReport } from "@/lib/forza/report";
import { toast } from "sonner";
import {
  formatDate,
  formatEur,
  severityLabel,
  type Severity,
} from "@/lib/forza/forensic";
import { BRAND } from "@/config/brand";

export default function AnalyzaVypisovPage() {
  return <StatementAnalysis />;
}

const flagIcon = {
  critical: AlertTriangle,
  high: AlertTriangle,
  medium: Layers,
  low: Banknote,
};
const flagTone = {
  critical: "bg-risk-high text-risk-high-foreground",
  high: "bg-risk-high/12 text-risk-high",
  medium: "bg-risk-medium/15 text-risk-medium",
  low: "bg-risk-low/15 text-risk-low",
};

function StatementAnalysis() {
  const { activeCase, analysis, refresh, revisions, loading } = useActiveCase();
  const { transactions, totals, crossBorder } = analysis;
  const { state, countExport } = useCaseStore();
  const [target, setTarget] = useState<DetectorTarget | null>(null);
  const [dimitriReport, setDimitriReport] = useState<
    import("@/lib/forza/forensic").DimitriCheckerReport | null
  >(null);
  const [dimitriWarnings, setDimitriWarnings] = useState<string[]>([]);
  const [rawDimitriPayload, setRawDimitriPayload] = useState<unknown>(null);
  const [isImportingDimitri, setIsImportingDimitri] = useState(false);

  const balanceSeries = useMemo(() => {
    let running = 0;
    return activeCase.transactions.map((t) => {
      running += t.amount;
      return running;
    });
  }, [activeCase.transactions]);

  if (loading) {
    return (
      <PhoneFrame>
        <AppHeader title="Analýza transakcií" />
        <Screen><ForzaModuleSkeleton /></Screen>
        <BottomNav />
      </PhoneFrame>
    );
  }

  const handleDimitriFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    type: "json" | "csv",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const { parseDimitriCheckerReport, validateDimitriReferences } =
        await import("@/lib/forza/forensic");
      const report = parseDimitriCheckerReport(text);
      const { warnings } = validateDimitriReferences(report, activeCase);

      setRawDimitriPayload(type === "json" ? JSON.parse(text) : text);
      setDimitriReport(report);
      setDimitriWarnings(warnings);
    } catch (err) {
      toast.error(
        `Spracovanie ${type.toUpperCase()} zlyhalo: ${(err as Error).message}`,
      );
    }
  };

  const confirmDimitriImport = async () => {
    if (!dimitriReport || !rawDimitriPayload || isImportingDimitri) return;
    setIsImportingDimitri(true);
    try {
      const { importDimitriCheckerReport } =
        await import("@/lib/forza/dimitri.functions");
      const res = await importDimitriCheckerReport({
        data: {
          caseId: activeCase.id,
          reportPayload: rawDimitriPayload,
        },
      });
      toast.success(
        `Dimitri report bol importovaný (nové transakcie: ${res.newTransactionsCount}, nové subjekty: ${res.newEntitiesCount}).`,
      );
      refresh();
      setDimitriReport(null);
      setRawDimitriPayload(null);
    } catch (err) {
      toast.error(`Import zlyhal: ${(err as Error).message}`, {
        action: { label: "Skúsiť znova", onClick: () => void confirmDimitriImport() },
      });
    } finally {
      setIsImportingDimitri(false);
    }
  };

  const flagged = transactions.filter((t) =>
    passesFilter(state.riskFilter, t.level),
  );

  const counts = transactions.reduce<Partial<Record<Severity, number>>>(
    (acc, t) => {
      acc[t.level] = (acc[t.level] ?? 0) + 1;
      return acc;
    },
    {},
  );

  if (activeCase.transactions.length === 0) {
    return (
      <PhoneFrame>
        <AppHeader title="Analýza transakcií" />
        <Screen>
          <AddPanel label="Pridať prvú transakciu">
            <TransactionForm
              caseId={activeCase.id}
              entities={activeCase.entities}
              baseCurrency={activeCase.baseCurrency}
              onSaved={refresh}
            />
          </AddPanel>
          <EmptyState
            title="Žiadne transakcie v prípade"
            detail="Pridajte transakcie ručne vyššie alebo nahrajte bankový výpis."
            action={<Button asChild size="sm"><a href="/forza/import-csv">Importovať bankový výpis</a></Button>}
          />
        </Screen>
        <BottomNav />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <AppHeader title="Analýza transakcií" />
      <Screen>
        <AddPanel label="Pridať transakciu">
          <TransactionForm
            caseId={activeCase.id}
            entities={activeCase.entities}
            baseCurrency={activeCase.baseCurrency}
            onSaved={refresh}
          />
        </AddPanel>

        {dimitriReport && (
          <Card className="space-y-3 border-risk-high/40 bg-risk-high/5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-risk-high shrink-0" />
              <div>
                <p className="text-sm font-bold text-foreground">
                  Náhľad Dimitri Audit Reportu ({dimitriReport.caseReference || dimitriReport.reportId})
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Detekovaných signálov: {dimitriReport.signals.length} | Trás: {dimitriReport.routes.length} |
                  Sprostredkovateľov: {dimitriReport.intermediaries.length}
                </p>
              </div>
            </div>

            {dimitriWarnings.length > 0 && (
              <div className="rounded-lg bg-risk-medium/15 p-2 text-xs space-y-1 text-risk-medium">
                <p className="font-semibold">Upozornenia k referenciám:</p>
                {dimitriWarnings.map((w, idx) => (
                  <p key={idx} className="text-[11px]">
                    • {w}
                  </p>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <Button size="sm" disabled={isImportingDimitri} onClick={confirmDimitriImport}>
                {isImportingDimitri ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {isImportingDimitri ? "Importujem…" : "Schváliť a importovať do prípadu"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isImportingDimitri}
                onClick={() => setDimitriReport(null)}
              >
                Zrušiť
              </Button>
            </div>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Metóda platieb
            </p>
            <DonutChart
              incomeRatio={1 - (totals.cashRatio ?? 0)}
              caption="bezhotovostne"
            />
            <Legend
              color="var(--primary)"
              label="Banka"
              value={formatEur(totals.volume * (1 - (totals.cashRatio ?? 0)))}
            />
            <Legend
              color="var(--risk-medium)"
              label="Hotovosť"
              value={formatEur(totals.volume * (totals.cashRatio ?? 0))}
            />
          </Card>

          <Card className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">
              Zostatok v čase
            </p>
            <BalanceChart
              data={balanceSeries.length > 0 ? balanceSeries : [0]}
              format={(v) => formatEur(v)}
            />
          </Card>
        </div>

        <SectionTitle>Správa transakcií prípadu</SectionTitle>
        <TransactionList
          caseId={activeCase.id}
          entities={activeCase.entities}
          transactions={activeCase.transactions}
          baseCurrency={activeCase.baseCurrency}
          revisions={revisions}
          onChanged={() => void refresh()}
        />

        {analysis.temporalPatterns.length > 0 ? (
          <Card className="space-y-2">
            <p className="text-xs font-semibold">Forenzné vzorce tokov</p>
            {analysis.temporalPatterns.map((p) => {
              const firstTxId = p.transactionIds[0];
              return (
                <button
                  type="button"
                  key={p.code}
                  onClick={() => {
                    if (firstTxId) {
                      setTarget({ kind: "transaction", id: firstTxId });
                    }
                  }}
                  className="w-full space-y-1 rounded-lg border border-border/60 p-2.5 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold">{p.label}</p>
                    <span className="ml-auto">
                      <RiskChip level={p.severity}>{p.score}/100</RiskChip>
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{p.detail}</p>
                  <p className="text-[10px] text-muted-foreground tnum">
                    {p.transactionIds.length} transakcií
                  </p>
                </button>
              );
            })}
          </Card>
        ) : null}

        <SectionTitle>Detekcia ({flagged.length})</SectionTitle>

        <RiskFilter counts={counts} />

        <Card className="divide-y divide-border p-0">
          {flagged.map(({ transaction, flags, level, score }) => {
            const Icon = flagIcon[level];
            return (
              <button
                type="button"
                key={transaction.id}
                onClick={() =>
                  setTarget({ kind: "transaction", id: transaction.id })
                }
                className="block w-full space-y-2 p-4 text-left transition-colors hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${flagTone[level]}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {transaction.description}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground tnum">
                      {formatDate(transaction.date)} •{" "}
                      {formatEur(transaction.amount)} •{" "}
                      {transaction.method === "cash" ? "hotovosť" : "prevod"}
                    </p>
                  </div>
                  <span className="ml-auto">
                    <RiskChip level={level}>
                      {severityLabel[level]} {score}
                    </RiskChip>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-12">
                  {flags.map((flag) => (
                    <span
                      key={flag.code}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                      title={flag.detail}
                    >
                      {flag.label}
                    </span>
                  ))}
                  {flags.length === 0 ? (
                    <span className="text-[10px] text-muted-foreground">
                      Bez príznakov
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
          {flagged.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">
              Žiadna transakcia nezodpovedá filtru.
            </p>
          ) : null}
        </Card>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            const ok = exportCaseReport(analysis, state.riskFilter);
            if (ok) {
              countExport();
              toast.success(
                "Správa vygenerovaná — uložte ako PDF v dialógu tlače.",
              );
            } else {
              toast.error("Export sa nepodarilo spustiť.");
            }
          }}
        >
          Exportovať výsledky do PDF
        </Button>
      </Screen>

      <DetectorSheet target={target} onClose={() => setTarget(null)} />
      <BottomNav />
    </PhoneFrame>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold tnum">{value}</span>
    </div>
  );
}
