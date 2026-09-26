"use client";

import { AddPanel, RelationForm } from "@/components/malte/CaseForms";
import { EmptyState } from "@/components/malte/EmptyState";
import { useActiveCase } from "@/hooks/useActiveCase";
import { useState } from "react";
import Link from "next/link";
import { Building2, Search, User } from "lucide-react";
import { openCommandPalette } from "@/components/malte/CommandPalette";
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
import {
  DetectorSheet,
  type DetectorTarget,
} from "@/components/malte/DetectorSheet";
import { RiskFilter } from "@/components/malte/RiskFilter";
import { useCaseStore, passesFilter } from "@/hooks/useCaseStore";
import { cn } from "@/lib/utils";
import { formatEur } from "@/lib/forza/forensic";
import { BRAND } from "@/config/brand";

export default function VztahyPage() {
  return <Relations />;
}

function Relations() {
  const { activeCase, analysis, refresh } = useActiveCase();
  const byId = new Map(analysis.entities.map((e) => [e.entity.id, e]));
  const { state } = useCaseStore();
  const [target, setTarget] = useState<DetectorTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string>(
    analysis.entities[0]?.entity.id ?? "",
  );
  const [view, setView] = useState<"graph" | "list">("graph");
  const focus = byId.get(selectedId) ?? analysis.entities[0];
  const visible = analysis.entities.filter((e) =>
    passesFilter(state.riskFilter, e.level),
  );
  const visibleIds = new Set(visible.map((e) => e.entity.id));

  if (!focus) {
    return (
      <PhoneFrame>
        <AppHeader title="Vzťahy" />
        <Screen>
          <EmptyState
            title="Zatiaľ žiadne subjekty"
            detail="Pridajte subjekty v sekcii Prípady a vzťahová mapa sa vytvorí automaticky."
          />
        </Screen>
        <BottomNav />
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <AppHeader
        title="Vzťahy"
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
        <div className="flex gap-2">
          <AddPanel label="Pridať vzťah">
            <RelationForm
              caseId={activeCase.id}
              entities={activeCase.entities}
              onSaved={refresh}
            />
          </AddPanel>
          {(["graph", "list"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={cn(
                "h-8 rounded-full border px-4 text-xs font-medium transition-colors",
                view === option
                  ? "gradient-brand border-transparent text-primary-foreground shadow-sm"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {option === "graph" ? "Graf" : "Zoznam"}
            </button>
          ))}
        </div>

        <RiskFilter />

        {view === "graph" ? (
          <Card className="relative aspect-square overflow-hidden p-0">
            <svg
              viewBox="0 0 100 100"
              className="absolute inset-0 h-full w-full"
              aria-hidden
            >
              {activeCase.relations.map((rel) => {
                const from = byId.get(rel.fromId)?.entity;
                const to = byId.get(rel.toId)?.entity;
                if (!from || !to) return null;
                const risky =
                  byId.get(rel.fromId)?.isShell || byId.get(rel.toId)?.isShell;
                return (
                  <line
                    key={`${rel.fromId}-${rel.toId}-${rel.label}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={risky ? "var(--risk-high)" : "var(--border)"}
                    strokeWidth={risky ? 0.7 : 0.5}
                    strokeDasharray={risky ? undefined : "2 2"}
                  />
                );
              })}
            </svg>

            {analysis.entities.map((item) => (
              <button
                type="button"
                key={item.entity.id}
                onClick={() => {
                  setSelectedId(item.entity.id);
                  setTarget({ kind: "entity", id: item.entity.id });
                }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 text-center transition-opacity",
                  visibleIds.has(item.entity.id) ? "opacity-100" : "opacity-25",
                )}
                style={{ left: `${item.entity.x}%`, top: `${item.entity.y}%` }}
              >
                <span
                  className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full border-2 shadow-card ${
                    item.isShell
                      ? "border-risk-high bg-risk-high/15 text-risk-high"
                      : "border-border bg-card text-foreground"
                  }`}
                >
                  {item.entity.kind === "person" ? (
                    <User className="h-4 w-4" aria-hidden />
                  ) : (
                    <Building2 className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <p className="mt-1 w-24 truncate text-[10px] font-semibold">
                  {item.entity.name}
                </p>
                <p className="text-[9px] text-muted-foreground tnum">
                  {item.score}/100
                </p>
              </button>
            ))}
          </Card>
        ) : (
          <Card className="divide-y divide-border p-0">
            {visible.map((item) => (
              <button
                type="button"
                key={item.entity.id}
                onClick={() => {
                  setSelectedId(item.entity.id);
                  setTarget({ kind: "entity", id: item.entity.id });
                }}
                className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-accent"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  {item.entity.kind === "person" ? (
                    <User className="h-4 w-4" aria-hidden />
                  ) : (
                    <Building2 className="h-4 w-4" aria-hidden />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {item.entity.name}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {item.entity.role}
                  </p>
                </div>
                <span className="ml-auto">
                  <RiskChip level={item.level}>{item.score}/100</RiskChip>
                </span>
              </button>
            ))}
            {visible.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                Žiadny subjekt nezodpovedá filtru.
              </p>
            ) : null}
          </Card>
        )}

        <Button asChild variant="outline" className="w-full">
          <Link href="/forza/siet">Otvoriť interaktívnu sieťovú analýzu</Link>
        </Button>

        <SectionTitle>
          Detegované reťazce ({analysis.chains.length})
        </SectionTitle>

        <Card className="space-y-3">
          {analysis.chains.map((chain) => (
            <button
              type="button"
              key={chain.shellId}
              onClick={() => {
                setSelectedId(chain.shellId);
                setTarget({ kind: "entity", id: chain.shellId });
              }}
              className="block w-full space-y-1 rounded-lg text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">
                  {byId.get(chain.shellId)?.entity.name}
                </p>
                <span className="ml-auto">
                  <RiskChip level={chain.severity}>
                    {chain.severity === "critical" ? "Kritické" : "Vysoké"}
                  </RiskChip>
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {chain.supplierIds
                  .map((id) => byId.get(id)?.entity.name ?? id)
                  .join(", ")}{" "}
                → <span className="font-semibold text-risk-high">schránka</span>{" "}
                →{" "}
                {chain.buyerIds
                  .map((id) => byId.get(id)?.entity.name ?? id)
                  .join(", ")}
              </p>
            </button>
          ))}
        </Card>

        <SectionTitle>Detail subjektu</SectionTitle>

        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              {focus.entity.kind === "person" ? (
                <User className="h-4 w-4" aria-hidden />
              ) : (
                <Building2 className="h-4 w-4" aria-hidden />
              )}
            </span>
            <div>
              <p className="text-sm font-semibold">{focus.entity.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {focus.entity.role}
              </p>
            </div>
            <span className="ml-auto">
              <RiskChip level={focus.level}>{focus.score}/100</RiskChip>
            </span>
          </div>

          <dl className="space-y-1 text-xs">
            <Row label="Adresa" value={focus.entity.address ?? "—"} />
            <Row label="IČO" value={focus.entity.ico ?? "—"} />
            <Row label="Objem" value={formatEur(focus.totalVolume)} />
            <Row label="Zbrane" value={`${focus.weaponCount} ks`} />
          </dl>

          <Button
            className="w-full"
            onClick={() => setTarget({ kind: "entity", id: focus.entity.id })}
          >
            Spustiť detekciu schránkovej firmy
          </Button>
        </Card>
      </Screen>

      <DetectorSheet target={target} onClose={() => setTarget(null)} />
      <BottomNav />
    </PhoneFrame>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-semibold">{value}</dd>
    </div>
  );
}
