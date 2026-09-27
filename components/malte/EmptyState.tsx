import type { LucideIcon } from "lucide-react";
import { SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState({
  icon: Icon = SearchX,
  title,
  detail,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-10 text-center shadow-2xs">
      <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-foreground tracking-tight">
        {title}
      </p>
      {detail ? (
        <p className="max-w-[42ch] text-xs text-muted-foreground leading-relaxed">
          {detail}
        </p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

export function ForzaModuleSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Načítavam obsah prípadu">
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <span className="sr-only">Načítavam obsah prípadu…</span>
    </div>
  );
}
