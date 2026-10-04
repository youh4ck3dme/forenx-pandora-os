"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { logger } from "@/lib/utils"
import { reportClientError } from "@/components/forza/ObservabilityReporter"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logger.error("Root error boundary caught error", error)
    reportClientError({
      message: `Boundary: ${error.message}`,
      stack: error.stack,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
    })
  }, [error])

  return (
    <div className="min-h-svh bg-black flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-orange-500/5" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
          <AlertTriangle className="w-10 h-10 text-red-500" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">Niečo sa pokazilo</h1>

        <p className="text-foreground/60 mb-4">Nastala neočakávaná chyba. Skús to znova alebo reštartuj aplikáciu.</p>

        {process.env.NODE_ENV === "development" && (
          <pre className="w-full p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-left text-xs text-red-400 overflow-auto mb-6 max-h-32">
            {error.message}
          </pre>
        )}

        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Skúsiť znova
        </button>

        <p className="text-foreground/40 text-sm mt-8">Error ID: {error.digest || "unknown"}</p>
      </div>
    </div>
  )
}
