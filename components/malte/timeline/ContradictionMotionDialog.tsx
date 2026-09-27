import { Scale, Copy } from "lucide-react";
import type { AnomalyItem } from "./types";

interface ContradictionMotionDialogProps {
  anomaly: AnomalyItem;
  isOpen: boolean;
  onCopyMotion: (anomaly: AnomalyItem) => void;
}

export function ContradictionMotionDialog({
  anomaly,
  isOpen,
  onCopyMotion,
}: ContradictionMotionDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="rounded-lg bg-black/80 border border-amber-500/40 p-3 space-y-2 animate-in fade-in duration-150">
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
        <span className="text-[10px] font-mono font-bold text-amber-300 flex items-center gap-1.5">
          <Scale className="h-3.5 w-3.5 text-amber-400" />
          Oficiálny procesný návrh pre OČTK / Súd ({anomaly.proceduralParagraph}):
        </span>
        <button
          type="button"
          onClick={() => onCopyMotion(anomaly)}
          className="text-[10px] text-amber-400 hover:text-amber-200 underline cursor-pointer flex items-center gap-1 font-mono"
        >
          <Copy className="h-3 w-3" /> Skopírovať text podania
        </button>
      </div>
      <pre className="text-[11px] font-mono text-white/90 whitespace-pre-wrap leading-relaxed bg-black/50 p-2.5 rounded border border-white/10 select-all max-h-96 overflow-y-auto">
        {anomaly.motionText}
      </pre>
    </div>
  );
}
