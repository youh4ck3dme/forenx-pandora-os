import { Palette, Copy, Check } from "lucide-react";
import { Card } from "@/components/malte/Shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { MASTER_COMIC_STYLE_ANCHOR, type TimestoryEpisode } from "./types";

interface MasterPromptsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  episodes: TimestoryEpisode[];
  copiedPromptId: number | null;
  onCopyPrompt: (episode: TimestoryEpisode) => void;
}

export function MasterPromptsDrawer({
  isOpen,
  onClose,
  episodes,
  copiedPromptId,
  onCopyPrompt,
}: MasterPromptsDrawerProps) {
  if (!isOpen) return null;

  return (
    <Card className="p-4 sm:p-5 border-amber-500/40 bg-linear-to-br from-card via-amber-950/10 to-card space-y-3.5 animate-in fade-in duration-200">
      <div className="flex items-center justify-between border-b border-border/70 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-amber-500/20 p-1.5 text-amber-400">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-black text-foreground uppercase tracking-wide">
              Master AI Prompty pre generovanie komiksu (Midjourney / Imagen / DALL-E)
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Skopíruj priamo do AI obrazového modelu a vytvor brutálne grafické noir panely
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="text-xs h-7 text-muted-foreground hover:text-foreground"
        >
          Zavrieť
        </Button>
      </div>

      <div className="rounded-lg bg-black/70 border border-amber-500/30 p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-amber-300 font-bold">
          <span>MASTER STYLE ANCHOR (Použiť na začiatku každého promptu):</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(MASTER_COMIC_STYLE_ANCHOR);
              toast.success("Master Style Anchor skopírovaný!");
            }}
            className="text-[10px] text-amber-400 hover:text-amber-200 underline cursor-pointer flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Skopírovať štýl
          </button>
        </div>
        <p className="text-xs font-mono text-white/90 leading-relaxed bg-black/50 p-2.5 rounded border border-white/10">
          {MASTER_COMIC_STYLE_ANCHOR}
        </p>
      </div>

      {/* Rýchly zoznam všetkých promptov s kopírovaním */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
        {episodes.map((ep) => (
          <div
            key={ep.id}
            className="rounded-lg border border-border/80 bg-muted/20 p-2.5 space-y-1.5 flex flex-col justify-between"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-mono font-bold">
                  {ep.chapterLetter} // EP {ep.id}
                </Badge>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {ep.date}
                </span>
              </div>
              <p className="text-xs font-bold text-foreground line-clamp-1">
                {ep.title}
              </p>
              <p className="text-[10px] font-mono text-amber-400/90 italic">
                SFX: {ep.soundEffect}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCopyPrompt(ep)}
              className="w-full h-7 text-[11px] gap-1 cursor-pointer font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10 mt-2"
            >
              {copiedPromptId === ep.id ? (
                <>
                  <Check className="h-3 w-3 text-emerald-400" />
                  <span>Skopírované!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span>Kopírovať prompt</span>
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
