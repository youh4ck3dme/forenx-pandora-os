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
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 bg-black/85 backdrop-blur-md px-6 py-10 text-center shadow-xl">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 shadow-inner">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-base font-bold text-white tracking-tight">
        {title}
      </p>
      {detail ? (
        <p className="max-w-[46ch] text-xs font-medium text-zinc-300 leading-relaxed">
          {detail}
        </p>
      ) : null}
      {action ? <div className="pt-3">{action}</div> : null}
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
