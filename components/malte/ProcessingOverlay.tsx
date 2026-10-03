import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Hourglass } from "lucide-react";
import {
  formatElapsed,
  PROCESSING_COPY,
  processingProgress,
  type ProcessingStage,
} from "@/lib/processing-progress";

type ProcessingOverlayProps = {
  active: boolean;
  stage: ProcessingStage;
  fileName?: string;
  currentItem?: number;
  totalItems?: number;
};

export function ProcessingOverlay({
  active,
  stage,
  fileName,
  currentItem = 1,
  totalItems = 1,
}: ProcessingOverlayProps) {
  const [elapsed, setElapsed] = useState(0);
  const [now, setNow] = useState("");
  // Overlay len na klientovi — zabráni SSR/client mismatch (#418) pri čase a DOM.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      setNow("");
      return;
    }
    const startedAt = Date.now();
    const tick = () => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      setNow(
        new Date().toLocaleTimeString("sk-SK", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [active]);

  if (!active || !mounted) return null;

  const copy = PROCESSING_COPY[stage];
  const progress = processingProgress({
    stage,
    elapsedSeconds: elapsed,
    currentItem,
    totalItems,
  });
  const uploadDone =
    stage === "analysing" || stage === "saving" || stage === "complete";

  const overlayContent = (
    <div
      className="processing-overlay fixed inset-0 z-9999 flex items-center justify-center overflow-y-auto p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-title"
      aria-describedby="processing-detail"
    >
      <div
        className="processing-mist fixed inset-0 z-9998 bg-black/92 backdrop-blur-xl transition-opacity animate-in fade-in duration-200"
        aria-hidden
      />
      <div className="processing-panel relative z-9999 w-full max-w-sm sm:max-w-md overflow-hidden rounded-2xl border border-white/20 bg-[#0e1117] text-white p-6 shadow-[0_20px_60px_rgba(0,0,0,0.95)] sm:p-8 animate-in zoom-in-95 duration-200">
        <div
          className="processing-hourglass relative mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 border border-primary/25"
          aria-hidden
        >
          <span className="processing-hourglass-ring absolute inset-0 rounded-full border border-primary/30 animate-ping opacity-30" />
          <Hourglass
            className="processing-hourglass-icon relative h-10 w-10 text-primary animate-pulse"
            strokeWidth={1.5}
          />
          <span className="processing-grain processing-grain-one" />
          <span className="processing-grain processing-grain-two" />
          <span className="processing-grain processing-grain-three" />
        </div>

        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase text-primary">
            Bezpečné spracovanie prípadu
          </p>
          <h2
            id="processing-title"
            className="mt-2 text-xl font-bold text-foreground"
          >
            {copy.title}
          </h2>
          <p
            id="processing-detail"
            className="mt-2 text-sm leading-relaxed text-muted-foreground"
          >
            {copy.detail}
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-center">
            <p className="text-label">Uplynulo</p>
            <p
              className="mt-1 text-sm font-bold text-foreground tnum"
              suppressHydrationWarning
            >
              {formatElapsed(elapsed)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3 text-center">
            <p className="text-label">Aktuálny čas</p>
            <p
              className="mt-1 text-sm font-bold text-foreground tnum"
              suppressHydrationWarning
            >
              {now || "--:--:--"}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-muted-foreground">
              Odhadovaný postup
            </span>
            <span className="font-bold text-foreground tnum">{progress} %</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Odhadovaný postup"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="mt-5 space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${uploadDone ? "bg-risk-low text-risk-low-foreground" : "border-2 border-primary"}`}
            >
              {uploadDone ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              ) : null}
            </span>
            <span
              className={
                uploadDone
                  ? "text-muted-foreground"
                  : "font-semibold text-primary"
              }
            >
              Načítanie dokumentov
            </span>
            <span className="ml-auto text-xs text-muted-foreground tnum">
              {Math.min(currentItem, totalItems)}/{Math.max(1, totalItems)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${stage === "complete" ? "bg-risk-low text-risk-low-foreground" : stage === "analysing" || stage === "saving" ? "processing-active-dot border-2 border-primary" : "border border-border"}`}
            >
              {stage === "complete" ? (
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
              ) : null}
            </span>
            <span
              className={
                stage === "analysing" ||
                stage === "saving" ||
                stage === "complete"
                  ? "font-semibold text-primary"
                  : "text-muted-foreground"
              }
            >
              Analýza a uloženie
            </span>
          </div>
        </div>

        <div className="mt-5 min-w-0 rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-center">
          <p className="truncate text-xs font-medium text-white">
            {fileName || "Spracúvam pripravené dokumenty"}
          </p>
          <p className="mt-1 text-[10px] text-zinc-400">
            Nezatvárajte aplikáciu
          </p>
        </div>
      </div>
    </div>
  );

  return createPortal(overlayContent, document.body);
}
