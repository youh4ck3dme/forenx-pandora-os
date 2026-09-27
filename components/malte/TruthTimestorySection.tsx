import { useState, useMemo } from "react";
import {
  Printer,
  Palette,
  Copy,
  Check,
  CheckCircle2,
  FileSearch,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/malte/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useActiveCase } from "@/hooks/useActiveCase";

import {
  buildDynamicEpisodes,
  buildDynamicAnomalies,
  TIMESTORY_EPISODES,
  ANOMALIES_DATA,
  MASTER_COMIC_STYLE_ANCHOR,
  type TimestoryEpisode,
  type AnomalyItem,
} from "./timeline/types";
import { useTimelinePlayback } from "./timeline/useTimelinePlayback";
import { TimelineEventItem } from "./timeline/TimelineEventItem";
import { AnomalyCard } from "./timeline/AnomalyCard";
import { MasterPromptsDrawer } from "./timeline/MasterPromptsDrawer";
import { TimelinePrintModal } from "./timeline/TimelinePrintModal";
import { TimelineRouteMap } from "./timeline/TimelineRouteMap";

export { buildDynamicEpisodes, buildDynamicAnomalies };

export function TruthTimestorySection() {
  const { activeCase, dossier } = useActiveCase();
  const isDemo = dossier?.analysisMeta?.isDemo === true;

  const episodes = useMemo(
    () =>
      isDemo || !dossier
        ? TIMESTORY_EPISODES
        : buildDynamicEpisodes(activeCase, dossier),
    [activeCase, dossier, isDemo],
  );

  const anomalies = useMemo(
    () => (isDemo || !dossier ? ANOMALIES_DATA : buildDynamicAnomalies(dossier)),
    [dossier, isDemo],
  );

  const caseTitle = dossier?.caseTitle || activeCase.name;

  // Prehrávač a navigácia epizód
  const {
    activeEpisodeId,
    setActiveEpisodeId,
    isPlaying,
    playProgress,
    switching,
    currentEpisode,
    togglePlaySlideshow,
    handlePrevEpisode,
    handleNextEpisode,
  } = useTimelinePlayback({ episodes });

  // Lokálne stavy sekcie
  const [expandedAnomalyId, setExpandedAnomalyId] = useState<number | null>(1);
  const [filterStrength, setFilterStrength] = useState<string>("all");
  const [copiedPromptId, setCopiedPromptId] = useState<number | null>(null);
  const [copiedMotionId, setCopiedMotionId] = useState<number | null>(null);
  const [expandedMotionId, setExpandedMotionId] = useState<number | null>(null);
  const [copiedAllPrompts, setCopiedAllPrompts] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [brokenImages, setBrokenImages] = useState<Record<number, boolean>>({});

  function handleImageError(id: number) {
    setBrokenImages((prev) => ({ ...prev, [id]: true }));
  }

  function handleCopyMotion(anomaly: AnomalyItem) {
    void navigator.clipboard.writeText(anomaly.motionText).then(
      () => {
        setCopiedMotionId(anomaly.id);
        toast.success(
          `Oficiálny procesný návrh pre Anomáliu ${anomaly.id} skopírovaný do schránky!`,
        );
        setTimeout(() => setCopiedMotionId(null), 2500);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }

  function handleCopyPrompt(episode: TimestoryEpisode) {
    const text = `/* COMIC PANEL PROMPT — EPISODE ${episode.id} (${episode.chapterLetter}) */
PROMPT:
${episode.comicPrompt}

NEGATIVE PROMPT:
${episode.negativePrompt}

CAMERA & COMPOSITION:
${episode.cameraAngle}

DIALOGUE / TEXT OVERLAY:
NARRATOR: "${episode.narratorBox}"
SFX: ${episode.soundEffect}
${episode.dialogues.map((d) => `${d.speaker.toUpperCase()}: "${d.text}"`).join("\n")}`;

    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedPromptId(episode.id);
        toast.success(
          `AI Comic Prompt pre Epizódu ${episode.id} (${episode.chapterLetter}) skopírovaný!`,
        );
        setTimeout(() => setCopiedPromptId(null), 2500);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo. Skúste to znova.");
      },
    );
  }

  function handleCopyAllPrompts() {
    const allText = `/* ==========================================================
   KOMPLETNÝ KOMIKSOVÝ STORYBOARD & PROMPTY OD A PO Z
   KAUZA: PPZ-51/UBOK-PZ-ST-2025 // SKUTOČNÁ PRAVDA
   ========================================================== */

MASTER STYLE ANCHOR:
${MASTER_COMIC_STYLE_ANCHOR}

--------------------------------------------------------------
${episodes
  .map(
    (ep) => `EPIZÓDA ${ep.id} // KAPITOLA ${ep.chapterLetter}: ${ep.title}
DÁTUM & MIESTO: ${ep.date} | ${ep.location}
SFX ONOMATOPOEIA: ${ep.soundEffect}
NARRÁTOR: "${ep.narratorBox}"

AI PROMPT:
${ep.comicPrompt}

NEGATIVE PROMPT:
${ep.negativePrompt}

KOMIKSOVÉ DIALÓGY:
${ep.dialogues.map((d) => `  • ${d.speaker} (${d.role}): "${d.text}"`).join("\n")}
--------------------------------------------------------------`,
  )
  .join("\n\n")}`;

    void navigator.clipboard.writeText(allText).then(
      () => {
        setCopiedAllPrompts(true);
        toast.success(
          "Kompletný komiksový scenár & prompty (A–Z) skopírované do schránky!",
        );
        setTimeout(() => setCopiedAllPrompts(false), 3000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo. Skúste to znova.");
      },
    );
  }

  const filteredAnomalies =
    filterStrength === "all"
      ? anomalies
      : anomalies.filter((a) => a.strength === filterStrength);

  return (
    <div className="space-y-4">
      {/* ═══ HLAVNÝ NOIR COMIC BANNER ═══ */}
      <div className="relative overflow-hidden rounded-2xl border-2 border-primary/50 bg-linear-to-br from-black via-card/95 to-primary/15 p-4 sm:p-5 shadow-2xl">
        {/* Pozadie v štýle komiksového rastra (halftone dots) */}
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            backgroundImage:
              "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "8px 8px",
          }}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/80 pb-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-amber-500 text-black border-none font-black text-[10px] tracking-wider uppercase px-2.5 py-0.5 shadow-md">
                ⭐ 1. Z MOŽNOSTÍ: NAJBLIŽŠIE K PRAVDE
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px] border-primary/60 text-primary font-mono font-bold"
              >
                A–Z TIMESTORY STORYBOARD
              </Badge>
              <Badge className="bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[9px] font-black uppercase">
                FRANK MILLER NOIR STÝL
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-black uppercase animate-pulse">
                {isDemo
                  ? "SYNTETICKÁ UKÁŽKA — FIKTÍVNE ÚDAJE"
                  : "PRACOVNÁ REKONŠTRUKCIA Z AKTÍVNEHO SPISU"}
              </Badge>
            </div>
            <h3 className="text-lg sm:text-2xl font-black text-foreground tracking-tight flex items-center gap-2">
              <span>{caseTitle}: Priebeh od A po Z</span>
            </h3>
            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">
              {isDemo
                ? "Syntetická ukážka — vymyslené osoby, firmy a sumy."
                : "Pracovný storyboard zostavený iba z udalostí, zistení a zdrojov aktívneho spisu. Pred použitím v konaní overte každý údaj proti originálu."}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPrintModal(true)}
              className="text-xs h-9 gap-1.5 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 font-bold cursor-pointer"
            >
              <Printer className="h-4 w-4 text-emerald-400" />
              <span>🖨️ Tlačiť pre senát</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPromptModal(!showPromptModal)}
              className="text-xs h-9 gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 font-bold cursor-pointer"
            >
              <Palette className="h-4 w-4 text-amber-400" />
              <span>
                {showPromptModal
                  ? "Skryť AI Prompty"
                  : "🎨 Zobraziť AI Prompty"}
              </span>
            </Button>
            <Button
              size="sm"
              onClick={handleCopyAllPrompts}
              className="text-xs h-9 gap-1.5 font-bold cursor-pointer shadow-md bg-primary hover:bg-primary/90"
            >
              {copiedAllPrompts ? (
                <>
                  <Check className="h-4 w-4 text-emerald-300" />
                  <span>Skopírované!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  <span>Skopírovať scenár (A–Z)</span>
                </>
              )}
            </Button>
          </div>
        </div>

        {/* 3 HLAVNÉ PILIERE PRAVDY */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-3.5 relative z-10">
          {episodes.slice(0, 3).map((episode, index) => (
            <div
              key={episode.id}
              className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-1"
            >
              <div className="flex items-center gap-1.5 text-primary font-bold text-xs">
                {index === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <FileSearch className="h-3.5 w-3.5 shrink-0" />
                )}
                {index + 1}. {episode.title}
              </div>
              <p className="text-[11px] text-foreground/80 leading-snug">
                {episode.forensicAnalysis}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ KOPÍROVATEĽNÝ BOX S AI PROMPTAMI (AK JE ROZBALENÝ) ═══ */}
      <MasterPromptsDrawer
        isOpen={showPromptModal}
        onClose={() => setShowPromptModal(false)}
        episodes={episodes}
        copiedPromptId={copiedPromptId}
        onCopyPrompt={handleCopyPrompt}
      />

      {/* ═══ SEKCIA 1: KOMIKSOVÁ ČASOVÁ OS (A PO Z TIMESTORY) ═══ */}
      <Card className="space-y-4 p-4 sm:p-5 border-border/80 bg-card/95 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-primary flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Chronologická Timestory (2024 – 2026)
            </span>
            <h4 className="text-sm sm:text-base font-black text-foreground">
              Brutálny komiksový storyboard: Kapitoly A až F
            </h4>
          </div>

          {/* Navigačná lišta kapitol */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/70">
            {episodes.map((ep) => (
              <button
                key={ep.id}
                type="button"
                onClick={() => setActiveEpisodeId(ep.id)}
                className={`flex h-8 px-2.5 items-center justify-center gap-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  activeEpisodeId === ep.id
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : "hover:bg-muted text-muted-foreground hover:text-foreground"
                }`}
                title={ep.title}
              >
                <span>{ep.chapterLetter}</span>
                <span className="hidden md:inline font-mono text-[10px] opacity-80">
                  (Ep {ep.id})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ═══ AKTÍVNA EPIZÓDA S KOMIKSOVÝM PANELOM & FORENZNOU REALITOU ═══ */}
        <TimelineEventItem
          currentEpisode={currentEpisode}
          activeEpisodeId={activeEpisodeId}
          episodes={episodes}
          switching={switching}
          brokenImages={brokenImages}
          onImageError={handleImageError}
          isPlaying={isPlaying}
          playProgress={playProgress}
          onTogglePlay={togglePlaySlideshow}
          onPrev={handlePrevEpisode}
          onNext={handleNextEpisode}
          copiedPromptId={copiedPromptId}
          onCopyPrompt={handleCopyPrompt}
        />
      </Card>

      {/* ═══ SEKCIA 2: SÚHRNNÁ MATICA ANOMÁLIÍ (DEKONŠTRUKCIA OBŽALOBY) ═══ */}
      <Card className="space-y-3.5 p-4 sm:p-5 border-border/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-[10px] font-bold uppercase">
                {anomalies.length} KĽÚČOVÝCH ANOMÁLIÍ
              </Badge>
              <span className="text-xs text-muted-foreground font-semibold">
                Dekonštrukcia tvrdení OČTK & Procesné návrhy
              </span>
            </div>
            <h4 className="text-sm sm:text-base font-black text-foreground">
              Prehľad sporných bodov a ich okamžité logické vysvetlenie
            </h4>
          </div>

          {/* Filter sily */}
          <div className="flex items-center gap-1">
            {[
              "all",
              "Nepriestrelné",
              "Rozhodujúci rozpor",
              "Kritické pre OČTK",
            ].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterStrength(f)}
                className={`text-[10px] px-2 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  filterStrength === f
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {f === "all" ? `Všetky (${anomalies.length})` : f}
              </button>
            ))}
          </div>
        </div>

        {/* ZOZNAM KARIET ANOMÁLIÍ */}
        <div className="space-y-2.5">
          {filteredAnomalies.map((anomaly) => (
            <AnomalyCard
              key={anomaly.id}
              anomaly={anomaly}
              isExpanded={expandedAnomalyId === anomaly.id}
              onToggleExpand={() =>
                setExpandedAnomalyId((curr) =>
                  curr === anomaly.id ? null : anomaly.id,
                )
              }
              isMotionExpanded={expandedMotionId === anomaly.id}
              onToggleMotion={() =>
                setExpandedMotionId((curr) =>
                  curr === anomaly.id ? null : anomaly.id,
                )
              }
              isMotionCopied={copiedMotionId === anomaly.id}
              onCopyMotion={handleCopyMotion}
            />
          ))}
        </div>
      </Card>

      {/* ═══ SEKCIA 3: GEOGRAFICKÁ MAPA TRÁS & FORENZNÉ POROVNANIE POHYBU ═══ */}
      <TimelineRouteMap isDemo={isDemo} episodes={episodes} />

      {/* ═══ MODÁL PRE TLAČ STORYBOARDU PRE SENÁT ═══ */}
      <TimelinePrintModal
        isOpen={showPrintModal}
        onClose={() => setShowPrintModal(false)}
        caseTitle={caseTitle}
        caseId={dossier?.caseId ?? activeCase.id}
        isDemo={isDemo}
        episodes={episodes}
        brokenImages={brokenImages}
      />
    </div>
  );
}

export default TruthTimestorySection;
