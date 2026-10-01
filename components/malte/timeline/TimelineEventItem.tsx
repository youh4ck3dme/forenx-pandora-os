import {
  FileSearch,
  AlertTriangle,
  Users,
  MapPin,
  Flame,
  Car,
  Scale,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TimestoryEpisode } from "./types";
import { TimelinePlayerControls } from "./TimelinePlayerControls";

interface TimelineEventItemProps {
  currentEpisode: TimestoryEpisode;
  activeEpisodeId: number;
  episodes: TimestoryEpisode[];
  switching: boolean;
  brokenImages: Record<number, boolean>;
  onImageError: (id: number) => void;
  isPlaying: boolean;
  playProgress: number;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  copiedPromptId: number | null;
  onCopyPrompt: (episode: TimestoryEpisode) => void;
}

export function TimelineEventItem({
  currentEpisode,
  activeEpisodeId,
  episodes,
  switching,
  brokenImages,
  onImageError,
  isPlaying,
  playProgress,
  onTogglePlay,
  onPrev,
  onNext,
  copiedPromptId,
  onCopyPrompt,
}: TimelineEventItemProps) {
  return (
    <div
      key={activeEpisodeId}
      className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start animate-fade-in"
    >
      {/* ĽAVÁ ČASŤ: VIZUÁL KOMIKSOVÉHO PANELU */}
      <div className="lg:col-span-7 space-y-2.5">
        <div className="relative overflow-hidden rounded-2xl border-2 border-black/80 bg-black shadow-2xl group transition-transform duration-300 hover:scale-[1.01]">
          {switching ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-[2px]">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
          ) : null}

          {/* Halftone komiksový vzor v ráme */}
          <div
            className="absolute inset-0 opacity-15 pointer-events-none z-10"
            style={{
              backgroundImage:
                "radial-gradient(circle, #fff 1px, transparent 1px)",
              backgroundSize: "6px 6px",
            }}
          />

          {currentEpisode.comicImage && !brokenImages[currentEpisode.id] ? (
            /* Zobrazenie skutočne vygenerovaného komiksového obrazu */
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentEpisode.comicImage}
                alt={currentEpisode.title}
                width={1280}
                height={720}
                className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                onError={() => onImageError(currentEpisode.id)}
              />
              <div className="absolute inset-0 bg-linear-to-t from-black via-black/30 to-transparent pointer-events-none" />

              {/* Žltý noir komiksový narrátor box (hore) */}
              <div className="absolute top-3 left-3 right-3 z-20">
                <div className="bg-yellow-400 text-black px-3 py-1.5 rounded-sm font-black text-[10px] uppercase tracking-wider shadow-lg border-2 border-black rotate-[-0.5deg]">
                  {currentEpisode.narratorBox}
                </div>
              </div>

              {/* Zvukový efekt Onomatopoeia (plávajúci komiksový nápis) */}
              <div className="absolute bottom-16 right-4 z-20 pointer-events-none">
                <span className="font-black italic text-lg sm:text-2xl text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] tracking-widest rotate-[-4deg] animate-pulse">
                  {currentEpisode.soundEffect}
                </span>
              </div>

              {/* Spodný popis panelu */}
              <div className="absolute bottom-3 left-3 right-3 z-20 flex items-center justify-between text-[11px] text-white/95 font-medium bg-black/85 p-2 rounded-lg backdrop-blur-xs border border-white/20">
                <span className="italic truncate pr-2">
                  "{currentEpisode.caption}"
                </span>
                <Badge className="bg-primary/80 text-primary-foreground shrink-0 text-[9px] font-mono">
                  PANEL {currentEpisode.chapterLetter}
                </Badge>
              </div>
            </div>
          ) : (
            /* Brutálny grafický komiksový panel (fallback s dynamickým nočným SVG & efektmi) */
            <div className="relative aspect-video w-full flex flex-col justify-between p-4 bg-linear-to-br from-slate-950 via-zinc-950 to-neutral-900 border-2 border-primary/40 overflow-hidden">
              {/* Efekt nočného dažďa a tieňov */}
              <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_45%,rgba(255,255,255,0.05)_50%,transparent_55%)] pointer-events-none" />

              {/* Žltý noir komiksový narrátor box */}
              <div className="relative z-20">
                <div className="bg-yellow-400 text-black px-3 py-1.5 rounded-sm font-black text-[10px] uppercase tracking-wider shadow-lg border-2 border-black rotate-[-0.5deg] max-w-lg">
                  {currentEpisode.narratorBox}
                </div>
              </div>

              {/* Grafická scéna v strede (Siluety a dramatická kompozícia) */}
              <div className="relative z-20 my-auto text-center space-y-2 py-4">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border-2 border-amber-500/40 shadow-lg mx-auto -rotate-2">
                  {currentEpisode.id === 4 ? (
                    <Flame className="h-7 w-7 text-rose-500 animate-bounce" />
                  ) : currentEpisode.id === 5 ? (
                    <Car className="h-7 w-7 text-cyan-400" />
                  ) : (
                    <Scale className="h-7 w-7 text-amber-400" />
                  )}
                </div>

                <h5 className="font-black text-base sm:text-lg text-white uppercase tracking-wider">
                  {currentEpisode.title}
                </h5>

                {/* Veľké onomatopoeia */}
                <div className="pt-1">
                  <span className="inline-block font-black italic text-xl sm:text-3xl text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,1)] tracking-widest -rotate-3">
                    {currentEpisode.soundEffect}
                  </span>
                </div>

                <p className="text-xs text-white/80 max-w-md mx-auto italic px-2">
                  "{currentEpisode.caption}"
                </p>
              </div>

              {/* Spodná lišta grafického panelu */}
              <div className="relative z-20 flex items-center justify-between text-[10px] text-muted-foreground border-t border-white/10 pt-2 bg-black/60 -mx-4 -mb-4 px-4 py-2">
                <span className="flex items-center gap-1.5 text-white/80 font-mono">
                  <MapPin className="h-3 w-3 text-primary" />
                  {currentEpisode.location}
                </span>
                <span className="font-mono text-amber-400 font-black tracking-wider">
                  KAPITOLA {currentEpisode.chapterLetter} // EP {currentEpisode.id}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* KOMIKSOVÉ BUBLINY / REČOVÉ BALÓNY V SCÉNE */}
        <div className="rounded-xl border border-border/80 bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> Rečové bubliny & dialógy scény:
            </span>
            <span className="text-[10px] font-mono text-primary font-bold">
              {currentEpisode.dialogues.length} repliky
            </span>
          </div>

          <div className="space-y-2 pt-1">
            {currentEpisode.dialogues.map((dlg, dIdx) => {
              const isNovak = dlg.role === "Novák";
              return (
                <div
                  key={dIdx}
                  className={`flex flex-col text-xs ${
                    isNovak ? "items-start" : "items-end"
                  }`}
                >
                  <span className="text-[10px] font-bold text-muted-foreground px-1 mb-0.5">
                    {dlg.speaker}
                  </span>
                  <div
                    className={`max-w-[88%] rounded-xl px-3 py-2 text-xs shadow-sm border ${
                      isNovak
                        ? "bg-primary/15 border-primary/30 text-foreground font-medium rounded-tl-xs"
                        : "bg-amber-500/15 border-amber-500/30 text-amber-200 font-medium rounded-tr-xs"
                    }`}
                  >
                    "{dlg.text}"
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* AKČNÁ LIŠTA POD PANELOM: PREKLIK, PREHRÁVAČ & KOPÍROVANIE PROMPTU */}
        <TimelinePlayerControls
          isPlaying={isPlaying}
          playProgress={playProgress}
          activeEpisodeId={activeEpisodeId}
          episodes={episodes}
          currentEpisode={currentEpisode}
          onTogglePlay={onTogglePlay}
          onPrev={onPrev}
          onNext={onNext}
          copiedPromptId={copiedPromptId}
          onCopyPrompt={onCopyPrompt}
        />
      </div>

      {/* PRAVÁ ČASŤ: FORENZNÁ REALITA & DEMASKOVANIE KLAMSTIEV */}
      <div className="lg:col-span-5 space-y-3">
        <div className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-md">
          <div className="flex items-center justify-between border-b border-border/60 pb-2">
            <span className="text-[10px] font-mono font-bold text-primary uppercase">
              {currentEpisode.date} · {currentEpisode.location}
            </span>
            <Badge variant="secondary" className="text-[10px] font-bold">
              Skutková realita
            </Badge>
          </div>

          <h4 className="text-base sm:text-lg font-black text-foreground">
            {currentEpisode.title}
          </h4>

          {/* Forenzná analýza reality */}
          <div className="rounded-lg bg-muted/40 border border-border/60 p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <FileSearch className="h-3.5 w-3.5 text-primary" /> Skutočný priebeh udalosti (Fakty zo spisu):
            </span>
            <p className="text-xs text-foreground/90 leading-relaxed">
              {currentEpisode.forensicAnalysis}
            </p>
          </div>

          {/* Vyvrátené klamstvo obžaloby */}
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-400" /> Vyvrátené skreslenie / klamstvo OČTK:
            </span>
            <p className="text-xs text-foreground/95 leading-relaxed font-semibold">
              {currentEpisode.debunkedLie}
            </p>
          </div>

          {/* Prompt Detail Box pre túto scénu */}
          <div className="rounded-lg bg-black/50 border border-amber-500/30 p-2.5 space-y-1 font-mono text-[11px]">
            <div className="flex items-center justify-between text-amber-400 font-bold text-[10px]">
              <span>Vizuálny popis kamery & scény:</span>
              <span className="text-muted-foreground">
                {currentEpisode.cameraAngle}
              </span>
            </div>
            <p className="text-[10px] text-white/70 line-clamp-2">
              {currentEpisode.comicPrompt}
            </p>
          </div>

          {/* Aktéri scény */}
          <div className="space-y-1 pt-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <Users className="h-3 w-3 text-primary/70" /> Reálni aktéri v scéne:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {currentEpisode.involvedActors.map((actor, aIdx) => (
                <Badge
                  key={aIdx}
                  variant="outline"
                  className="text-[10px] bg-muted/60 border-border/80 text-foreground font-medium"
                >
                  {actor}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
