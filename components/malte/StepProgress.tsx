import { ONBOARDING_STEPS } from "@/lib/onboarding";
import { cn } from "@/lib/utils";

/** Tenký ukazovateľ postupu „Krok N z 5“ nad krokmi vedeného toku. */
export function StepProgress({
  step,
  label,
  className,
}: {
  step: number;
  label?: string;
  className?: string;
}) {
  const total = ONBOARDING_STEPS;
  return (
    <div
      className={cn("space-y-2 font-welcome-body", className)}
      role="group"
      aria-label={`Krok ${step} z ${total}${label ? `: ${label}` : ""}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-inherit opacity-90">
        Krok {step} z {total}
        {label ? ` · ${label}` : ""}
      </p>
      <div
        className="flex gap-1"
        role="progressbar"
        aria-label={`Krok ${step} z ${total}${label ? `: ${label}` : ""}`}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`Krok ${step} z ${total}`}
      >
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={cn(
              "h-1 rounded-full flex-1 transition-colors",
              index < step ? "bg-amber-400" : "bg-white/20",
            )}
          />
        ))}
      </div>
    </div>
  );
}
