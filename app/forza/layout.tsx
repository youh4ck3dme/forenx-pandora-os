"use client";

import { ReactNode, Suspense, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveCaseProvider } from "@/lib/hooks/useActiveCase";
import { CaseStoreProvider } from "@/lib/hooks/useCaseStore";

export default function ForzaLayout({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ActiveCaseProvider>
        <CaseStoreProvider>
          <div className="min-h-dvh bg-background text-foreground">
            <Suspense fallback={<div className="min-h-dvh bg-background" />}>
              {children}
            </Suspense>
          </div>
        </CaseStoreProvider>
      </ActiveCaseProvider>
    </QueryClientProvider>
  );
}
