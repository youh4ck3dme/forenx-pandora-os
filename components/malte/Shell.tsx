"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, WifiOff, Globe } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  CommandPalette,
  CommandPaletteTrigger,
} from "@/components/malte/CommandPalette";
import { ThemeToggle } from "@/components/malte/ThemeToggle";
import { NotificationsBell } from "@/components/malte/NotificationsBell";
import { AccountMenu } from "@/components/malte/AccountMenu";
import { navItems, navGroups } from "@/components/malte/nav";
import { severityLabel } from "@/lib/forza/forensic";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { BRAND } from "@/config/brand";
import {
  OFFLINE_AI_MESSAGE,
  useOnlineStatus,
} from "@/lib/hooks/useOnlineStatus";

function DesktopSidebar() {
  const pathname = usePathname();
  const { activeCase, analysis } = useActiveCase();
  const shellAnalysis = analysis;
  const criticalCount = analysis.alerts.filter(
    (a: { severity: string }) => a.severity === "critical",
  ).length;

  const [isEmbedded, setIsEmbedded] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsEmbedded(window.self !== window.top);
    }
  }, []);

  if (isEmbedded) return null;

  return (
    <aside className="forensic-sidebar sticky top-0 hidden h-dvh w-[288px] shrink-0 flex-col border-r border-border surface-glass px-4 py-6 lg:flex">
      <div className="flex items-center gap-2 px-2">
        <Image
          src="/branding/forenx-icon-256.png"
          alt={`${BRAND.name}`}
          width={30}
          height={30}
          className="brand-logo h-7 w-7"
          aria-hidden
        />
        <span className="text-lg font-extrabold tracking-tight">
          {BRAND.name}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <NotificationsBell />
        </span>
      </div>

      {/* Quick link to PΛND0RΛ Browser */}
      <div className="mt-3">
        <Link
          href="/browser"
          className="flex items-center justify-between w-full px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 hover:border-blue-500/40 text-blue-300 text-xs font-semibold transition-all group shadow-sm"
          title="Prejsť späť do PΛND0RΛ Browser"
        >
          <span className="flex items-center gap-2">
            <Globe
              size={14}
              className="text-blue-400 group-hover:rotate-12 transition-transform"
            />
            <span>PΛND0RΛ Browser</span>
          </span>
          <span className="text-[10px] text-blue-400/70 font-mono">
            Prejsť →
          </span>
        </Link>
      </div>

      <div className="mt-4 rounded-lg liquid-glass-header p-4 text-header-foreground shadow-glow">
        <p className="text-[10px] tracking-wide uppercase font-semibold text-primary">
          Prebiehajúci prípad
        </p>
        <p className="mt-1 text-sm font-bold text-header-foreground">
          {activeCase.name}
        </p>
        <div className="mt-3 flex items-end justify-between">
          <span className="text-xs font-semibold text-muted-foreground">
            {severityLabel[shellAnalysis.caseLevel].toUpperCase()}
          </span>
          <span className="text-sm font-bold tnum text-header-foreground">
            {shellAnalysis.caseScore}
            <span className="text-muted-foreground">/100</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-risk-medium shadow-xs transition-[width] duration-700"
            style={{ width: `${shellAnalysis.caseScore}%` }}
          />
        </div>
      </div>

      <div className="mt-5">
        <CommandPaletteTrigger />
      </div>

      <nav className="mt-5 flex-1 space-y-1 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.title} className="pb-2">
            <p className="px-3 pt-4 pb-1 text-[11px] font-extrabold uppercase tracking-wider text-zinc-300">
              {group.title}
            </p>
            {group.items.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                href={to}
                prefetch={true}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white",
                  pathname === to &&
                    "bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30 shadow-xs",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    pathname === to ? "text-amber-400" : "text-zinc-300",
                  )}
                  aria-hidden
                />
                {label}
                {to === "/forza/prehlad" && criticalCount > 0 ? (
                  <span className="ml-auto rounded-full bg-red-500/25 border border-red-500/50 px-1.5 text-[10px] font-black text-red-200 tnum">
                    {criticalCount}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <p className="px-3 pt-4 text-xs font-medium text-zinc-400">
        {BRAND.name} v1.0 • vaše prípady sú súkromné
      </p>
    </aside>
  );
}

/** Responzívny shell: telefónny rám na mobile, pracovná plocha na desktope. */
export function PhoneFrame({ children }: { children?: ReactNode }) {
  return (
    <div className="ambient-shell relative z-1 min-h-dvh overflow-x-clip lg:flex">
      <DesktopSidebar />
      <div className="flex min-w-0 flex-1 justify-center py-0 sm:px-4 sm:py-10 lg:px-6 lg:py-8">
        <div className="ambient-stage w-full min-w-0 max-w-[min(100%,560px)] sm:overflow-clip sm:rounded-[2.5rem] sm:border sm:border-border sm:shadow-elevated lg:max-w-[min(100%,1180px)] lg:rounded-3xl xl:max-w-[min(100%,1320px)] 2xl:max-w-[min(100%,1480px)]">
          <div className="relative flex min-h-dvh flex-col sm:min-h-215 lg:min-h-[calc(100dvh-4rem)]">
            <OfflineBanner />
            {children}
          </div>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}

function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="z-50 flex items-start gap-2 border-b border-risk-medium/30 bg-risk-medium/15 px-4 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2 text-xs font-medium leading-relaxed text-risk-medium"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{OFFLINE_AI_MESSAGE}</span>
    </div>
  );
}

