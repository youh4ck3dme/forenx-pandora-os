import {
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Copy,
  Check,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AnomalyItem } from "./types";
import { ContradictionMotionDialog } from "./ContradictionMotionDialog";

interface AnomalyCardProps {
  anomaly: AnomalyItem;
  isExpanded: boolean;
  onToggleExpand: () => void;
  isMotionExpanded: boolean;
  onToggleMotion: () => void;
  isMotionCopied: boolean;
  onCopyMotion: (anomaly: AnomalyItem) => void;
}

export function AnomalyCard({
  anomaly,
  isExpanded,
  onToggleExpand,
  isMotionExpanded,
  onToggleMotion,
  isMotionCopied,
  onCopyMotion,
}: AnomalyCardProps) {
  return (
    <div className="rounded-xl border border-border/80 bg-card text-card-foreground overflow-hidden transition-all shadow-xs">
      {/* Hlavička anomálie */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full text-left p-3 flex items-center justify-between gap-2 hover:bg-muted/30 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary font-black text-xs">
            {anomaly.id}
          </span>
          <div className="min-w-0">
            <h5 className="font-bold text-xs sm:text-sm text-foreground truncate">
              {anomaly.title}
            </h5>
            <p className="text-[11px] text-muted-foreground truncate">
              Zdroj: {anomaly.sourceOfClaim}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className={`text-[9px] font-bold ${
              anomaly.strength === "Nepriestrelné"
                ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                : anomaly.strength === "Rozhodujúci rozpor"
                  ? "border-rose-500/40 text-rose-400 bg-rose-500/10"
                  : "border-amber-500/40 text-amber-400 bg-amber-500/10"
            }`}
          >
            {anomaly.strength}
          </Badge>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Rozbalené detaily */}
      {isExpanded && (
        <div className="p-3 pt-0 border-t border-border/60 bg-muted/10 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-3">
            {/* Tvrdenie obžaloby */}
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Tvrdenie OČTK proti Novákovi:
              </span>
              <p className="text-xs text-foreground/90 font-medium">
                {anomaly.prosecutionClaim}
              </p>
            </div>

            {/* Forenzné rozbitie v prospech obhajoby */}
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Forenzné vysvetlenie (Dôkazné rozbitie):
              </span>
              <p className="text-xs text-foreground/95 font-medium">
                {anomaly.forensicTruth}
              </p>
            </div>
          </div>

          {/* Dôkazy a procesný návrh */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card text-card-foreground p-2.5 rounded-lg border border-border">
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-primary" /> Kľúčové fakty potvrdzujúce obhajobu:
              </span>
              <ul className="space-y-0.5 text-[11px] text-foreground/85">
                {anomaly.keyEvidence.map((ev, eIdx) => (
                  <li key={eIdx} className="flex items-center gap-1.5 truncate">
                    <span className="text-primary font-bold">•</span>
                    <span>{ev}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="shrink-0 space-y-2 sm:text-right border-t sm:border-t-0 sm:border-l border-border pt-2 sm:pt-0 sm:pl-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 block">
                  Procesný návrh:
                </span>
                <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 text-[10px] font-mono">
                  {anomaly.proceduralParagraph}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 sm:justify-end pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onToggleMotion}
                  className="h-7 text-[11px] gap-1 cursor-pointer font-semibold border-amber-500/30 text-amber-300 hover:bg-amber-500/10"
                >
                  <FileText className="h-3 w-3 text-amber-400" />
                  <span>{isMotionExpanded ? "Skryť návrh" : "Náhľad návrhu"}</span>
                </Button>
                <Button
                  size="sm"
                  onClick={() => onCopyMotion(anomaly)}
                  className="h-7 text-[11px] gap-1 cursor-pointer font-bold bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {isMotionCopied ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-300" />
                      <span>Skopírované!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Kopírovať pre súd</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* ROZBALENÝ TEXT PROCESNÉHO NÁVRHU PRE SÚD / OČTK */}
          <ContradictionMotionDialog
            anomaly={anomaly}
            isOpen={isMotionExpanded}
            onCopyMotion={onCopyMotion}
          />
        </div>
      )}
    </div>
  );
}
