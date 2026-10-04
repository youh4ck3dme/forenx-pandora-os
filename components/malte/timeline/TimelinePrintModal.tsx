import { Printer, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TimestoryEpisode } from "./types";

interface TimelinePrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  caseTitle: string;
  caseId: string;
  isDemo: boolean;
  episodes: TimestoryEpisode[];
  brokenImages: Record<number, boolean>;
}

export function TimelinePrintModal({
  isOpen,
  onClose,
  caseTitle,
  caseId,
  isDemo,
  episodes,
  brokenImages,
}: TimelinePrintModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-5xl bg-card text-card-foreground border-2 border-border/80 rounded-2xl shadow-2xl p-5 sm:p-7 space-y-5 my-8">
        {/* Horná lišta modálu */}
        <div className="flex items-center justify-between border-b border-border/80 pb-3">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/20 p-2 text-emerald-400">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-foreground uppercase tracking-wide">
                Tlačová zostava: Vizuálna dôkazná príloha pre súd
              </h3>
              <p className="text-xs text-muted-foreground font-mono">
                {caseId} // Zrekonštruovaný dej od A po Z
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => window.print()}
              className="gap-1.5 bg-primary hover:bg-primary/90 text-xs font-bold cursor-pointer shadow-md"
            >
              <Printer className="h-4 w-4" />
              <span>Vytlačiť / Uložiť do PDF</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Samotný tlačový obsah */}
        <div className="space-y-6 text-foreground">
          {/* Formálna hlavička podania */}
          <div className="border-b-2 border-foreground/20 pb-4 text-center space-y-1">
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground block">
              {isDemo
                ? "SYNTETICKÁ UKÁŽKA — FIKTÍVNE ÚDAJE • DEMONŠTRATÍVNY STORYBOARD"
                : "PRACOVNÝ STORYBOARD Z AKTÍVNEHO SPISU • VYŽADUJE OVERENIE ZDROJOV"}
            </span>
            <h2 className="text-xl font-black uppercase tracking-tight">
              {caseTitle}: Priebeh od A po Z
            </h2>
            <p className="text-xs text-muted-foreground max-w-2xl mx-auto">
              Pracovná rekonštrukcia založená na udalostiach a zisteniach aktuálneho dosiéru; nejde o samostatný dôkaz ani znalecký posudok.
            </p>
          </div>

          {/* Všetky kapitoly v tlačovom zobrazení */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {episodes.map((ep) => (
              <div
                key={ep.id}
                className="border-2 border-border/80 rounded-xl p-3.5 space-y-2.5 bg-muted/10 break-inside-avoid"
              >
                <div className="flex items-center justify-between border-b border-border/60 pb-1.5">
                  <Badge className="bg-primary/20 text-primary border-primary/40 font-mono font-bold text-[10px]">
                    KAPITOLA {ep.chapterLetter} // EP {ep.id}
                  </Badge>
                  <span className="text-[10px] font-mono text-muted-foreground font-bold">
                    {ep.date} · {ep.location}
                  </span>
                </div>

                <h4 className="font-black text-sm text-foreground">
                  {ep.title}
                </h4>

                {/* Vizuál kapitoly */}
                <div className="relative aspect-video rounded-lg overflow-hidden border border-border bg-black">
                  {ep.comicImage && !brokenImages[ep.id] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={ep.comicImage}
                      alt={ep.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex flex-col items-center justify-center p-3 text-center bg-zinc-950 text-white space-y-1">
                      <span className="text-amber-400 font-mono font-black text-xs">
                        {ep.soundEffect}
                      </span>
                      <span className="text-[10px] text-muted-foreground italic line-clamp-2">
                        "{ep.caption}"
                      </span>
                    </div>
                  )}
                  <div className="absolute top-1.5 left-1.5 right-1.5 bg-yellow-400 text-black px-2 py-0.5 rounded-xs font-black text-[8px] uppercase tracking-wider">
                    {ep.narratorBox}
                  </div>
                </div>

                {/* Dialógy */}
                <div className="space-y-1 bg-black/40 p-2 rounded border border-border/50 text-[10px]">
                  {ep.dialogues.map((dlg, dIdx) => (
                    <p key={dIdx} className="leading-tight">
                      <strong className="text-amber-400">{dlg.speaker}:</strong>{" "}
                      <span className="text-white/90">"{dlg.text}"</span>
                    </p>
                  ))}
                </div>

                {/* Forenzný fakt */}
                <div className="rounded bg-emerald-500/10 border border-emerald-500/30 p-2 text-[10px] text-foreground space-y-0.5">
                  <strong className="text-emerald-400 block font-bold">
                    Skutočnosť zo spisu:
                  </strong>
                  <p className="leading-snug">{ep.forensicAnalysis}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Doložka integrity */}
          <div className="border-t border-border/80 pt-3 flex flex-col sm:flex-row items-center justify-between text-[10px] font-mono text-muted-foreground gap-2">
            <span>Doložka pravdivosti a dôkaznej nemennosti podľa § 119 TP</span>
            <span>Identifikátor spisu: {caseId}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
