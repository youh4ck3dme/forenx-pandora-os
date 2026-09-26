import { useState, useEffect, useCallback } from "react";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LAWYER_TOUR_STEPS, type TourStep } from "@/lib/lawyer-tour-steps";

export interface LawyerTourGuideProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectStepAction?: (stepId: number) => void;
}

export function LawyerTourGuide({
  isOpen,
  onClose,
  onSelectStepAction,
}: LawyerTourGuideProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const step = LAWYER_TOUR_STEPS[currentStepIndex] || LAWYER_TOUR_STEPS[0]!;
  const Icon = step.icon;
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === LAWYER_TOUR_STEPS.length - 1;

  const handleNext = useCallback(() => {
    if (isLast) {
      if (typeof window !== "undefined") {
        window.localStorage.setItem("forendo_lawyer_tour_completed", "true");
      }
      onClose();
    } else {
      setCurrentStepIndex((prev) =>
        Math.min(prev + 1, LAWYER_TOUR_STEPS.length - 1),
      );
    }
  }, [isLast, onClose]);

  const handlePrev = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const handleSkip = useCallback(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("forendo_lawyer_tour_completed", "true");
    }
    onClose();
  }, [onClose]);

  // Klávesové skratky
  useEffect(() => {
    if (!isOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        handleSkip();
      } else if (e.key === "ArrowRight") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleNext, handlePrev, handleSkip]);

  // Scroll na cieľový prvok, ak existuje
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const el = document.getElementById(step.targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [isOpen, step.targetId]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sprievodca spisom pre advokáta"
        className="relative w-full max-w-lg rounded-2xl border border-primary/30 bg-card p-6 shadow-2xl transition-all"
      >
        {/* Horná lišta */}
        <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Sprievodca spisom pre advokáta
            </span>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label="Zatvoriť sprievodcu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Telo kroku */}
        <div className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/20">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <Badge
                  variant="outline"
                  className="border-primary/40 bg-primary/10 text-primary text-[11px]"
                >
                  {step.badge}
                </Badge>
                <h3 className="text-base font-bold text-foreground mt-0.5">
                  {step.title}
                </h3>
              </div>
            </div>
            {step.proceduralParagraph && (
              <Badge
                variant="secondary"
                className="text-[11px] font-mono shrink-0"
              >
                {step.proceduralParagraph}
              </Badge>
            )}
          </div>

          <p className="text-sm text-foreground/90 leading-relaxed">
            {step.summary}
          </p>

          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
            <span className="font-semibold block mb-0.5 text-amber-200">
              💡 Taktický tip pre advokáta:
            </span>
            {step.lawyerTip}
          </div>

          {step.actionLabel && onSelectStepAction && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="secondary"
                className="w-full text-xs font-medium border border-border"
                onClick={() => onSelectStepAction(step.id)}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1 text-primary" />
                {step.actionLabel}
              </Button>
            </div>
          )}
        </div>

        {/* Priebeh a ovládanie */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-1.5" aria-hidden>
            {LAWYER_TOUR_STEPS.map((s, idx) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setCurrentStepIndex(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === currentStepIndex
                    ? "w-6 bg-primary"
                    : idx < currentStepIndex
                      ? "w-2 bg-primary/50"
                      : "w-2 bg-border"
                }`}
                aria-label={`Prejsť na krok ${idx + 1}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isFirst}
              onClick={handlePrev}
              className="text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-0.5" /> Späť
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleNext}
              className="text-xs font-semibold"
            >
              {isLast ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-1 text-emerald-400" />{" "}
                  Dokončiť
                </>
              ) : (
                <>
                  Ďalej <ChevronRight className="h-4 w-4 ml-0.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
