import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Bell,
  CheckCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { useCaseStore } from "@/lib/hooks/useCaseStore";
import { severityLabel, type Severity } from "@/lib/forza/forensic";

type FilterTab = "all" | "unread" | "critical";

export function NotificationsBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<FilterTab>("unread");
  const { analysis, activeCase } = useActiveCase();
  const { state, toggleReviewed, markAllReviewed } = useCaseStore();

  const alerts = analysis.alerts;

  const unreadAlerts = useMemo(
    () => alerts.filter((a: { id: string; severity: Severity }) => !state.reviewed.includes(a.id)),
    [alerts, state.reviewed],
  );

  const criticalCount = useMemo(
    () => alerts.filter((a: { severity: Severity }) => a.severity === "critical").length,
    [alerts],
  );

  const unreadCriticalCount = useMemo(
    () => unreadAlerts.filter((a: { severity: Severity }) => a.severity === "critical").length,
    [unreadAlerts],
  );

  const filteredAlerts = useMemo(() => {
    switch (tab) {
      case "unread":
        return unreadAlerts;
      case "critical":
        return alerts.filter((a: { severity: Severity }) => a.severity === "critical");
      case "all":
      default:
        return alerts;
    }
  }, [tab, alerts, unreadAlerts]);

  const handleMarkAllRead = () => {
    const idsToMark = alerts.map((a: { id: string }) => a.id);
    markAllReviewed(idsToMark);
    toast.success("Všetky upozornenia boli označené ako prečítané", {
      description: `${idsToMark.length} zistení v prípade „${activeCase.name}“`,
    });
  };

  const handleToggleSingle = (id: string, title: string) => {
    const isNowReviewed = state.reviewed.includes(id);
    toggleReviewed(id);
    if (!isNowReviewed) {
      toast.info("Upozornenie prečítané", { description: title });
    }
  };

  const unreadCount = unreadAlerts.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Forenzné upozornenia (${unreadCount} nových)`}
          title={
            unreadCount > 0
              ? `${unreadCount} nových upozornení (${unreadCriticalCount} kritických)`
              : "Upozornenia prípadu"
          }
          className={cn(
            "group relative flex h-8 w-8 items-center justify-center rounded-full border border-border/70 bg-surface/70 text-foreground/80 shadow-xs backdrop-blur-xs transition-all duration-200 hover:bg-surface-2 hover:text-foreground active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            unreadCriticalCount > 0 && "border-risk-high/40 text-risk-high",
            className,
          )}
        >
          <Bell
            className={cn(
              "h-4 w-4 transition-transform duration-300 group-hover:rotate-12",
              unreadCriticalCount > 0 &&
                "animate-[bounce_2s_ease-in-out_infinite]",
            )}
            aria-hidden
          />
          {unreadCount > 0 ? (
            <span
              className={cn(
                "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-extrabold tnum shadow-xs",
                unreadCriticalCount > 0
                  ? "bg-risk-high text-risk-high-foreground animate-pulse"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-85 sm:w-95 p-0 overflow-hidden rounded-2xl border border-border bg-card/95 text-card-foreground backdrop-blur-md shadow-elevated"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 bg-surface/40">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Bell className="h-3.5 w-3.5" />
            </span>
            <div>
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Upozornenia
              </h2>
              <p className="text-[11px] text-muted-foreground truncate max-w-40">
                {activeCase.name}
              </p>
            </div>
          </div>

          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
            >
              <CheckCheck className="h-3 w-3" />
              Prečítať všetko
            </button>
          ) : null}
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 border-b border-border/40 px-3 py-2 bg-surface/20">
          <button
            type="button"
            onClick={() => setTab("unread")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              tab === "unread"
                ? "bg-foreground text-background shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60",
            )}
          >
            Nové ({unreadCount})
          </button>
          <button
            type="button"
            onClick={() => setTab("critical")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              tab === "critical"
                ? "bg-risk-high text-risk-high-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60",
            )}
          >
            Kritické ({criticalCount})
          </button>
          <button
            type="button"
            onClick={() => setTab("all")}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors",
              tab === "all"
                ? "bg-foreground text-background shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground hover:bg-surface-2/60",
            )}
          >
            Všetky ({alerts.length})
          </button>
        </div>

        {/* Alert list */}
        <ScrollArea className="max-h-85">
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <ShieldCheck className="h-10 w-10 text-risk-low opacity-80 mb-2" />
              <p className="text-sm font-semibold text-foreground">
                Žiadne upozornenia
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-55">
                {tab === "unread"
                  ? "Všetky zistenia v tomto prípade sú prečítané a preverené."
                  : tab === "critical"
                    ? "Žiadne kritické zistenia neboli detegované."
                    : "Pre tento prípad zatiaľ nie sú evidované žiadne zistenia."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/40 p-1">
              {filteredAlerts.map((alert: { id: string; title: string; detail: string; severity: Severity; source: string }) => {
                const isReviewed = state.reviewed.includes(alert.id);
                return (
                  <div
                    key={alert.id}
                    onClick={() => handleToggleSingle(alert.id, alert.title)}
                    className={cn(
                      "group relative flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 transition-colors hover:bg-surface-2/80",
                      !isReviewed && "bg-surface/50",
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      {alert.severity === "critical" ? (
                        <ShieldAlert className="h-4 w-4 text-risk-high" />
                      ) : alert.severity === "high" ? (
                        <AlertTriangle className="h-4 w-4 text-risk-medium" />
                      ) : (
                        <Info className="h-4 w-4 text-primary" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                            alert.severity === "critical"
                              ? "bg-risk-high/15 text-risk-high"
                              : alert.severity === "high"
                                ? "bg-risk-medium/15 text-risk-medium"
                                : "bg-muted text-muted-foreground",
                          )}
                        >
                          {severityLabel[alert.severity]}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          • {alert.source}
                        </span>
                        {!isReviewed && (
                          <span
                            className="ml-auto h-2 w-2 shrink-0 rounded-full bg-risk-high"
                            title="Nové zistenie"
                          />
                        )}
                      </div>

                      <p
                        className={cn(
                          "mt-1 text-xs font-semibold leading-snug text-foreground",
                          isReviewed && "opacity-75 font-medium",
                        )}
                      >
                        {alert.title}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">
                        {alert.detail}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-border/60 p-2 bg-surface/30">
          <Link
            href="/forza/prehlad"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 w-full rounded-xl py-2 text-xs font-semibold text-foreground/90 hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <span>Otvoriť kompletný prehľad prípadu</span>
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
