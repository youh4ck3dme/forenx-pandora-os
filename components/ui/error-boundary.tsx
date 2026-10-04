"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCcw, Home } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary:${this.props.name || 'Global'}] error:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-[400px] w-full p-8 bg-black/40 backdrop-blur-md border border-red-500/20 rounded-2xl text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6">
            <AlertTriangle className="text-red-500" size={32} />
          </div>
          <h2 className="text-2xl font-black tracking-tighter text-white mb-2 uppercase">
            [SYSTEM_CRASH_DETECTED]
          </h2>
          <p className="text-gray-400 text-sm max-w-md mb-8">
            An unexpected error occurred in the <span className="text-red-400 font-mono">{this.props.name || "core module"}</span>.
            The PΛND0RΛ security layer has isolated the failure.
          </p>

          <div className="flex gap-4">
            <button
              onClick={this.handleReset}
              className="flex items-center gap-2 px-6 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
            >
              <RefreshCcw size={14} />
              Retry Protocol
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all shadow-[0_0_15px_rgba(220,38,38,0.4)]"
            >
              Hard Reboot
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <div className="mt-8 p-4 bg-black border border-white/5 rounded-lg text-left overflow-auto max-w-2xl w-full">
              <pre className="text-[10px] font-mono text-red-400/60 leading-tight">
                {this.state.error?.stack}
              </pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
