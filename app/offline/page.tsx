"use client";

import { RefreshCw, WifiOff } from "lucide-react";

export default function OfflinePage() {
  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div className="min-h-svh bg-black flex flex-col items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-orange-500/5" />

      <div className="relative z-10 flex flex-col items-center text-center max-w-md">
        <div className="w-20 h-20 rounded-full bg-foreground/5 border border-border flex items-center justify-center mb-6">
          <WifiOff className="w-10 h-10 text-foreground/40" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">
          Nie si pripojený k internetu
        </h1>

        <p className="text-foreground/60 mb-8">
          Skontroluj svoje internetové pripojenie a skús to znova.
        </p>

        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium hover:opacity-90 transition-opacity"
        >
          <RefreshCw className="w-4 h-4" />
          Skúsiť znova
        </button>

        <p className="text-foreground/40 text-sm mt-8">
          PΛND0RΛ Browser v2.0.0
        </p>
      </div>
    </div>
  );
}
