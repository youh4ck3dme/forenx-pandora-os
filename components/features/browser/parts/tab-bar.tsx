"use client";

import { X, Plus, Globe, FolderPlus, Pin, Copy, XCircle } from "lucide-react";
import { useBrowserStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import * as ContextMenu from "@radix-ui/react-context-menu";

export function TabBar() {
  const {
    tabs,
    activeTabId,
    setActiveTab,
    closeTab,
    addTab,
    duplicateTab,
    togglePinTab,
    closeOtherTabs,
  } = useBrowserStore();

  const handleCreateTab = () => {
    addTab({
      id: Date.now().toString(),
      title: "New Tab",
      url: "pandora://newtab",
      lastAccessed: Date.now(),
    });
  };

  return (
    <div className="h-10 bg-black/80 backdrop-blur-sm border-b border-border flex items-center px-2 gap-1 overflow-x-auto no-scrollbar">
      {tabs.map(
        (tab: {
          id: string;
          title?: string;
          isLoading?: boolean;
          isPinned?: boolean;
        }) => (
          <ContextMenu.Root key={tab.id}>
            <ContextMenu.Trigger>
              <div
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "group flex items-center gap-2 h-8 px-3 rounded-lg cursor-pointer transition-all select-none",
                  tab.isPinned
                    ? "w-10 justify-center px-0 shrink-0"
                    : "max-w-[200px] min-w-[120px]",
                  tab.id === activeTabId
                    ? "bg-foreground/10 border border-border"
                    : "hover:bg-foreground/5 opacity-70 hover:opacity-100",
                )}
              >
                {tab.isLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                ) : (
                  <Globe className="w-3.5 h-3.5 text-foreground/60 shrink-0" />
                )}

                {!tab.isPinned && (
                  <>
                    <span className="text-xs text-foreground/80 truncate flex-1 font-medium">
                      {tab.title || "Loading..."}
                    </span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 hover:bg-foreground/20 rounded p-0.5 transition-all text-foreground/60 hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content className="min-w-[160px] bg-background/95 backdrop-blur-md border border-border rounded-lg p-1 shadow-xl z-[100] animate-in fade-in zoom-in-95 duration-100">
                <ContextMenu.Item
                  onClick={() => closeTab(tab.id)}
                  className="flex items-center px-2 py-1.5 text-xs text-foreground/80 outline-none cursor-pointer hover:bg-foreground/10 rounded"
                >
                  <X className="w-3.5 h-3.5 mr-2 opacity-60" />
                  Close Tab
                </ContextMenu.Item>
                <ContextMenu.Item
                  onClick={() => closeOtherTabs(tab.id)}
                  className="flex items-center px-2 py-1.5 text-xs text-foreground/80 outline-none cursor-pointer hover:bg-foreground/10 rounded"
                >
                  <XCircle className="w-3.5 h-3.5 mr-2 opacity-60" />
                  Close Others
                </ContextMenu.Item>
                <ContextMenu.Separator className="h-px bg-border my-1" />
                <ContextMenu.Item
                  onClick={() => duplicateTab(tab.id)}
                  className="flex items-center px-2 py-1.5 text-xs text-foreground/80 outline-none cursor-pointer hover:bg-foreground/10 rounded"
                >
                  <Copy className="w-3.5 h-3.5 mr-2 opacity-60" />
                  Duplicate
                </ContextMenu.Item>
                <ContextMenu.Item
                  onClick={() => togglePinTab(tab.id)}
                  className="flex items-center px-2 py-1.5 text-xs text-foreground/80 outline-none cursor-pointer hover:bg-foreground/10 rounded"
                >
                  <Pin className="w-3.5 h-3.5 mr-2 opacity-60" />
                  {tab.isPinned ? "Unpin Tab" : "Pin Tab"}
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu.Root>
        ),
      )}

      <button
        onClick={handleCreateTab}
        className="h-8 w-8 flex items-center justify-center hover:bg-foreground/10 rounded-lg transition-colors text-foreground/60 hover:text-primary"
        title="New Tab"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
