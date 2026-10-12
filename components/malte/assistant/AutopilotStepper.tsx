import { AlertTriangle, Check } from "lucide-react";
import {
  AUTOPILOT_STEPS,
  AUTOPILOT_STEP_STATUS_LABELS,
  deriveAutopilotStep,
  type AutopilotStepInput,
} from "@/lib/forza/autopilot-steps";

/** Vizuálny 5-krokový sprievodca; stav je odvodený, nič neukladá ani neodosiela. */
export function AutopilotStepper(props: AutopilotStepInput) {
  const state = deriveAutopilotStep(props);
  const currentStep = AUTOPILOT_STEPS.find((s) => s.id === state.current)!;
  const currentStatus = state.statuses[state.current];

  return (
    <nav aria-label="Kroky Forenzného Autopilota" className="rounded-xl border border-white/15 bg-black/80 p-3 text-white">
      <ol className="grid grid-cols-5 gap-1.5">
        {AUTOPILOT_STEPS.map((step) => {
          const status = state.statuses[step.id];
          return (
            <li
              key={step.id}
              data-step={step.id}
              data-status={status}
              aria-current={step.id === state.current ? "step" : undefined}
              className="flex min-w-0 flex-col items-center gap-1 text-center"
            >
              <span
                aria-hidden
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-bold ${
                  status === "done"
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-300"
                    : status === "current"
                      ? "border-primary bg-primary/20 text-primary"
                      : status === "error"
                        ? "border-rose-400 bg-rose-500/20 text-rose-300"
                        : "border-white/20 text-neutral-400"
                }`}
              >
                {status === "done" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : status === "error" ? (
                  <AlertTriangle className="h-3.5 w-3.5" />
                ) : (
                  step.id
                )}
              </span>
              <span className="text-[10px] leading-tight text-neutral-200">
                {step.label}
                <span className="sr-only"> — {AUTOPILOT_STEP_STATUS_LABELS[status]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-live="polite" className="sr-only" data-testid="autopilot-step-status">
        {`Krok ${state.current} z ${AUTOPILOT_STEPS.length}: ${currentStep.label} — ${AUTOPILOT_STEP_STATUS_LABELS[currentStatus]}`}
      </p>
    </nav>
  );
}
