import { Button } from "@/components/ui/button";
import { Play, Pause, Copy, Check } from "lucide-react";
import type { TimestoryEpisode } from "./types";

interface TimelinePlayerControlsProps {
  isPlaying: boolean;
  playProgress: number;
  activeEpisodeId: number;
  episodes: TimestoryEpisode[];
  currentEpisode: TimestoryEpisode;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  copiedPromptId: number | null;
  onCopyPrompt: (episode: TimestoryEpisode) => void;
}

export function TimelinePlayerControls({
  isPlaying,
  playProgress,
  activeEpisodeId,
  episodes,
  currentEpisode,
  onTogglePlay,
  onPrev,
  onNext,
  copiedPromptId,
  onCopyPrompt,
}: TimelinePlayerControlsProps) {
  const prevChapter =
    episodes[Math.max(0, activeEpisodeId - 2)]?.chapterLetter;
  const nextChapter =
    episodes[Math.min(episodes.length - 1, activeEpisodeId)]?.chapterLetter;

  return (
    <div className="space-y-2 pt-1">
      {/* Slideshow Progress Bar ak hrá */}
      {isPlaying && (
        <div className="w-full bg-muted/60 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-amber-400 h-full transition-all duration-100 ease-linear rounded-full"
            style={{ width: `${playProgress}%` }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1 cursor-pointer font-bold"
            disabled={activeEpisodeId <= 1}
            onClick={onPrev}
          >
            ← Kapitola {prevChapter}
          </Button>

          <Button
            size="sm"
            variant={isPlaying ? "default" : "outline"}
            onClick={onTogglePlay}
            className={`text-xs h-8 gap-1.5 font-bold cursor-pointer transition-all ${
              isPlaying
                ? "bg-amber-500 hover:bg-amber-400 text-black border-none shadow-md"
                : "border-primary/40 text-primary hover:bg-primary/10"
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Pozastaviť film</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                <span>Prehrať filmový pás</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="text-xs h-8 gap-1 cursor-pointer font-bold"
            disabled={activeEpisodeId >= episodes.length}
            onClick={onNext}
          >
            Kapitola {nextChapter} →
          </Button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => onCopyPrompt(currentEpisode)}
          className="text-xs h-8 gap-1.5 border border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 font-bold cursor-pointer"
        >
          {copiedPromptId === currentEpisode.id ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span>Prompt skopírovaný!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 text-amber-400" />
              <span>Kopírovať Prompt pre Midjourney</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