export function AppHeader({
  title,
  brand,
  actions,
  back,
  children,
}: {
  title: string;
  brand?: boolean;
  actions?: ReactNode;
  back?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="relative z-20 text-header-foreground">
      <div className="liquid-glass-header sticky top-0 z-20 rounded-b-(--forenx-control-radius) pt-[env(safe-area-inset-top)]">
        <div className="relative z-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 pt-3 pb-3 lg:pt-4">
          <div className="flex shrink-0 items-center gap-2">
            {back ? (
              <button
                type="button"
                onClick={() => window.history.back()}
                aria-label="Späť"
                className="flex h-8 w-8 items-center justify-center rounded-full text-header-foreground/90 transition-colors hover:bg-accent hover:text-header-foreground"
              >
                <ChevronLeft className="h-5 w-5 opacity-90" aria-hidden />
              </button>
            ) : null}
            {brand ? (
              <Image
                src="/branding/forenx-icon-256.png"
                alt={`${BRAND.name}`}
                width={28}
                height={28}
                className="brand-logo h-7 w-7 lg:hidden"
              />
            ) : null}
          </div>
          <h1 className="min-w-0 truncate font-welcome-heading text-base font-semibold text-header-foreground lg:text-xl">
            {title}
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <span className="lg:hidden">
              <ThemeToggle />
            </span>
            {actions ?? (
              <span className="lg:hidden">
                <NotificationsBell />
              </span>
            )}
            <AccountMenu />
          </div>
        </div>
      </div>
      {children ? (
        <div className="liquid-glass-header pb-4 pt-3">{children}</div>
      ) : null}
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { analysis } = useActiveCase();
  const criticalCount = analysis.alerts.filter(
    (a: { severity: string }) => a.severity === "critical",
  ).length;

  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setIsEmbedded(window.self !== window.top);
    }
  }, []);

  // When embedded in Pandora Browser, hide internal bottom navigation
  // because Pandora Browser's Omnibox is already the master bottom menu!
  if (isEmbedded) return null;

  return (
    <nav
      aria-label="Spodná navigácia"
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-40 w-full max-w-[min(100%,560px)] border-t border-border/80 surface-glass backdrop-blur-xl bg-card/85 dark:bg-card/90 shadow-elevated px-2 pt-2.5 pb-[max(1.25rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      <ul className="flex items-stretch justify-between">
        {navItems.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <Link
              href={to}
              prefetch={true}
              className={cn(
                "group relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground",
                pathname === to && "text-foreground! font-semibold",
              )}
            >
              <span className="relative">
                <Icon
                  className="h-5 w-5 transition-transform duration-200 group-active:scale-90"
                  aria-hidden
                />
                {to === "/forza/vztahy" && criticalCount > 0 ? (
                  <span className="absolute -top-1 -right-2 rounded-full bg-risk-high px-1 text-[9px] font-bold text-risk-high-foreground tnum">
                    {criticalCount}
                  </span>
                ) : null}
              </span>
              {label}
              <span
                data-ind
                className={cn(
                  "absolute -top-2.5 h-1 w-8 rounded-full bg-foreground transition-opacity duration-300",
                  pathname === to ? "opacity-100" : "opacity-0",
                )}
              />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Screen({ children }: { children?: ReactNode }) {
  return (
    <main className="stagger-children relative min-w-0 flex-1 space-y-4 overflow-x-clip px-4 pt-4 pb-24 sm:px-5 sm:pb-28 lg:px-8 lg:py-6">
      {children}
    </main>
  );
}

export function Card({
  children,
  className,
  onClick,
  id,
  ...rest
}: {
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
  id?: string;
  key?: React.Key;
  [k: string]: any;
}) {
  return (
    <section
      id={id}
      {...rest}
      className={cn(
        "rounded-xl border border-white/20 bg-black/85 backdrop-blur-md liquid-glass-card p-4 shadow-card transition-all duration-200 text-white",
        onClick &&
          "cursor-pointer hover:shadow-elevated hover:border-primary/40",
        className,
      )}
      {...(onClick
        ? {
            onClick,
            role: "button",
            tabIndex: 0,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            },
          }
        : {})}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  action,
  className,
}: {
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-center justify-between px-1 pt-1", className)}
    >
      <h2 className="text-sm font-semibold tracking-tight text-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

export function RiskChip({
  level = "muted",
  children,
}: {
  level?: "critical" | "high" | "medium" | "low" | "muted";
  children: ReactNode;
}) {
  const styles = {
    critical: "bg-risk-high text-risk-high-foreground",
    high: "bg-risk-high/12 text-risk-high",
    medium: "bg-risk-medium/15 text-risk-medium",
    low: "bg-risk-low/15 text-risk-low",
    muted: "bg-foreground/15 text-foreground",
  }[level];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap",
        styles,
      )}
    >
      {children}
    </span>
  );
}
