import { useState, useEffect } from "react";
import { toast } from "sonner";
import type { TimestoryEpisode } from "./types";

interface UseTimelinePlaybackProps {
  episodes: TimestoryEpisode[];
}

export function useTimelinePlayback({ episodes }: UseTimelinePlaybackProps) {
  const [activeEpisodeId, setActiveEpisodeId] = useState<number>(1);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playProgress, setPlayProgress] = useState<number>(0);
  const [switching, setSwitching] = useState<boolean>(false);

  // Zabezpeč, že activeEpisodeId existuje v aktuálnom poli epizód
  useEffect(() => {
    if (!episodes.some((episode) => episode.id === activeEpisodeId)) {
      setActiveEpisodeId(episodes[0]?.id ?? 1);
    }
  }, [activeEpisodeId, episodes]);

  // Automatický prehrávač filmového pásu (posun každých 6 sekúnd)
  useEffect(() => {
    if (!isPlaying) {
      setPlayProgress(0);
      return;
    }

    const intervalMs = 80;
    const durationMs = 6000;
    const step = (intervalMs / durationMs) * 100;

    const timer = setInterval(() => {
      setPlayProgress((prev) => {
        if (prev >= 100) {
          setActiveEpisodeId((curr) =>
            curr >= episodes.length ? 1 : curr + 1,
          );
          return 0;
        }
        return prev + step;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, episodes.length]);

  // Krátky prechod pri prepnutí kapitoly — vizuálna spätná väzba (320 ms)
  useEffect(() => {
    setSwitching(true);
    const id = setTimeout(() => setSwitching(false), 320);
    return () => clearTimeout(id);
  }, [activeEpisodeId]);

  function togglePlaySlideshow() {
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        toast.info("🎬 Filmový pás spustený: automatický posun o 6 sekúnd");
      }
      return next;
    });
  }

  function handlePrevEpisode() {
    setIsPlaying(false);
    setActiveEpisodeId((prev) => Math.max(1, prev - 1));
  }

  function handleNextEpisode() {
    setIsPlaying(false);
    setActiveEpisodeId((prev) => Math.min(episodes.length, prev + 1));
  }

  function selectEpisode(id: number) {
    setIsPlaying(false);
    setActiveEpisodeId(id);
  }

  const currentEpisode: TimestoryEpisode =
    episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0]!;

  return {
    activeEpisodeId,
    setActiveEpisodeId: selectEpisode,
    isPlaying,
    playProgress,
    switching,
    currentEpisode,
    togglePlaySlideshow,
    handlePrevEpisode,
    handleNextEpisode,
  };
}
