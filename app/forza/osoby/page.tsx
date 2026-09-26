"use client";

import { useActiveCase } from "@/hooks/useActiveCase";
import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  Download,
  Loader2,
  Network,
  Search,
  ShieldCheck,
  User,
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
import { RiskFilter } from "@/components/malte/RiskFilter";
import { openCommandPalette } from "@/components/malte/CommandPalette";
import { EmptyState } from "@/components/malte/EmptyState";
import {
  DetectorSheet,
  type DetectorTarget,
} from "@/components/malte/DetectorSheet";
import { useCaseStore, passesFilter } from "@/hooks/useCaseStore";
import { cn } from "@/lib/utils";
import { formatEur, type Severity } from "@/lib/forza/forensic";
import { BRAND } from "@/config/brand";
import { fetchWhoIsWhoCompanyRegistry, fetchWhoIsWhoDdReportPdf } from "@/lib/forza/whoiswho.functions";
import { toast } from "sonner";
import { upsertEntity } from "@/lib/forza/case-data";

type KindFilter = "all" | "person" | "company" | "shell";

export default function OsobyPage() {
  return <People />;
}

function People() {
  const { activeCase, analysis, refresh } = useActiveCase();
  const { state } = useCaseStore();
  const [target, setTarget] = useState<DetectorTarget | null>(null);
  const [kind, setKind] = useState<KindFilter>("all");
  const [icoInput, setIcoInput] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<"SK" | "CZ">("SK");
  const [isSearchingIco, setIsSearchingIco] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState<{
    snapshotId: string;
    profile: import("@/lib/forza/forensic").CompanyRegistryProfile;
    risk?: { score: number; flags: any[]; sources?: string[] } | null;
    graph?: { counts: { nodes: number; edges: number } } | null;
  } | null>(null);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);

  const handleDownloadDdReport = async (ico: string) => {
    try {
      setIsDownloadingReport(true);
      const res = await fetchWhoIsWhoDdReportPdf(ico, selectedCountry);
      if (!res.ok) {
        throw new Error(res.error || "Nepodarilo sa vygenerovať PDF report");
      }
      const byteCharacters = atob(res.pdfBase64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename || `WhoIsWho_DD_Report_${ico}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success("DD Report bol úspešne stiahnutý.");
    } catch (err: any) {
      toast.error(err?.message || "Zlyhalo sťahovanie PDF reportu");
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const handleFetchRegistryByIco = async () => {
    const cleanIco = icoInput.trim();
    if (!cleanIco) {
      toast.error("Zadajte platné IČO.");
      return;
    }
    if (!activeCase?.id) {
      toast.error("Najprv vyberte alebo vytvorte prípad.");
      return;
    }
    setIsSearchingIco(true);
    try {
      const res = await fetchWhoIsWhoCompanyRegistry(cleanIco, selectedCountry);
      if (!res.ok || !res.snapshot) {
        toast.error(res.error || "Firmy sa nepodarilo vyľadať v registroch.");
        return;
      }
      setPreviewSnapshot({
        snapshotId: res.snapshotId,
        profile: res.snapshot.profile,
        risk: res.snapshot.risk,
        graph: res.snapshot.graph,
      });
      toast.success(
        `Nájdená firma "${res.snapshot.profile.name}" (IČO: ${cleanIco}). Náhľad pripravený.`,
      );
    } catch (err) {
      toast.error("Vyhľadávanie v registroch zlyhalo.");
    } finally {
      setIsSearchingIco(false);
    }
  };

  const confirmImport = async (mode: "new" | "update") => {
    if (!previewSnapshot || !activeCase?.id) return;
    setIsImporting(true);
    try {
      const prof = previewSnapshot.profile;
      const existing = activeCase.entities.find(
        (e) => e.ico?.trim() === prof.ico?.trim(),
      );
      const entityId =
        mode === "update" && existing ? existing.id : `ent_${Date.now()}`;
      await upsertEntity(activeCase.id, {
        id: entityId,
        name: prof.name,
        kind: "company",
        role: "Importované z RPO / RÚZ",
        ico: prof.ico,
        dic: prof.dic,
        icDph: prof.icDph,
        legalForm: prof.legalForm,
        address: prof.formattedAddress,
        establishedDate: prof.establishedDate,
        terminationDate: prof.terminationDate,
        equityEur: prof.equityEur,
        statutoryPersons: prof.statutoryPersons.map((sp) => ({
          name: sp.name,
          role: sp.role,
        })),
        businessActivities: prof.businessActivities,
      });

      refresh();
      setPreviewSnapshot(null);
      setIcoInput("");
      toast.success(
        mode === "new"
          ? `Firma "${prof.name}" bola pridaná do prípadu.`
          : `Firma "${prof.name}" bola aktualizovaná.`,
      );
    } catch (err) {
      toast.error("Uloženie profilu firmy zlyhalo.");
    } finally {
      setIsImporting(false);
    }
  };

  const list = analysis.entities.filter((item) => {
    if (kind === "person") return item.entity.kind === "person";
    if (kind === "company") return item.entity.kind === "company";
    if (kind === "shell") return item.isShell;
    return true;
  });

  const counts = list.reduce<Partial<Record<Severity, number>>>((acc, a) => {
    acc[a.level] = (acc[a.level] ?? 0) + 1;
    return acc;
  }, {});

  const visible = list.filter((a) => passesFilter(state.riskFilter, a.level));

  return (
    <PhoneFrame>
      <AppHeader
        title="Subjekty a firmy"
        actions={
          <button
            type="button"
            onClick={openCommandPalette}
            aria-label="Hľadať subjekty"
            title="Hľadať subjekty v prípade"
            className="rounded-full p-1 transition-colors hover:bg-foreground/15 cursor-pointer"
          >
            <Search className="h-5 w-5 opacity-90" aria-hidden />
          </button>
        }
      />
      <Screen>
        <Card className="space-y-3 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 text-amber-500">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span className="text-xs font-bold uppercase tracking-wider">
              WhoIsWho SK • Automatické preverenie RPO / RÚZ / RPVS
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Zadajte IČO slovenskej alebo českej firmy pre stiahnutie
            štruktúrovaného profilu, preverenie schránkových indikátorov a
            zostavenie majetkového grafu.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value as "SK" | "CZ")}
              className="h-10 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="SK">🇸🇰 SK (RPO / RÚZ)</option>
              <option value="CZ">🇨🇿 CZ (ARES / VR)</option>
            </select>
            <input
              type="text"
              value={icoInput}
              onChange={(e) => setIcoInput(e.target.value)}
              placeholder="Zadajte IČO firmy (napr. 35815256)..."
              className="h-10 flex-1 rounded-lg border border-border bg-card px-3 text-xs font-mono text-foreground outline-none focus:ring-2 focus:ring-ring"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleFetchRegistryByIco();
                }
              }}
            />
            <button
              type="button"
              disabled={isSearchingIco || !icoInput.trim()}
              onClick={() => void handleFetchRegistryByIco()}
              className="h-10 px-4 rounded-lg gradient-brand text-xs font-bold text-foreground flex items-center justify-center gap-1.5 shadow-sm hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {isSearchingIco ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Overujem w/ RPO...</span>
                </>
              ) : (
                <>
                  <Search className="h-3.5 w-3.5" />
                  <span>Stiahnuť profil</span>
                </>
              )}
            </button>
          </div>
        </Card>

        {previewSnapshot && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-border pb-3">
                <div>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest">
                    WhoIsWho Snapshot Náhľad
                  </span>
                  <h2 className="text-base font-bold text-foreground mt-0.5">
                    {previewSnapshot.profile.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    IČO: {previewSnapshot.profile.ico} • DIČ:{" "}
                    {previewSnapshot.profile.dic || "N/A"}
                  </p>
                </div>
                <RiskChip
                  level={
                    (previewSnapshot.risk?.score ?? 0) > 70
                      ? "critical"
                      : (previewSnapshot.risk?.score ?? 0) > 40
                        ? "high"
                        : "low"
                  }
                >
                  Riziko: {previewSnapshot.risk?.score ?? 0}/100
                </RiskChip>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">Sídlo & Vznik:</p>
                  <p className="text-muted-foreground">
                    {previewSnapshot.profile.formattedAddress || "Neuvedené"}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    Vznik: {previewSnapshot.profile.establishedDate || "Neuvedený"}{" "}
                    | Právna forma: {previewSnapshot.profile.legalForm || "s.r.o."}
                  </p>
                </div>

                <div className="p-3 rounded-lg border border-border/80 bg-accent/30 space-y-2">
                  <p className="font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-amber-400" />
                    Detegované rizikové príznaky (
                    {previewSnapshot.risk?.flags.length ?? 0}):
                  </p>
                  {previewSnapshot.risk?.flags &&
                  previewSnapshot.risk.flags.length > 0 ? (
                    <div className="space-y-1">
                      {previewSnapshot.risk.flags.map((fl: any, idx: number) => (
                        <div
                          key={fl.code || idx}
                          className="flex items-start gap-1.5 text-[11px] text-risk-high"
                        >
                          <span className="font-bold">• {fl.label}:</span>
                          <span className="text-muted-foreground">
                            {fl.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      Žiadne rizikové príznaky neboli v registroch zistené.
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-border">
                  <p className="font-semibold mb-1">
                    Štatutárne orgány (
                    {previewSnapshot.profile.statutoryPersons.length}):
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 text-muted-foreground">
                    {previewSnapshot.profile.statutoryPersons.map((sp, idx) => (
                      <li key={sp.sourcePersonId || `${sp.name}-${idx}`}>
                        <strong className="text-foreground">{sp.name}</strong> (
                        {sp.role || "konateľ"})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="pt-3 border-t border-border flex flex-col gap-2">
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => confirmImport("new")}
                  className="h-9 w-full rounded-md gradient-brand font-medium text-foreground text-xs disabled:opacity-50"
                >
                  {isImporting ? "Ukladám..." : "Vytvoriť novú firmu v prípade"}
                </button>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => confirmImport("update")}
                  className="h-9 w-full rounded-md border border-border bg-secondary font-medium text-secondary-foreground text-xs hover:bg-secondary/80 disabled:opacity-50"
                >
                  {isImporting ? "Ukladám..." : "Aktualizovať existujúcu firmu"}
                </button>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={() => setPreviewSnapshot(null)}
                  className="h-9 w-full rounded-md text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Zrušiť import
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto py-1 text-xs">
          {(
            [
              { id: "all", label: `Všetky (${analysis.entities.length})` },
              { id: "person", label: `Fyzické osoby (${analysis.totals.persons})` },
              { id: "company", label: `Právnické osoby (${analysis.totals.companies})` },
              { id: "shell", label: `Schránky` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setKind(item.id)}
              className={cn(
                "rounded-full px-3 py-1 font-medium transition-colors cursor-pointer whitespace-nowrap",
                kind === item.id
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <RiskFilter counts={counts} />

        <SectionTitle>
          {visible.length} subjektov • zoradené podľa rizika
        </SectionTitle>

        <div className="space-y-3">
          {visible.map((item) => (
            <Card
              key={item.entity.id}
              className="cursor-pointer space-y-3 transition-colors hover:bg-accent/40"
              onClick={() => setTarget({ kind: "entity", id: item.entity.id })}
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
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
                    {item.entity.ico ? ` • IČO ${item.entity.ico}` : ""}
                  </p>
                </div>
                <span className="ml-auto">
                  <RiskChip level={item.level}>{item.score}/100</RiskChip>
                </span>
              </div>

              {item.isShell ? (
                <p className="rounded-lg bg-risk-high/10 px-2 py-1 text-[11px] font-semibold text-risk-high">
                  Indikátory schránkovej firmy
                </p>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {item.flags.map((flag) => (
                  <span
                    key={flag.code}
                    className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground"
                    title={flag.detail}
                  >
                    {flag.label}
                  </span>
                ))}
                {item.flags.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    Bez detegovaných príznakov
                  </span>
                ) : null}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground tnum">
                <span>Objem {formatEur(item.totalVolume)}</span>
                {state.reviewed.includes(`entity:${item.entity.id}`) ? (
                  <span className="inline-flex items-center gap-1 text-risk-low">
                    <CheckCircle2 className="h-3 w-3" aria-hidden />
                    Preverené
                  </span>
                ) : null}
                <span>{item.weaponCount} zbraní</span>
              </div>
            </Card>
          ))}
          {visible.length === 0 ? (
            <Card>
              <EmptyState
                title="Žiadny subjekt nezodpovedá filtru"
                detail="Skúste zmeniť typ subjektu alebo uvoľniť rizikový filter."
              />
            </Card>
          ) : null}
        </div>
      </Screen>
      <DetectorSheet target={target} onClose={() => setTarget(null)} />
      <BottomNav />
    </PhoneFrame>
  );
}
