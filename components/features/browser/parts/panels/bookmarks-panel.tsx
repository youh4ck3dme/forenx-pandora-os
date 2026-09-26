"use client";

import Image from "next/image";
import {
  Globe,
  Trash2,
  Upload,
  Download,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Bookmark as BookmarkIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Bookmark } from "@/lib/storage";
import { useState, useEffect, useRef } from "react";
import { useBrowserStore } from "@/lib/store";
import { motion, AnimatePresence } from "framer-motion";
import { List } from "react-window";
import { AutoSizer } from "react-virtualized-auto-sizer";
import { cn } from "@/lib/utils";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { severityLabel } from "@/lib/forza/forensic";
import { navGroups } from "@/components/malte/nav";
import { ThemeToggle } from "@/components/malte/ThemeToggle";
import { NotificationsBell } from "@/components/malte/NotificationsBell";
import { openCommandPalette } from "@/components/malte/CommandPalette";
import { BRAND } from "@/config/brand";

export function BookmarksPanel() {
  const {
    bookmarks,
    deleteBookmark,
    loadBookmarks,
    updateTab,
    addTab,
    activeTabId,
    tabs,
    bookmarksLoaded,
    exportBookmarks,
    importBookmarks,
    toggleCommandPalette,
  } = useBrowserStore();

  const { activeCase, analysis } = useActiveCase();
  const [showBookmarksList, setShowBookmarksList] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const currentTabUrl = activeTab?.url || "";

  const handleNavigate = (url: string, title?: string) => {
    const fullUrl = url.startsWith("http")
      ? url
      : typeof window !== "undefined"
      ? `${window.location.origin}${url}`
      : url;

    if (activeTabId) {
      updateTab(activeTabId, {
        url: fullUrl,
        title: title || "Forendo",
        isLoading: true,
      });
    } else {
      addTab({
        id: Date.now().toString(),
        title: title || "Forendo",
        url: fullUrl,
        lastAccessed: Date.now(),
        spaceId: "default",
      });
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportBookmarks();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pandora-bookmarks-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed:", e);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      await importBookmarks(text);
    } catch (e) {
      console.error("Import failed:", e);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const Row = ({ index, style, ariaAttributes }: any) => {
    const bookmark = bookmarks[index];
    return (
      <div style={style} {...ariaAttributes} className="px-1">
        <div
          className="group flex items-center gap-2 p-2 rounded-lg hover:bg-foreground/5 cursor-pointer h-full"
          onClick={() => handleNavigate(bookmark.url, bookmark.title)}
        >
          <div className="w-8 h-8 rounded bg-foreground/5 flex items-center justify-center shrink-0">
            {bookmark.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bookmark.favicon}
                alt=""
                className="w-4 h-4"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            ) : (
              <Globe className="w-4 h-4 text-foreground/40" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate font-medium">
              {bookmark.title}
            </p>
            <p className="text-xs text-foreground/40 truncate font-mono">
              {new URL(bookmark.url).hostname}
            </p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              deleteBookmark(bookmark.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/10 hover:text-red-400 rounded transition-all"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  const criticalCount = analysis?.alerts
    ? analysis.alerts.filter((a: { severity: string }) => a.severity === "critical").length
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex-1 flex flex-col h-full min-h-0 bg-transparent text-white select-none"
    >
      {/* 1. Header: Logo ForenX + Téma + Notifikácie */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-white/5">
        <Image
          src="/branding/forenx-icon-256.png"
          alt={BRAND.name}
          width={24}
          height={24}
          className="brand-logo h-6 w-6 rounded-md shadow-xs shrink-0"
        />
        <span className="text-sm font-black tracking-tight uppercase bg-clip-text text-transparent bg-linear-to-r from-white via-white/90 to-amber-200">
          {BRAND.name}
        </span>
        <span className="ml-auto flex items-center gap-1.5 scale-90 origin-right">
          <ThemeToggle />
          <NotificationsBell />
        </span>
      </div>

      {/* 2. Prebiehajúci prípad Card */}
      <div className="mx-3 mt-3 rounded-xl border border-white/10 bg-white/4 backdrop-blur-md p-3 text-white shadow-lg relative overflow-hidden">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
          <span>Prebiehajúci prípad</span>
          <span className="text-white/40 font-mono text-[9px]">
            {activeCase?.id ? activeCase.id.slice(0, 8) : "ŽIADNY"}
          </span>
        </div>
        <p className="mt-1 text-sm font-bold text-white truncate">
          {activeCase?.name || "Žiadny prípad"}
        </p>
        <div className="mt-2.5 flex items-end justify-between">
          <span className="text-[11px] font-semibold text-gray-400">
            {(severityLabel[analysis?.caseLevel || "low"] || "NÍZKE").toUpperCase()}
          </span>
          <span className="text-xs font-bold font-mono text-white">
            {analysis?.caseScore ?? 0}
            <span className="text-gray-500">/100</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              (analysis?.caseScore ?? 0) > 70
                ? "bg-red-500"
                : (analysis?.caseScore ?? 0) > 30
                ? "bg-amber-500"
                : "bg-emerald-500"
            )}
            style={{ width: `${Math.max(4, analysis?.caseScore ?? 0)}%` }}
          />
        </div>
      </div>

      {/* 3. Vyhľadávanie v prípade (Cmd+K) */}
      <div className="px-3 mt-3">
        <button
          type="button"
          onClick={() => {
            toggleCommandPalette(true);
            openCommandPalette();
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/3 px-3 py-2 text-xs text-gray-400 transition-all hover:bg-white/8 hover:text-white hover:border-white/20"
        >
          <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
          <span className="truncate">Hľadať v prípade…</span>
          <kbd className="ml-auto rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400 font-mono">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* 4. Navigačné sekcie: Prípad, Zistenia, Účet */}
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3 no-scrollbar mt-1">
        {navGroups.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {group.title}
            </p>
            {group.items.map(({ to, label, icon: Icon }) => {
              const isActive = currentTabUrl.includes(to);
              return (
                <button
                  key={to}
                  onClick={() => handleNavigate(to, label)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all group text-left",
                    isActive
                      ? "bg-amber-500/15 text-amber-300 font-semibold border border-amber-500/25 shadow-xs"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110",
                      isActive
                        ? "text-amber-400"
                        : "text-gray-500 group-hover:text-gray-300"
                    )}
                  />
                  <span className="truncate">{label}</span>
                  {to === "/forza/prehlad" && criticalCount > 0 && (
                    <span className="ml-auto rounded-full bg-red-500/20 border border-red-500/40 px-1.5 py-0.2 text-[9px] font-bold text-red-300 font-mono">
                      {criticalCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {/* 5. Sekundárne zbaliteľné Záložky prehliadača */}
        <div className="pt-2 border-t border-white/5">
          <button
            onClick={() => setShowBookmarksList(!showBookmarksList)}
            className="flex items-center justify-between w-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <BookmarkIcon size={11} className="text-gray-500" />
              <span>Záložky prehliadača ({bookmarks.length})</span>
            </span>
            {showBookmarksList ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>

          <AnimatePresence>
            {showBookmarksList && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-2 pt-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".json"
                    className="hidden"
                  />
                  <button
                    onClick={handleImportClick}
                    disabled={isImporting}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[10px] font-medium rounded transition-colors"
                  >
                    {isImporting ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Upload size={10} />
                    )}
                    Import
                  </button>
                  <button
                    onClick={handleExport}
                    className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[10px] font-medium rounded transition-colors"
                  >
                    <Download size={10} />
                    Export
                  </button>
                </div>

                {bookmarks.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto space-y-1 no-scrollbar">
                    {bookmarks.map((bm) => (
                      <div
                        key={bm.id}
                        onClick={() => handleNavigate(bm.url, bm.title)}
                        className="flex items-center justify-between p-1.5 rounded hover:bg-white/5 cursor-pointer text-xs group"
                      >
                        <span className="truncate text-gray-300 group-hover:text-white">
                          {bm.title}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteBookmark(bm.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 p-0.5"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-500 text-center py-2">
                    Žiadne uložené záložky.
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      {/* 6. Footer: Avatar N + ForenX v1.0 info */}
      <div className="p-3 border-t border-white/5 bg-black/40 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-[10px] font-bold text-amber-300 shrink-0">
            N
          </div>
          <p className="text-[10px] text-gray-500 truncate">
            <span className="font-semibold text-gray-400">{BRAND.name} v1.0</span>{" "}
            • vaše prípady sú súkromné
          </p>
        </div>
      </div>
    </motion.div>
  );
}
