import React from "react";
import { AppHeader } from "@/components/malte/Shell";
import { AI_DISCLAIMER } from "@/config/brand";
import { Sparkles, Bot } from "lucide-react";

interface AssistantHeaderProps {
  mainMode: "autopilot" | "quick_tasks";
  setMainMode: (mode: "autopilot" | "quick_tasks") => void;
}

export function AssistantHeader({ mainMode, setMainMode }: AssistantHeaderProps) {
  return (
    <>
      <AppHeader title="Forenzný Autopilot">
        <p className="px-5 pb-1 text-xs text-foreground/80">
          1 Drop → 1 Obrazovka → 1 Export
        </p>
      </AppHeader>

      <div className="space-y-4">
        {/* Trvalé právne upozornenie ku každému AI výstupu. */}
        <div
          role="note"
          className="rounded-xl border border-risk-medium/50 bg-black/85 backdrop-blur-md px-4 py-3 text-xs font-medium leading-relaxed text-neutral-100 shadow-md"
        >
          {AI_DISCLAIMER}
        </div>

        {/* Prepínač hlavného režimu */}
        <div className="flex rounded-xl bg-black/85 backdrop-blur-md border border-white/20 p-1 shadow-md">
          <button
            type="button"
            onClick={() => setMainMode("autopilot")}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
              mainMode === "autopilot"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Forenzný Autopilot (Full Spis)
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMainMode("quick_tasks")}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
              mainMode === "quick_tasks"
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              Rýchle úlohy
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
