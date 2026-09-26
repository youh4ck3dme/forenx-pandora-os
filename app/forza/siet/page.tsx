"use client";

import { useActiveCase } from "@/hooks/useActiveCase";
import { lazy, Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { openCommandPalette } from "@/components/malte/CommandPalette";
import { EmptyState } from "@/components/malte/EmptyState";
import { Button } from "@/components/ui/button";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  RiskChip,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import {
  DetectorSheet,
  type DetectorTarget,
} from "@/components/malte/DetectorSheet";
import { cn } from "@/lib/utils";
import { COUNTRY_LABEL, formatEur } from "@/lib/forza/forensic";

const NetworkGraph = lazy(() =>
  import("@/components/malte/NetworkGraph").then((m) => ({
    default: m.NetworkGraph,
  })),
);

export default function SietPage() {
  return <NetworkScreen />;
}

function ClientOnlyWrapper({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <>{fallback}</>;
  return <>{children}</>;
}

function NetworkScreen() {
  const { analysis } = useActiveCase();
  const nameOf = (id: string) =>
    analysis.entities.find((e) => e.entity.id === id)?.entity.name ?? id;
  const [target, setTarget] = useState<DetectorTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [pathId, setPathId] = useState<string | null>(
    analysis.moneyPaths[0]?.id ?? null,
  );

  const activePath = analysis.moneyPaths.find((p) => p.id === pathId) ?? null;
  const hasGraph = analysis.entities.length > 0;

  return (
    <PhoneFrame>
      <AppHeader
        title="Sieťová analýza"
        actions={
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Hľadať v spise"
            title="Hľadať v spise (⌘K)"
            className="rounded-full p-1 transition-colors hover:bg-foreground/15 cursor-pointer"
          >
            <Search className="h-5 w-5 opacity-90" aria-hidden />
          </button>
        }
      />

      <Screen>
        {hasGraph ? (
          <Card className="overflow-hidden p-0">
            <ClientOnlyWrapper
              fallback={
                <div className="flex h-105 items-center justify-center text-xs text-muted-foreground">
                  Načítavam sieť…
                </div>
              }
            >
              <Suspense
                fallback={
                  <div className="flex h-105 items-center justify-center text-xs text-muted-foreground">
                    Načítavam sieť…
                  </div>
                }
              >
                <NetworkGraph
                  analysis={analysis}
                  {...(selectedId ? { selectedId } : {})}
                  {...(activePath
                    ? { highlightedPathIds: activePath.entityIds }
                    : {})}
                  onSelect={(id) => {
                    setSelectedId(id);
                    setTarget({ kind: "entity", id });
                  }}
                />
              </Suspense>
            </ClientOnlyWrapper>
          </Card>
        ) : (
          <EmptyState
            title="Zatiaľ žiadne prepojenia."
            detail="Nahrajte výpoveď v Sandboxe alebo upravte filtre časovej osi."
            action={
              <Button asChild size="sm">
                <Link href="/forza/sandbox">Otvoriť Sandbox</Link>
              </Button>
            }
          />
        )}

        <SectionTitle>Trasy peňazí ({analysis.moneyPaths.length})</SectionTitle>
        <Card className="space-y-2 p-3">
          {analysis.moneyPaths.map((path) => (
            <button
              key={path.id}
              type="button"
              onClick={() => setPathId(path.id === pathId ? null : path.id)}
              aria-pressed={path.id === pathId}
              className={cn(
                "w-full space-y-1 rounded-xl border p-3 text-left transition-colors",
                path.id === pathId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent",
              )}
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold">
                  {path.hops} kroky • {formatEur(path.amount)}
                </p>
                <span className="ml-auto">
                  <RiskChip level={path.severity}>{path.score}/100</RiskChip>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {path.entityIds.map(nameOf).join(" → ")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {path.spanDays} dní
                {path.viaShellIds.length > 0
                  ? ` • cez ${path.viaShellIds.length} schránkovú firmu`
                  : ""}
                {path.crossesBorder ? " • cezhraničné" : ""}
                {path.returnsToOrigin ? " • návrat k pôvodcovi" : ""}
              </p>
            </button>
          ))}
          {analysis.moneyPaths.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Žiadna viackroková trasa nebola nájdená.
            </p>
          ) : null}
        </Card>

        <SectionTitle>
          Signály prania peňazí ({analysis.launderingSignals.length})
        </SectionTitle>
        <Card className="divide-y divide-border p-0">
          {analysis.launderingSignals.map((s) => (
            <button
              key={`${s.code}-${s.entityId}`}
              type="button"
              onClick={() => {
                setSelectedId(s.entityId);
                setTarget({ kind: "entity", id: s.entityId });
              }}
              className="w-full space-y-1 p-3 text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold">
                  {s.label} — {nameOf(s.entityId)}
                </p>
                <span className="ml-auto">
                  <RiskChip level={s.severity}>{s.score}/100</RiskChip>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{s.detail}</p>
            </button>
          ))}
          {analysis.launderingSignals.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              Žiadne signály prania peňazí zatiaľ neboli nájdené.
            </p>
          ) : null}
        </Card>

        <SectionTitle>Cezhraničné koridory</SectionTitle>
        <Card className="space-y-2">
          {analysis.corridors.map((c) => (
            <div key={c.route} className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold">
                  {COUNTRY_LABEL[c.originCountry] ?? c.originCountry} →{" "}
                  {COUNTRY_LABEL[c.destinationCountry] ?? c.destinationCountry}
                </span>
                <span className="ml-auto tnum text-muted-foreground">
                  {c.count}× • {formatEur(c.amount)}
                </span>
                <RiskChip level={c.severity}>{c.score}</RiskChip>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full",
                    c.highRisk ? "bg-risk-high" : "bg-primary",
                  )}
                  style={{ width: `${c.score}%` }}
                />
              </div>
            </div>
          ))}
          {analysis.corridors.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Žiadne cezhraničné koridory zatiaľ neboli nájdené.
            </p>
          ) : null}
        </Card>

        <SectionTitle>
          Reťazce obchodovania ({analysis.chains.length})
        </SectionTitle>
        <Card className="space-y-3">
          {analysis.chains.map((chain) => (
            <button
              key={chain.shellId}
              type="button"
              onClick={() => {
                setSelectedId(chain.shellId);
                setTarget({ kind: "entity", id: chain.shellId });
              }}
              className="block w-full space-y-1 rounded-lg text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">{nameOf(chain.shellId)}</p>
                <span className="ml-auto">
                  <RiskChip level={chain.severity}>
                    {chain.severity === "critical" ? "Kritické" : "Vysoké"}
                  </RiskChip>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {chain.supplierIds.map(nameOf).join(", ")} →{" "}
                <span className="font-semibold text-risk-high">schránka</span> →{" "}
                {chain.buyerIds.map(nameOf).join(", ")}
              </p>
            </button>
          ))}
          {analysis.chains.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Žiadne reťazce obchodovania zatiaľ neboli nájdené.
            </p>
          ) : null}
        </Card>
      </Screen>

      <DetectorSheet target={target} onClose={() => setTarget(null)} />
      <BottomNav />
    </PhoneFrame>
  );
}
