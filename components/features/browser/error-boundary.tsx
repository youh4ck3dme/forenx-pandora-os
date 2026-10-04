"use client"

import React from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { logger } from "@/lib/utils"

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class BrowserErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    logger.error("Browser error boundary caught error", { error, errorInfo })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-black/50">
          <div className="flex flex-col items-center text-center max-w-sm">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-500" />
            </div>

            <h2 className="text-lg font-semibold text-foreground mb-2">Táto záložka crashla</h2>

            <p className="text-foreground/60 text-sm mb-4">Nastala chyba pri načítaní obsahu.</p>

            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-4 py-2 bg-foreground/10 hover:bg-foreground/20 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Obnoviť záložku
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
