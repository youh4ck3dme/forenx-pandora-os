import React, { useState } from "react";
import {
  AlertTriangle,
  HelpCircle,
  Clock,
  Landmark,
  CheckCheck,
  Gavel,
  BrainCircuit,
  Scale,
  Link2,
  Users,
  Scan,
  Gauge,
  FileText,
  Copy,
  Check,
  Sparkles,
  ArrowRightLeft,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/malte/Shell";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { TruthTimestorySection } from "../TruthTimestorySection";
import { DevilsAdvocatePanel } from "@/components/features/forensic/DevilsAdvocatePanel";
import { AdmissibilityAuditView } from "@/components/features/forensic/AdmissibilityAuditView";
import { CustodyLedgerViewer } from "@/components/features/forensic/CustodyLedgerViewer";
import type { ForensicDossier } from "@/lib/types";
import { formatSourceRef } from "@/lib/types";
import { lightClasses, riskBadgeClasses } from "./types";
import { toast } from "sonner";

interface AutopilotTabsViewProps {
  dossier: ForensicDossier;
  showTimestory: boolean;
  autopilotTab: string;
  setAutopilotTab: (tab: string) => void;
  /** Hash-overené dôkazy z WORM ledgera; tvrdenia bez väzby na ne sa zobrazia ako neoverené. */
  knownEvidence: ReadonlySet<string>;
  onSimulateDevilsAdvocate: () => void;
}

export function AutopilotTabsView({
  dossier,
  showTimestory,
  autopilotTab,
  setAutopilotTab,
  knownEvidence,
  onSimulateDevilsAdvocate,
}: AutopilotTabsViewProps) {
  const [copiedAttackId, setCopiedAttackId] = useState<string | null>(null);

  function handleCopyCounterStrike(attackId: string, text: string) {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedAttackId(attackId);
        toast.success("Protiúder bol skopírovaný do schránky.");
        setTimeout(() => setCopiedAttackId(null), 2000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }

  return (
    <div className="space-y-3">
      {/* ═══ RÝCHLY PREPÍNAČ POHĽADOV PRE OBHAJCU (§ 125 TP & TOKY) ═══ */}
      <div
        id="tour-switcher"
        className="rounded-xl border border-border bg-card/80 p-2 shadow-xs space-y-1.5"
      >
        <div className="flex items-center justify-between px-1 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
          <span>Forenzný Switcher pre obhajobu</span>
          <span className="text-primary font-mono">4 kľúčové perspektívy</span>
        </div>
        <div
          className={`grid grid-cols-2 gap-1.5 ${showTimestory ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
        >
          {showTimestory ? (
            <button
              type="button"
              onClick={() => setAutopilotTab("timestory")}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
                autopilotTab === "timestory"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span className="truncate">⭐ 1. Pravda & Timestory</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setAutopilotTab("facts")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
              autopilotTab === "facts"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
            }`}
          >
            <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">⏱️ Časová os spisu</span>
          </button>
          <button
            type="button"
            onClick={() => setAutopilotTab("transakcie")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
              autopilotTab === "transakcie"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
            }`}
          >
            <Landmark className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span className="truncate">👥 Toky & Entity</span>
          </button>
          <button
            type="button"
            onClick={() => setAutopilotTab("rozpory")}
            className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
              autopilotTab === "rozpory"
                ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
            <span className="truncate">⚖️ Rozpory § 125</span>
          </button>
        </div>
      </div>

      <Tabs
        value={autopilotTab}
        onValueChange={setAutopilotTab}
        className="space-y-3"
      >
        <TabsList
          className={`grid w-full h-auto p-1 gap-1 ${showTimestory ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5"}`}
        >
          {showTimestory ? (
            <TabsTrigger
              value="timestory"
              className="text-[11px] py-1.5 gap-1 font-semibold text-amber-300 data-[state=active]:text-amber-200"
            >
              <Sparkles className="h-3 w-3 text-amber-400" />
              <span className="truncate">1. Pravda & Timestory</span>
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="otazky" className="text-[11px] py-1.5 gap-1">
            <HelpCircle className="h-3 w-3 text-primary" />
            <span className="truncate">3 Otázky</span>
          </TabsTrigger>
          <TabsTrigger value="rozpory" className="text-[11px] py-1.5 gap-1">
            <AlertTriangle className="h-3 w-3 text-rose-400" />
            <span className="truncate">Rozpory</span>
          </TabsTrigger>
          <TabsTrigger value="transakcie" className="text-[11px] py-1.5 gap-1">
            <Landmark className="h-3 w-3 text-emerald-400" />
            <span className="truncate">Transakcie</span>
          </TabsTrigger>
          <TabsTrigger value="facts" className="text-[11px] py-1.5 gap-1">
            <CheckCheck className="h-3 w-3 text-cyan-400" />
            <span className="truncate">Fakty</span>
          </TabsTrigger>
          <TabsTrigger value="defense" className="text-[11px] py-1.5 gap-1">
            <Gavel className="h-3 w-3 text-amber-400" />
            <span className="truncate">Obhajoba</span>
          </TabsTrigger>
          <TabsTrigger
            value="devils-advocate"
            className="text-[11px] py-1.5 gap-1"
          >
            <BrainCircuit className="h-3 w-3 text-rose-400" />
            <span className="truncate">👿 Devil&apos;s Advocate</span>
          </TabsTrigger>
          <TabsTrigger
            value="admissibility"
            className="text-[11px] py-1.5 gap-1"
          >
            <Scale className="h-3 w-3 text-cyan-400" />
            <span className="truncate">⚖️ Procesná prípustnosť</span>
          </TabsTrigger>
          <TabsTrigger
            value="custody-ledger"
            className="text-[11px] py-1.5 gap-1"
          >
            <Link2 className="h-3 w-3 text-emerald-400" />
            <span className="truncate">🔗 Dôkazný Ledger</span>
          </TabsTrigger>
        </TabsList>

        {showTimestory ? (
          <TabsContent value="timestory" className="space-y-3 m-0">
            <TruthTimestorySection />
          </TabsContent>
        ) : null}

        <TabsContent value="devils-advocate" className="space-y-3 m-0">
          <Card className="p-3.5">
            <DevilsAdvocatePanel
              hypotheses={dossier.alternativeHypotheses ?? []}
              knownEvidence={knownEvidence}
              onSimulate={onSimulateDevilsAdvocate}
            />
          </Card>
        </TabsContent>

        <TabsContent value="admissibility" className="space-y-3 m-0">
          <Card className="p-3.5">
            <AdmissibilityAuditView
              audit={dossier.admissibilityAudit}
              knownEvidence={knownEvidence}
            />
          </Card>
        </TabsContent>

        <TabsContent value="custody-ledger" className="space-y-3 m-0">
          <Card className="p-3.5">
            <CustodyLedgerViewer entries={dossier.custodyLedger ?? []} />
          </Card>
        </TabsContent>

        {/* KARTA 1: 3 OTÁZKY (SOURCE OF TRUTH ÚBOK) */}
        <TabsContent value="otazky" className="space-y-3 m-0">
          <Card className="space-y-3 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5 text-primary" /> Source of
                Truth ÚBOK — 3 Hlavné vyšetrovacie otázky
              </div>
              <Badge
                variant="outline"
                className="border-primary/40 text-primary text-[10px]"
              >
                PPZ-51/UBOK
              </Badge>
            </div>

            <div className="space-y-3">
              {[
                dossier.investigativeAnswers?.q1_buyer_seller,
                dossier.investigativeAnswers?.q2_planner_coordinator,
                dossier.investigativeAnswers?.q3_financier,
              ]
                .filter(Boolean)
                .map((q) => {
                  if (!q) return null;
                  return (
                    <div
                      key={q.questionNumber}
                      className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 text-xs shadow-xs"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-border/50 pb-2">
                        <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
                            {q.questionNumber}
                          </span>
                          {q.question}
                        </h4>
                        <Badge
                          variant="outline"
                          className={
                            q.confidenceLevel >= 90
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px]"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px]"
                          }
                        >
                          Preukázanosť: {q.confidenceLevel} %
                        </Badge>
                      </div>

                      {/* Odpoveď */}
                      <div className="rounded-lg bg-muted/40 border border-border/60 p-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                          Zistený skutkový záver:
                        </p>
                        <p className="text-foreground/95 leading-relaxed">
                          {q.answer}
                        </p>
                      </div>

                      {/* Stotožnené osoby */}
                      {q.identifiedPersons.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Stotožnené osoby a role:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {q.identifiedPersons.map((p, pIdx) => (
                              <Badge
                                key={pIdx}
                                variant="secondary"
                                className="text-[10px] font-medium bg-muted/60 border border-border/80"
                              >
                                <Users className="h-3 w-3 mr-1 text-primary/80" />
                                {p}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Priame dôkazy */}
                      {q.directEvidence.length > 0 && (
                        <div className="space-y-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                            <CheckCheck className="h-3 w-3" /> Priame
                            usvedčujúce dôkazy v spise:
                          </span>
                          <ul className="space-y-1 mt-1">
                            {q.directEvidence.map((ev, eIdx) => (
                              <li
                                key={eIdx}
                                className="text-[11px] text-foreground/90 flex items-start gap-1.5"
                              >
                                <span className="text-emerald-400 shrink-0 font-bold">
                                  •
                                </span>
                                <span>{ev}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Chýbajúce dôkazy / neoverené hypotézy */}
                      {(q.missingEvidence.length > 0 ||
                        q.unverifiedHypotheses.length > 0) && (
                        <div className="space-y-1 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Úkony na
                            doplnenie dokazovania (§ 119 TP):
                          </span>
                          <ul className="space-y-1 mt-1">
                            {q.missingEvidence.map((me, mIdx) => (
                              <li
                                key={mIdx}
                                className="text-[11px] text-foreground/80 flex items-start gap-1.5"
                              >
                                <span className="text-amber-400 shrink-0 font-bold">
                                  ⚠️
                                </span>
                                <span>{me}</span>
                              </li>
                            ))}
                            {q.unverifiedHypotheses.map((uh, uIdx) => (
                              <li
                                key={`uh-${uIdx}`}
                                className="text-[11px] text-muted-foreground flex items-start gap-1.5"
                              >
                                <span className="text-muted-foreground shrink-0 font-bold">
                                  ?
                                </span>
                                <span>Hypotéza: {uh}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </Card>
        </TabsContent>

        {/* KARTA 2: ROZPORY VO VÝPOVEDIACH & MATICA NEPRAVDIVOSTI */}
        <TabsContent value="rozpory" className="space-y-3 m-0">
          <Card id="tour-contradictions" className="space-y-3 p-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" /> Rozpory
                vo výpovediach & Matica nepravdivosti
              </div>
              {dossier.testimonyContradictions && (
                <Badge
                  variant="outline"
                  className="border-rose-500/30 text-rose-400 bg-rose-500/10 text-[10px]"
                >
                  {dossier.testimonyContradictions.length} detegované rozpory
                </Badge>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground">
              Porovnanie tvrdení obvinených a svedkov so zisteným stavom spisu a
              návrhy procesného postupu (§ 125 TP konfrontácia, § 142 TP
              znalecké dokazovanie).
            </p>

            <div className="space-y-3">
              {dossier.testimonyContradictions?.map((c) => {
                const deceitColor =
                  c.deceitPercentage >= 85
                    ? "text-rose-400 border-rose-500/30 bg-rose-500/10"
                    : c.deceitPercentage >= 70
                      ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
                      : "text-amber-400 border-amber-500/30 bg-amber-500/10";

                const barColor =
                  c.deceitPercentage >= 85
                    ? "[&>div]:bg-rose-500"
                    : c.deceitPercentage >= 70
                      ? "[&>div]:bg-orange-500"
                      : "[&>div]:bg-amber-500";

                return (
                  <div
                    key={c.id}
                    className="rounded-xl border border-border bg-card p-3 space-y-2.5 text-xs shadow-xs"
                  >
                    {/* Header: Topic & Severity */}
                    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] font-bold text-muted-foreground shrink-0">
                          {c.id}
                        </span>
                        <h5 className="font-semibold text-foreground truncate">
                          {c.topic}
                        </h5>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          c.contradictionSeverity === "critical"
                            ? "border-rose-500/40 text-rose-400 text-[9px] py-0"
                            : c.contradictionSeverity === "high"
                              ? "border-orange-500/40 text-orange-400 text-[9px] py-0"
                              : "border-amber-500/40 text-amber-400 text-[9px] py-0"
                        }
                      >
                        {c.contradictionSeverity === "critical"
                          ? "KRITICKÝ ROZPOR"
                          : c.contradictionSeverity === "high"
                            ? "VYSOKÝ ROZPOR"
                            : "STREDNÝ ROZPOR"}
                      </Badge>
                    </div>

                    {/* Deceit meter */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground font-medium">
                          Odhadovaná miera nepravdivosti tvrdenia:
                        </span>
                        <span
                          className={`font-bold font-mono px-2 py-0.5 rounded border text-[11px] ${deceitColor}`}
                        >
                          {c.deceitPercentage} % (Vyvrátené)
                        </span>
                      </div>
                      <Progress
                        value={c.deceitPercentage}
                        className={`h-1.5 ${barColor}`}
                      />
                    </div>

                    {/* 2 Stĺpce: Tvrdenie vs. Konfrontácia */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                          ⚠️ {c.personA.name} ({c.personA.status}):
                        </p>
                        <p className="italic text-foreground/90 text-[11px]">
                          &ldquo;{c.personA.claim}&rdquo;
                        </p>
                      </div>

                      <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-2.5 space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                          🔍 Konfrontácia (
                          {c.personB?.name ?? "Materiálny dôkaz"}):
                        </p>
                        <p className="text-foreground/90 text-[11px]">
                          {c.personB
                            ? `\u201c${c.personB.claim}\u201d`
                            : c.factualRecord}
                        </p>
                      </div>
                    </div>

                    {/* Skutočnosť podľa spisu */}
                    <div className="rounded-lg bg-muted/40 border border-border/70 p-2 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Zistený skutkový stav podľa spisu:
                      </p>
                      <p className="text-foreground/90 text-[11px]">
                        {c.factualRecord}
                      </p>
                    </div>

                    {/* Procesné riešenie */}
                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-2 space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                        <Scale className="h-3 w-3" /> Procesný postup (§ 125 TP
                        / § 142 TP):
                      </p>
                      <p className="text-foreground/90 text-[11px]">
                        {c.proceduralResolution}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* KARTA 3: ANALÝZA TRANSAKCIÍ & FINANCOVANIA */}
        <TabsContent value="transakcie" className="space-y-3 m-0">
          <Card className="space-y-3 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Landmark className="h-3.5 w-3.5 text-emerald-400" /> Analýza
                transakcií & Toky financií
              </div>
              <Badge
                variant="outline"
                className="border-emerald-500/40 text-emerald-400 text-[10px]"
              >
                § 233a TZ (Legalizácia)
              </Badge>
            </div>

            {dossier.financialAnalysis && (
              <>
                {/* KPI Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground">
                      Celkový objem
                    </span>
                    <p className="text-base font-bold text-foreground font-mono mt-0.5">
                      {dossier.financialAnalysis.totalVolume.toLocaleString(
                        "sk-SK",
                      )}{" "}
                      €
                    </p>
                  </div>

                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-center">
                    <span className="text-[10px] uppercase font-mono text-rose-400 font-semibold">
                      Hotovosť
                    </span>
                    <p className="text-base font-bold text-rose-400 font-mono mt-0.5">
                      {dossier.financialAnalysis.cashVolume.toLocaleString(
                        "sk-SK",
                      )}{" "}
                      €
                    </p>
                  </div>

                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-2.5 text-center">
                    <span className="text-[10px] uppercase font-mono text-blue-400 font-semibold">
                      Bankové prevody
                    </span>
                    <p className="text-base font-bold text-blue-400 font-mono mt-0.5">
                      {dossier.financialAnalysis.transferVolume.toLocaleString(
                        "sk-SK",
                      )}{" "}
                      €
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                    <span className="text-[10px] uppercase font-mono text-muted-foreground">
                      Podiel hotovosti
                    </span>
                    <p className="text-base font-bold text-amber-400 font-mono mt-0.5">
                      {dossier.financialAnalysis.cashRatioPercent} %
                    </p>
                  </div>
                </div>

                {/* Hotovostný pomer progress bar */}
                <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-rose-400">
                      Hotovosť: {dossier.financialAnalysis.cashRatioPercent} %
                      (Smurfing & anonymné vklady)
                    </span>
                    <span className="font-semibold text-blue-400">
                      Prevody:{" "}
                      {(
                        100 - dossier.financialAnalysis.cashRatioPercent
                      ).toFixed(1)}{" "}
                      %
                    </span>
                  </div>
                  <Progress
                    value={dossier.financialAnalysis.cashRatioPercent}
                    className="h-2 [&>div]:bg-rose-500"
                  />
                </div>

                {/* Podozrivé toky zoznam */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Podozrivé finančné toky (Red Flags)
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {dossier.financialAnalysis.suspiciousFlows.length} záchytov
                    </span>
                  </div>

                  <div className="space-y-2">
                    {dossier.financialAnalysis.suspiciousFlows.map((flow) => (
                      <div
                        key={flow.id}
                        className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[10px] text-muted-foreground">
                              {flow.id}
                            </span>
                            <Badge
                              variant="outline"
                              className={
                                flow.method === "cash_deposit"
                                  ? "border-rose-500/40 text-rose-400 bg-rose-500/10 text-[9px] py-0"
                                  : "border-blue-500/40 text-blue-400 bg-blue-500/10 text-[9px] py-0"
                              }
                            >
                              {flow.method === "cash_deposit"
                                ? "HOTOVOSŤ"
                                : "PREVOD"}
                            </Badge>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {flow.date}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-sm text-foreground">
                            {flow.amount.toLocaleString("sk-SK")} €
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-foreground/90">
                          <span className="font-medium text-muted-foreground truncate max-w-35">
                            {flow.payer}
                          </span>
                          <ArrowRightLeft className="h-3 w-3 text-primary shrink-0" />
                          <span className="font-medium text-foreground truncate max-w-35">
                            {flow.recipient}
                          </span>
                        </div>

                        <p className="text-[11px] text-muted-foreground">
                          {flow.purpose}
                        </p>

                        {/* Red flag */}
                        <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 p-2 flex items-start gap-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                          <span className="text-[11px] text-rose-300 leading-tight">
                            {flow.redFlag}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Záver financovania */}
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                    <Scale className="h-3.5 w-3.5" /> Záver forenzného
                    vyšetrovania tokov financií
                  </div>
                  <p className="text-xs text-foreground/90 leading-relaxed">
                    {dossier.financialAnalysis.financingConclusion}
                  </p>
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        {/* KARTA 4: FAKTY */}
        <TabsContent value="facts" className="space-y-3 m-0">
          <Card id="tour-timeline" className="space-y-3 p-3.5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Časová os a reťazec zaistenia
            </div>
            <div className="space-y-2">
              {(dossier.facts?.timeline ?? []).map((item, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-2.5 text-xs ${
                    item.chainBreak
                      ? "border-rose-500/40 bg-rose-500/10"
                      : "border-border/60 bg-muted/20"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {item.time}
                    </span>
                    {item.chainBreak && (
                      <Badge
                        variant="outline"
                        className="border-rose-500/40 text-rose-400 text-[9px] py-0"
                      >
                        ZLOM REŤAZCA{" "}
                        {item.paragraph ? `· ${item.paragraph}` : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-medium text-foreground/90">
                    {item.event}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Zdroj: {formatSourceRef(item.sourceRef) || item.source}
                  </p>
                </div>
              ))}
            </div>

            <Separator className="my-2" />

            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Scan className="h-3.5 w-3.5" /> Stopy a semafor integrity
            </div>
            <div className="grid gap-2">
              {(dossier.facts?.traces ?? []).map((t) => {
                const c = lightClasses(t.light);
                return (
                  <div
                    key={t.id}
                    className={`rounded-lg border p-2.5 text-xs ${c.border} ${c.bg}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-muted-foreground">
                        {t.id}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${c.text} ${c.border}`}
                      >
                        {t.type}
                      </Badge>
                    </div>
                    <p className="mt-1 text-foreground/90">{t.description}</p>
                    {!t.chainComplete && (
                      <p className="mt-1 text-[11px] text-rose-400 font-medium">
                        ⚠️ Reťazec nie je úplný
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        {/* KARTA 5: OBHAJOBA & SÚDNA SILA */}
        <TabsContent value="defense" className="space-y-3 m-0">
          <Card id="tour-legal-audit" className="space-y-3 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Gavel className="h-3.5 w-3.5 text-rose-400" /> Simulátor útoku
                advokáta
              </div>
              <Badge
                variant="outline"
                className={riskBadgeClasses(
                  dossier.defenseAttack?.overallRisk ?? "STREDNÉ",
                )}
              >
                Riziko: {dossier.defenseAttack?.overallRisk ?? "—"}
              </Badge>
            </div>

            <div className="space-y-3">
              {(dossier.defenseAttack?.attacks ?? []).map((atk) => (
                <div
                  key={atk.id}
                  className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs"
                >
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5">
                    <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                      ⚖️ Obhajoba na súde povie:
                    </p>
                    <p className="mt-0.5 italic text-foreground/90">
                      {atk.defenseClaim}
                    </p>
                  </div>

                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                        🛡️ Váš protiúder (ako to vyvrátiť):
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyCounterStrike(atk.id, atk.counterStrike)
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                        title="Kopírovať protiúder"
                      >
                        {copiedAttackId === atk.id ? (
                          <>
                            <Check className="h-3 w-3" />
                            <span>Skopírované</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Kopírovať</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-foreground/90">{atk.counterStrike}</p>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                    <span>Medzera v spise: {atk.evidenceGap}</span>
                    <Badge
                      variant="outline"
                      className={riskBadgeClasses(atk.risk)}
                    >
                      {atk.risk}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            <Separator className="my-2" />

            {/* Súdna sila a Likelihood Ratio */}
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Likelihood Ratio &
              Sila dôkazov
            </div>
            <div className="space-y-2">
              {(dossier.evidenceStrength?.traces ?? []).map((t) => {
                const c = lightClasses(t.light);
                return (
                  <div
                    key={t.id}
                    className={`flex items-center justify-between rounded-lg border p-2.5 text-xs ${c.border} ${c.bg}`}
                  >
                    <div>
                      <p className="font-semibold text-foreground/90">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {t.paragraph}
                      </p>
                    </div>
                    <div className="text-right">
                      {t.lr !== "—" && (
                        <p className="font-mono text-xs font-bold">{t.lr}</p>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${c.text} ${c.border}`}
                      >
                        {t.strength}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>

            <Separator className="my-2" />

            {/* Procesné paragrafy */}
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <FileText className="h-3.5 w-3.5 text-primary" /> Procesné
              paragrafy (Trestný poriadok)
            </div>
            <div className="space-y-1.5">
              {(dossier.evidenceStrength?.paragraphs ?? []).map((p) => (
                <div
                  key={p.para}
                  className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 p-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-foreground/90">
                      {p.para}
                    </span>
                    <span className="ml-2 text-muted-foreground">
                      {p.title}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      p.status === "OK"
                        ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                        : p.status === "Narušené"
                          ? "border-rose-500/30 text-rose-400 bg-rose-500/10"
                          : "border-amber-500/30 text-amber-400 bg-amber-500/10"
                    }
                  >
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
