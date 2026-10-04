"use client";

import { ReactNode, Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveCaseProvider } from "@/lib/hooks/useActiveCase";
import { CaseStoreProvider } from "@/lib/hooks/useCaseStore";

/** Skeleton matches the Shell layout so there's no layout shift during navigation. */
function ShellSkeleton() {
  return (
    <div className="min-h-dvh bg-background animate-pulse">
      <div className="h-14 border-b border-border bg-card/50" />
      <div className="px-4 pt-6 space-y-4 max-w-2xl mx-auto">
        <div className="h-6 w-48 rounded-lg bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
        <div className="h-28 rounded-xl bg-muted" />
      </div>
    </div>
  );
}

export default function ForzaLayout({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 60 * 1000,   // 5 min — keeps data fresh across section switches
            gcTime: 10 * 60 * 1000,     // 10 min — keep unused cache in memory
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ActiveCaseProvider>
        <CaseStoreProvider>
          <div className="min-h-dvh bg-background text-foreground">
            <Suspense fallback={<ShellSkeleton />}>
              {children}
            </Suspense>
          </div>
        </CaseStoreProvider>
      </ActiveCaseProvider>
    </QueryClientProvider>
  );
}
