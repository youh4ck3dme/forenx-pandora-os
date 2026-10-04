"use client";

import { AddPanel, EventForm } from "@/components/malte/CaseForms";
import { useActiveCase } from "@/hooks/useActiveCase";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Crosshair,
  Download,
  Network,
  ShieldAlert,
  Users,
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
import { Button } from "@/components/ui/button";
import { RiskFilter } from "@/components/malte/RiskFilter";
import { RiskGauge } from "@/components/malte/RiskGauge";
import { RiskBar } from "@/components/malte/Charts";
import { EmptyState } from "@/components/malte/EmptyState";
import { CommandPaletteTrigger } from "@/components/malte/CommandPalette";
import {
  DetectorSheet,
  type DetectorTarget,
} from "@/components/malte/DetectorSheet";
import { useCaseStore, passesFilter } from "@/hooks/useCaseStore";
import { exportCaseReport } from "@/lib/forza/report";
import { toast } from "sonner";
import { formatEur, severityLabel, type Severity } from "@/lib/forza/forensic";
import { alertTarget } from "@/lib/forza/alert-target";
import { BRAND } from "@/config/brand";
import { useAccountProfile } from "@/hooks/useAccountProfile";
import { isProfileSkipped } from "@/lib/forza/onboarding";
import { QuickUploadCard } from "@/components/malte/QuickUploadCard";
import { CaseStartHub } from "@/components/malte/CaseStartHub";

export default function PrehladPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-foreground" />}>
      <PrehladContent />
    </Suspense>
  );
}

