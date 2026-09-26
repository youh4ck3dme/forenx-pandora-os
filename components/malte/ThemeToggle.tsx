import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCaseStore, type ThemeMode } from "@/hooks/useCaseStore";
import { useLayoutEffect, useState } from "react";

const modes: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Svetlá téma", icon: Sun },
  { id: "dark", label: "Tmavá téma", icon: Moon },
  { id: "system", label: "Podľa systému", icon: Monitor },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { state, setTheme } = useCaseStore();
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  // Don't render during SSR to avoid hydration mismatch
  if (!mounted) {
    return (
      <div
        role="group"
        aria-label="Téma"
        className={cn(
          "inline-flex items-center rounded-full border border-border/70 bg-surface/70 p-0.5 shadow-xs backdrop-blur-xs",
          className,
        )}
      >
        <button
          type="button"
          title="Svetlá téma"
          aria-label="Svetlá téma"
          className="relative flex items-center justify-center rounded-full p-1.5 transition-all duration-200"
          disabled
        >
          <Sun className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          title="Tmavá téma"
          aria-label="Tmavá téma"
          className="relative flex items-center justify-center rounded-full p-1.5 transition-all duration-200"
          disabled
        >
          <Moon className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button
          type="button"
          title="Podľa systému"
          aria-label="Podľa systému"
          className="relative flex items-center justify-center rounded-full p-1.5 transition-all duration-200"
          disabled
        >
          <Monitor className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label="Téma"
      className={cn(
        "inline-flex items-center rounded-full border border-border/70 bg-surface/70 p-0.5 shadow-xs backdrop-blur-xs",
        className,
      )}
    >
      {modes.map(({ id, label, icon: Icon }) => {
        const isSelected = state.theme === id;
        return (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={isSelected}
            onClick={() => setTheme(id)}
            className={cn(
              "relative flex items-center justify-center rounded-full p-1.5 transition-all duration-200 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-foreground text-background shadow-xs"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
