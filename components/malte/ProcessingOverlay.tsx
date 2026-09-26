import { useEffect, useState } from "react";
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

  return (
    <div
      className="processing-overlay fixed inset-0 z-100 flex items-center justify-center overflow-hidden px-5 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="processing-title"
      aria-describedby="processing-detail"
    >
      <div className="processing-mist" aria-hidden />
      <div className="processing-panel w-full max-w-sm overflow-hidden rounded-2xl border border-border p-6 shadow-elevated sm:p-8">
        <div
          className="processing-hourglass mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full"
          aria-hidden
        >
          <span className="processing-hourglass-ring absolute inset-0 rounded-full" />
          <Hourglass
            className="processing-hourglass-icon relative h-12 w-12 text-primary"
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
          <div className="rounded-lg border border-border bg-background/45 p-3 text-center">
            <p className="text-label">Uplynulo</p>
            <p
              className="mt-1 text-sm font-bold text-foreground tnum"
              suppressHydrationWarning
            >
              {formatElapsed(elapsed)}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-background/45 p-3 text-center">
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

        <div className="mt-5 min-w-0 rounded-lg bg-muted/60 px-3 py-2 text-center">
          <p className="truncate text-xs font-medium text-foreground">
            {fileName || "Spracúvam pripravené dokumenty"}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Nezatvárajte aplikáciu
          </p>
        </div>
      </div>
    </div>
  );
}