function PrehladContent() {
  const searchParams = useSearchParams();
  const start = searchParams.get("start");
  const { activeCase, analysis, refresh } = useActiveCase();
  const showStartHub =
    start === "1" ||
    (Boolean(activeCase.id) &&
      analysis.totals.entities === 0 &&
      (analysis.alerts?.length ?? 0) === 0);
  const { totals, caseScore, caseLevel, alerts, topFlags, chains } = analysis;
  const { state, countExport } = useCaseStore();
  const profile = useAccountProfile();
  const profileReminder =
    !profile.isLoading &&
    !profile.isError &&
    !(profile.data?.completed ?? false) &&
    isProfileSkipped(profile.accountKey);
  const [target, setTarget] = useState<DetectorTarget | null>(null);
  const counts = alerts.reduce<Partial<Record<Severity, number>>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});
  const visible = alerts.filter((a) =>
    passesFilter(state.riskFilter, a.severity),
  );
  const stats = [
    {
      label: "Subjekty",
      value: String(totals.entities),
      icon: Users,
      to: "/forza/osoby",
    },
    {
      label: "Firmy",
      value: String(totals.companies),
      icon: Building2,
      to: "/forza/osoby",
    },
    {
      label: "Zbrane",
      value: String(totals.weapons),
      icon: Crosshair,
      to: "/forza/zbrane",
    },
    {
      label: "Reťazce",
      value: String(chains.length),
      icon: Network,
      to: "/forza/siet",
    },
  ];

  const exportReport = () => {
    if (exportCaseReport(analysis, state.riskFilter)) {
      countExport();
      toast.success("Správa vygenerovaná — uložte ako PDF v dialógu tlače.");
    } else {
      toast.error("Export sa nepodarilo spustiť.");
    }
  };

  return (
    <PhoneFrame>
      <AppHeader title={`${BRAND.name} — prehľad prípadu`} brand>
        <div className="px-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border liquid-glass-card px-4 py-3 text-header-foreground shadow-card sm:grid-cols-[minmax(0,1fr)_6rem_minmax(8rem,auto)]">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase text-primary">
                Prebiehajúci prípad
              </p>
              <p className="mt-1 truncate font-welcome-heading text-base font-bold text-header-foreground">
                {activeCase.name}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {activeCase.subtitle}
              </p>
            </div>
            <RiskGauge
              score={caseScore}
              level={caseLevel}
              size={88}
              label="/100"
            />
            <div className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 pt-2 sm:col-span-1 sm:block sm:border-t-0 sm:border-l sm:py-1 sm:pl-4">
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-primary">
                  Celková rizikovosť
                </p>
                <p className="mt-0.5 truncate text-lg font-extrabold text-header-foreground">
                  {severityLabel[caseLevel].toUpperCase()}
                </p>
              </div>
              {topFlags.length > 0 ? (
                <div className="flex min-w-0 justify-end gap-1 sm:mt-2 sm:justify-start">
                  {topFlags.slice(0, 1).map((flag) => (
                    <RiskChip key={flag.code}>{flag.label}</RiskChip>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </AppHeader>

      <Screen>
        {showStartHub && activeCase.id ? (
          <CaseStartHub caseId={activeCase.id} />
        ) : null}
        {activeCase.id ? <QuickUploadCard /> : null}
        {activeCase.id ? (
          <AddPanel label="Pridať udalosť do časovej osi">
            <EventForm caseId={activeCase.id} onSaved={refresh} />
          </AddPanel>
        ) : null}
        {profileReminder ? (
          <Card className="flex items-center gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Doplňte svoj profil</p>
              <p className="text-caption">
                Meno a funkcia sa zobrazujú vo vašich správach a exportoch.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="ml-auto">
              <Link href="/forza/profil">Doplniť</Link>
            </Button>
          </Card>
        ) : null}

        <div className="lg:hidden">
          <CommandPaletteTrigger />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, to }) => (
            <Link key={label} href={to} className="block">
              <Card className="flex items-center gap-3 hover:shadow-elevated">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-label">{label}</p>
                  <p className="text-metric">{value}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-risk-high" aria-hidden />
              <p className="text-sm font-semibold">Kľúčové ukazovatele</p>
            </div>
            <Metric label="Objem transakcií" value={formatEur(totals.volume)} />
            <Metric
              label="Podiel hotovosti"
              value={
                totals.cashRatio === null
                  ? "n/a"
                  : `${Math.round(totals.cashRatio * 100)} %`
              }
            />
            <Metric
              label="Zhody EUROPOL"
              value={`${totals.europolMatches} / ${totals.weapons}`}
              tone="high"
            />
          </Card>

          <Card className="space-y-3">
            <p className="text-sm font-semibold">Rozdelenie zistení</p>
            <RiskBar
              segments={[
                {
                  label: "Kritické",
                  value: counts.critical ?? 0,
                  color: "var(--risk-high)",
                },
                {
                  label: "Vysoké",
                  value: counts.high ?? 0,
                  color: "var(--risk-medium)",
                },
                {
                  label: "Stredné",
                  value: counts.medium ?? 0,
                  color: "var(--primary-glow)",
                },
                {
                  label: "Nízke",
                  value: counts.low ?? 0,
                  color: "var(--risk-low)",
                },
              ]}
            />
            <p className="text-caption">
              Spolu {alerts.length} zistení z {totals.transactions} transakcií a{" "}
              {totals.entities} subjektov.
            </p>
          </Card>
        </div>

        <SectionTitle
          action={
            <Link
              href="/forza/analyza-vypisov"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Všetko <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          }
        >
          Zistenia ({visible.length})
        </SectionTitle>

        <div className="sticky top-17 z-10 -mx-1 rounded-xl px-1 py-1 surface-glass">
          <RiskFilter counts={counts} />
        </div>

        <Card className="divide-y divide-border p-0" aria-live="polite">
          {visible.slice(0, 8).map((alert) => (
            <button
              type="button"
              key={alert.id}
              onClick={() => setTarget(alertTarget(alert.id))}
              disabled={alertTarget(alert.id) === null}
              className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-risk-high/12 text-risk-high">
                <AlertTriangle className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{alert.title}</p>
                <p className="truncate text-caption">{alert.detail}</p>
              </div>
              <span className="ml-auto">
                <RiskChip level={alert.severity}>{alert.score}</RiskChip>
              </span>
            </button>
          ))}
          {visible.length === 0 ? (
            <EmptyState
              title="Žiadne zistenia pre tento filter"
              detail="Uvoľnite rizikový filter alebo si pozrite kompletnú analýzu transakcií."
            />
          ) : null}
        </Card>

        <Button asChild size="lg" className="w-full">
          <Link href="/forza/analyza-vypisov">
            Otvoriť analýzu prípadu
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="w-full"
          onClick={exportReport}
        >
          <Download className="h-4 w-4" aria-hidden />
          Exportovať správu do PDF
        </Button>
      </Screen>

      <DetectorSheet target={target} onClose={() => setTarget(null)} />
      <BottomNav />
    </PhoneFrame>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "high";
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-semibold tnum ${tone === "high" ? "text-risk-high" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
