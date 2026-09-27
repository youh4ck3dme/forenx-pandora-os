"use client";

import dynamic from "next/dynamic";
import { ErrorBoundary } from "@/components/ui/error-boundary";

const BrowserClient = dynamic(
  () =>
    import("@/components/features/browser/browser-client").then(
      (mod) => mod.BrowserClient
    ),
  {
    ssr: false,
    loading: () => <div className="h-screen w-screen bg-black" />,
  }
);

const Leva = dynamic(() => import("leva").then((mod) => mod.Leva), {
  ssr: false,
});

export function BrowserViewWrapper({
  withLeva = false,
}: {
  withLeva?: boolean;
}) {
  return (
    <ErrorBoundary name="Browser Core">
      <BrowserClient />
      {withLeva && <Leva hidden />}
    </ErrorBoundary>
  );
}
