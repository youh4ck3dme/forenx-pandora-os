import { Suspense } from "react";
import { BrowserViewWrapper } from "@/components/features/browser/browser-view-wrapper";

export const dynamic = "force-dynamic";

export default function BrowserPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-black" />}>
      <BrowserViewWrapper />
    </Suspense>
  );
}
