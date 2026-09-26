"use client";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ActiveCaseProvider } from "@/lib/hooks/useActiveCase";
import { CaseStoreProvider } from "@/lib/hooks/useCaseStore";

import { TabsManager } from "./parts/tabs-manager";
import { Omnibox } from "./parts/omnibox";
import { NavigationBar } from "./parts/navigation-bar";
import { WebView } from "./parts/web-view";
import { Sidebar } from "./parts/sidebar";
import { Copilot } from "./parts/copilot";
import { CommandPalette } from "./parts/command-palette";
import { useBrowserStore } from "@/lib/store";
import { config } from "@/lib/config";

import { useShortcuts } from "./hooks/use-shortcuts";
import { electron, isElectron } from "@/lib/api";

export function BrowserClient() {
  useShortcuts();
  /* Performance: usage of granular selectors to prevent full re-renders */
  const tabs = useBrowserStore((s) => s.tabs);
  const activeTabId = useBrowserStore((s) => s.activeTabId);
  const setActiveTab = useBrowserStore((s) => s.setActiveTab);
  const addDownload = useBrowserStore((s) => s.addDownload);
  const updateDownload = useBrowserStore((s) => s.updateDownload);
  const incrementBlockedCount = useBrowserStore((s) => s.incrementBlockedCount);

  // Verify active tab exists, if not set to first or create new
  useEffect(() => {
    if (tabs.length === 0) {
      // useBrowserStore.getState().addTab(...) - logic handled in store actions if needed,
      // but store init should handle this.
    }
    const exists = tabs.find((t) => t.id === activeTabId);
    if (!exists && tabs.length > 0) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTabId, setActiveTab]);

  // Listen for Electron tab updates
  useEffect(() => {
    // Initial Sync: Tell Electron about existing tabs from persistent storage
    if (isElectron()) {

      tabs.forEach((tab) => {
        electron.send("tab:create", { id: tab.id, url: tab.url });
      });
      if (activeTabId) {
        electron.send("tab:switch", { id: activeTabId });
      }
    }

    electron.on(
      "tab:updated",
      ({ id, title, url }: { id: string; title: string; url: string }) => {
        useBrowserStore.getState().updateTab(
          id,
          {
            title,
            url,
            isLoading: false,
          },
          true
        );
      }
    );
  }, []);

  // Listen for Electron download updates
  useEffect(() => {
    electron.on("download:start", (data: { id: string, fileName: string, url: string, totalBytes: number, startTime: number }) => {
      addDownload({
        id: data.id,
        fileName: data.fileName,
        url: data.url,
        fileSize: data.totalBytes
          ? (data.totalBytes / 1024 / 1024).toFixed(2) + " MB"
          : "Unknown",
        status: "in-progress",
        timestamp: data.startTime,
        receivedBytes: 0,
        totalBytes: data.totalBytes,
      });
    });

    electron.on("download:updated", (data: { id: string, receivedBytes: number, status: string }) => {
      updateDownload(data.id, data);
    });

    electron.on("download:completed", (data: { id: string }) => {
      updateDownload(data.id, { status: "completed" });
    });

    electron.on(
      "shield:blocked",
      (data: {
        url: string;
        category: "ads" | "trackers" | "scripts";
        stats: any;
      }) => {
        useBrowserStore.getState().updateBlockedStats(data.category);
      }
    );
  }, [addDownload, updateDownload]);

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
          <div className="min-h-svh flex flex-col bg-black overflow-hidden h-screen">
            {/* Top Bar Area: Nav + Tabs */}
            <div className="flex shrink-0 z-50 bg-[#0a0a0f] border-b border-white/5 items-end">
              <NavigationBar />
              <div className="flex-1 overflow-hidden min-w-0">
                  <TabsManager />
              </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex relative overflow-hidden">
              <Sidebar />
              <div className="flex-1 relative bg-background flex">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3 }}
                  className="flex-1 relative"
                >
                  <WebView />
                </motion.div>
                <Copilot />
              </div>
            </div>

            {/* Bottom Bar: Address Bar (Brave Style) */}
            <div className="shrink-0 z-60 bg-[#0a0a0f] border-t border-white/5 pb-safe">
              <Omnibox />
            </div>
            <CommandPalette />
          </div>
        </CaseStoreProvider>
      </ActiveCaseProvider>
    </QueryClientProvider>
  );
}
