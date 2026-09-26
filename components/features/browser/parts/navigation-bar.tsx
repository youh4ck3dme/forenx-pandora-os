"use client";

import React from "react";
import { ChevronLeft, ChevronRight, RotateCw, X } from "lucide-react";
import { useBrowserActions } from "@/lib/hooks";
import { useBrowserStore } from "@/lib/store";

export function NavigationBar() {
  const { navigateTo, reload, goBack, goForward } = useBrowserActions();
  const { activeTabId, tabs } = useBrowserStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isLoading = activeTab?.isLoading || false;

  return (
    <div className="flex items-center gap-1.5 pl-3 pr-3 h-10 border-r border-white/5 mr-1">
       <button
          onClick={goBack}
          className="p-1.5 hover:bg-white/10 rounded-md text-gray-500 hover:text-white transition-all active:scale-95"
          title="Go Back"
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
        <button
          onClick={goForward}
          className="p-1.5 hover:bg-white/10 rounded-md text-gray-500 hover:text-white transition-all active:scale-95"
          title="Go Forward"
        >
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
        <button
          onClick={() => (isLoading ? stop() : reload())}
          className="p-1.5 hover:bg-white/10 rounded-md text-gray-500 hover:text-white transition-all active:scale-95 ml-1"
          title={isLoading ? "Stop loading" : "Reload page"}
        >
          {isLoading ? (
            <X size={14} strokeWidth={2.5} className="animate-spin-slow" />
          ) : (
            <RotateCw size={14} strokeWidth={2.5} />
          )}
        </button>
    </div>
  );
}
