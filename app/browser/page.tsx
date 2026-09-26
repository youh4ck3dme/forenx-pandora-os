import { Suspense } from "react"
import { BrowserClient } from "@/components/features/browser/browser-client"
import { ErrorBoundary } from "@/components/ui/error-boundary"

export default function BrowserPage() {
  return (
    <Suspense fallback={null}>
      <ErrorBoundary name="Browser Core">
        <BrowserClient />
      </ErrorBoundary>
    </Suspense>
  )
}
