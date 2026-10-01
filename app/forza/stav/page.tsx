"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  Database,
  FileCheck2,
  FolderOpen,
  Gauge,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { Button } from "@/components/ui/button";
import {
  PublicHealthResponseSchema,
  type PublicHealthCheck,
  type PublicHealthResponse,
  type PublicHealthStatus,
} from "@/lib/forza/public-health";
import { testPdfExportCapability } from "@/lib/forza/export-pdf";

const CHECK_ICONS = {
  "application-server": Server,
  database: Database,
  "case-storage": FolderOpen,
  "database-latency": Gauge,
  "database-connections": Database,
  "idle-transactions": Database,
  "waiting-locks": CircleAlert,
  "database-size": Database,
  "document-storage": FolderOpen,
  "s3-vault": ShieldCheck,
  "mistral-chat": Server,
  "mistral-analysis": Server,
  "ai-telemetry": Gauge,
  "ai-success": Gauge,
  "system-errors": TriangleAlert,
  "pdf-export": FileCheck2,
} as const;

const STATUS_LABELS: Record<PublicHealthStatus, string> = {
  ok: "V poriadku",
  attention: "Vyžaduje pozornosť",
  unavailable: "Nedostupné",
};

const STATUS_STYLES: Record<PublicHealthStatus, string> = {
  ok: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  attention: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  unavailable: "border-rose-400/30 bg-rose-400/10 text-rose-200",
};

const STATUS_ICONS: Record<PublicHealthStatus, typeof CheckCircle2> = {
  ok: CheckCircle2,
  attention: AlertTriangle,
  unavailable: XCircle,
};

async function fetchPublicHealth(): Promise<PublicHealthResponse> {
  const response = await fetch("/api/health/public", {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const payload: unknown = await response.json().catch(() => null);
  const parsed = PublicHealthResponseSchema.safeParse(payload);
  if (!response.ok || !parsed.success) {
    throw new Error("Live stav systému sa nepodarilo načítať.");
  }
  return parsed.data;
}

function formatCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "čas neznámy";
  return date.toLocaleTimeString("sk-SK", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatusBadge({ status }: { status: PublicHealthStatus }) {
  const Icon = STATUS_ICONS[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-bold ${STATUS_STYLES[status]}`}
      role="status"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {STATUS_LABELS[status]}
    </span>
  );
}

function HealthCheckCard({
  check,
  checkedAt,
}: {
  check: PublicHealthCheck;
  checkedAt: string;
}) {
  const Icon = CHECK_ICONS[check.id as keyof typeof CHECK_ICONS] ?? Gauge;
  const measurementTimestamp = check.measuredAt || checkedAt;
  const isStale = Date.now() - new Date(measurementTimestamp).getTime() > 60_000;

  return (
    <Card className="flex min-h-36 flex-col gap-3 border-white/15 bg-black/75 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white/80">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <h3 className="text-sm font-semibold leading-tight text-white">
            {check.title}
          </h3>
        </div>
        <StatusBadge status={check.status} />
      </div>
      <p className="text-xs leading-relaxed text-white/65">{check.description}</p>
      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-bold text-white">{check.value}</p>
          {isStale ? (
            <span className="rounded bg-amber-400/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
              Zastarané (&gt;60s)
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/45">
          <span>{check.measurement === "live" ? "Live meranie" : "Lokálna schopnosť klienta"}</span>
          <span>{formatCheckedAt(measurementTimestamp)}</span>
        </div>
      </div>
    </Card>
  );
}

function SummaryCard({ data }: { data: PublicHealthResponse }) {
  const statusCopy = {
    ok: "Systém je v poriadku",
    attention: "Systém vyžaduje pozornosť",
    unavailable: "Systém je čiastočne nedostupný",
  }[data.overallStatus];
  const SummaryIcon = STATUS_ICONS[data.overallStatus];

  return (
    <Card className={`border p-5 ${STATUS_STYLES[data.overallStatus]}`}>
      <div className="flex items-center gap-3">
        <SummaryIcon className="h-7 w-7 shrink-0" aria-hidden />
        <div>
          <p className="text-xs font-bold uppercase tracking-wider">Live stav systému</p>
          <h2 className="mt-1 text-lg font-bold text-white">{statusCopy}</h2>
        </div>
      </div>
      <p className="mt-4 text-xs text-white/70">
        Posledná aktualizácia: {formatCheckedAt(data.checkedAt)}
      </p>
    </Card>
  );
}

export default function StavPage() {
  const query = useQuery({
    queryKey: ["public-system-health"],
    queryFn: fetchPublicHealth,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  // P5: Lokálny self-test PDF exportu v prehliadači namiesto fixnej hodnoty
  const pdfSelfTest = useMemo(() => {
    return testPdfExportCapability();
  }, []);

  const checksWithClientTests = useMemo(() => {
    if (!query.data) return [];
    return query.data.checks.map((check) => {
      if (check.id === "pdf-export" && pdfSelfTest) {
        return {
          ...check,
          status: pdfSelfTest.status,
          value: pdfSelfTest.value,
          description: pdfSelfTest.reason
            ? `Lokálny self-test: ${pdfSelfTest.reason}`
            : "Lokálny self-test v prehliadači overil window.print rozhranie aj generovanie reportu a manifestu.",
        };
      }
      return check;
    });
  }, [query.data, pdfSelfTest]);

  const lastUpdateError = query.isError && query.data
    ? "Aktualizácia zlyhala. Zobrazuje sa posledný úspešne načítaný stav."
    : null;

  return (
    <PhoneFrame>
      <AppHeader
        title="Stav systému"
        actions={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Obnoviť stav systému"
          >
            <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          </Button>
        }
      />
      <Screen>
        {query.isLoading ? (
          <Card className="flex items-center gap-3 text-sm text-white/80">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            Načítavam aktuálny stav systému…
          </Card>
        ) : null}

        {query.isError && !query.data ? (
          <Card className="border-rose-400/30 bg-rose-400/10 text-rose-100">
            <div className="flex items-center gap-2 font-semibold">
              <XCircle className="h-5 w-5" aria-hidden />
              Stav systému je momentálne nedostupný.
            </div>
            <p className="mt-2 text-xs text-rose-100/75">Skúste obnoviť údaje neskôr.</p>
          </Card>
        ) : null}

        {lastUpdateError ? (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100" role="alert">
            {lastUpdateError}
          </div>
        ) : null}

        {query.data ? <SummaryCard data={query.data} /> : null}

        {query.data ? (
          <>
            <SectionTitle
              action={query.isFetching ? <span className="text-xs text-muted-foreground">Aktualizujem…</span> : null}
            >
              Kontroly systému
            </SectionTitle>
            <div className="grid gap-3 lg:grid-cols-2">
              {checksWithClientTests.map((check) => (
                <HealthCheckCard
                  key={check.id}
                  check={check}
                  checkedAt={query.data.checkedAt}
                />
              ))}
            </div>
          </>
        ) : null}
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}

