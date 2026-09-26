"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  Lock,
  Star,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  X,
  BookOpen,
  Brain,
  Sparkles,
  Command,
  Settings,
  History,
  Download,
  Smartphone,
  Camera,
  FolderKanban,
  Bot,
  Inbox,
  Network,
  MoreHorizontal,
} from "lucide-react";
import { useBrowserStore } from "@/lib/store";
import { PrivacyShield } from "./privacy-shield";
import { cn } from "@/lib/utils";
import { isBookmarked, saveBookmark, saveHistory } from "@/lib/storage";
import { config } from "@/lib/config";
import { isElectron } from "@/lib/api";
import { useBrowserActions } from "@/lib/hooks";
import { SearchService, Suggestion } from "@/lib/services";
import { openCommandPalette } from "@/components/malte/CommandPalette";

export function Omnibox() {
  const {
    activeTabId,
    tabs,
    history,
    bookmarks,
    updateTab,
    toggleCopilot,
    copilotOpen,
    sidebarOpen,
    toggleSidebar,
    toggleCommandPalette,
    openSidebarPanel,
  } = useBrowserStore();
  const { navigateTo, reload, goBack, goForward, addTab, closeCurrentTab } =
    useBrowserActions();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const isLoading = activeTab?.isLoading || false;

  const [input, setInput] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const searchServiceRef = useRef<SearchService | null>(null);

  // Close more menu on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    if (moreMenuOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [moreMenuOpen]);

  // Initialize Search Service
  useEffect(() => {
    searchServiceRef.current = new SearchService(history, bookmarks);
  }, []);

  // Update Search Service Data
  useEffect(() => {
    if (searchServiceRef.current) {
      searchServiceRef.current.updateData(history, bookmarks);
    }
  }, [history, bookmarks]);

  // Sync input with active tab URL (unless focused)
  useEffect(() => {
    if (!isFocused && activeTab?.url) {
      // Don't show pandora://newtab
      setInput(activeTab.url === "pandora://newtab" ? "" : activeTab.url);
    }
  }, [activeTab?.url, isFocused]);

  // --- Search Logic ---
  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      if (searchServiceRef.current) {
        const results = await searchServiceRef.current.getSuggestions(input);

        // Add "Search Google" if looking like a query and not only commands
        const isCommand = input.startsWith("/");
        if (
          !isCommand &&
          !input.includes("://") &&
          !input.startsWith("localhost")
        ) {
          // Check if already in results
          const hasGoogle = results.some((r) => r.id === "search-google");
          if (!hasGoogle) {
            results.push({
              id: "search-google",
              title: `Search Google for "${input}"`,
              url: `${config.browser.defaultSearchEngine}${encodeURIComponent(
                input,
              )}`,
              type: "search",
            });
          }
        }
        setSuggestions(results);
        setSelectedIndex(0);
      }
    };

    const timer = setTimeout(fetchSuggestions, 200); // 200ms Debounce
    return () => clearTimeout(timer);
  }, [input]);

  // --- Handlers ---

  const handleExecute = (suggestion: Suggestion) => {
    if (suggestion.type === "command") {
      // Execute Command
      switch (suggestion.url) {
        case "/new":
          addTab();
          break;
        case "/close":
          closeCurrentTab();
          break;
        case "/history":
          openSidebarPanel("history");
          break;
        case "/downloads":
          openSidebarPanel("downloads");
          break;
        case "/settings":
          openSidebarPanel("settings");
          break;
        case "/mobile":
          alert("Mobile share not implemented yet (QR Code)");
          break;
      }
      // Clear special command input
      setInput("");
    } else {
      // Navigate
      navigateTo(suggestion.url);
    }

    setIsFocused(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (suggestions.length > 0) {
        handleExecute(suggestions[selectedIndex]);
      } else {
        // Direct navigation
        navigateTo(input);
        setIsFocused(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "Escape") {
      setIsFocused(false);
      inputRef.current?.blur();
      // Reset to current URL
      setInput(
        activeTab?.url === "pandora://newtab" ? "" : activeTab?.url || "",
      );
    }
  };

  const toggleBookmark = () => {
    if (!activeTab?.url || activeTab.url === "pandora://newtab") return;
    saveBookmark({
      id: Date.now().toString(),
      title: activeTab.title || activeTab.url,
      url: activeTab.url,
      createdAt: Date.now(),
    });
  };

  const isSecure = activeTab?.url.startsWith("https://");

  return (
    <div className="bg-[#05050a]/95 backdrop-blur-3xl border-t border-white/10 px-3 py-2 z-50 relative shadow-[0_-10px_40px_rgba(0,0,0,0.6)]">
      {/* 2-tier unified Forendo omnibox container matching ASCII mockup */}
      <div
        className={cn(
          "max-w-4xl mx-auto w-full bg-[#0d0d18]/90 border rounded-2xl overflow-hidden shadow-[0_4px_30px_rgba(0,0,0,0.5)] transition-all duration-200 relative",
          isFocused
            ? "border-amber-500/50 ring-2 ring-amber-500/20 shadow-[0_0_25px_rgba(245,158,11,0.15)]"
            : "border-white/15 hover:border-white/20 hover:bg-[#10101c]/95"
        )}
      >
        {/* Progress Bar along the very top border */}
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-transparent overflow-hidden z-20">
            <div className="h-full bg-linear-to-r from-amber-500 via-purple-500 to-blue-500 animate-progress-indeterminate" />
          </div>
        )}

        {/* Row 1: 🔍  Hľadať v spise, subjektoch, IČO... (Ctrl+K)    ✨   ⚙️ */}
        <div className="flex items-center h-10 px-3.5 gap-2.5 relative">
          {/* Privacy Shield / Search Icon */}
          <div className="flex items-center shrink-0">
            <PrivacyShield url={activeTab?.url || ""} isLoading={isLoading}>
              {isSecure ? (
                <Lock
                  size={14}
                  className="text-emerald-400 drop-shadow-[0_0_5px_rgba(52,211,153,0.5)] shrink-0"
                />
              ) : (
                <Search size={14} className="text-amber-400/90 shrink-0" />
              )}
            </PrivacyShield>
          </div>

          {/* Search Input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setTimeout(() => setIsFocused(false), 200)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-xs text-gray-100 placeholder:text-gray-400 outline-none font-medium tracking-tight selection:bg-amber-500/30 min-w-0"
            placeholder="Hľadať v spise, subjektoch, IČO... (Ctrl+K)"
          />

          {/* Clear Button */}
          {input && (
            <button
              onClick={() => {
                setInput("");
                inputRef.current?.focus();
              }}
              className="p-1 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-colors"
            >
              <X size={12} />
            </button>
          )}

          {/* Ctrl+K Trigger */}
          <button
            type="button"
            onClick={() => {
              toggleCommandPalette(true);
              openCommandPalette();
            }}
            className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[9px] font-mono text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Otvoriť Command Palette (Ctrl+K)"
          >
            Ctrl+K
          </button>

          <div className="h-4 w-px bg-white/10 mx-0.5 hidden sm:block" />

          {/* Right Actions: ✨ Copilot & ⚙️ Settings / Sidebar */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={toggleCopilot}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 text-xs font-semibold border",
                copilotOpen
                  ? "bg-purple-500/25 text-purple-200 border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.35)]"
                  : "text-purple-400 bg-white/5 border-white/5 hover:bg-purple-500/10 hover:border-purple-500/25 hover:text-purple-300"
              )}
              title="PANDORA Copilot pre Forendo"
            >
              <span className="text-sm">✨</span>
              <span className="hidden md:inline text-[11px] font-medium text-purple-200">Copilot</span>
            </button>

            <button
              onClick={() => {
                if (!sidebarOpen) {
                  openSidebarPanel("bookmarks");
                } else {
                  toggleSidebar();
                }
              }}
              className={cn(
                "p-1.5 px-2 rounded-lg transition-all flex items-center justify-center border",
                sidebarOpen
                  ? "bg-amber-500/25 text-amber-200 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.35)]"
                  : "text-gray-400 bg-white/5 border-white/5 hover:bg-white/10 hover:text-white"
              )}
              title="Nastavenia a Bočný panel Forendo"
            >
              <span className="text-sm">⚙️</span>
            </button>
          </div>
        </div>

        {/* Divider ├────────────┬────────────┬─────────────┬────────────┬─────────┤ */}
        <div className="h-px bg-white/10 w-full" />

        {/* Row 2: 5 Forendo Modules (📁 Spisy │ 🤖 Autopilot │ 📥 Sandbox │ 🕸️ Sieť │ 🟣 Viac) */}
        <div className="grid grid-cols-5 divide-x divide-white/10 bg-white/2">
          {[
            { id: "pripady", label: "Spisy", emoji: "📁", url: "/forza/pripady" },
            { id: "autopilot", label: "Autopilot", emoji: "🤖", url: "/forza/asistent" },
            { id: "sandbox", label: "Sandbox", emoji: "📥", url: "/forza/sandbox" },
            { id: "siet", label: "Sieť", emoji: "🕸️", url: "/forza/siet" },
            { id: "viac", label: "Viac", emoji: "🟣", isMore: true },
          ].map((item) => {
            const isActive =
              !item.isMore &&
              (activeTab?.url?.includes(item.url || "") ||
                activeTab?.title === item.label);
            return (
              <button
                key={item.id}
                onClick={() => {
                  if (item.isMore) {
                    setMoreMenuOpen((v) => !v);
                    return;
                  }
                  setMoreMenuOpen(false);
                  openSidebarPanel("bookmarks");
                  const fullUrl =
                    typeof window !== "undefined"
                      ? `${window.location.origin}${item.url}`
                      : item.url || "";
                  if (activeTabId) {
                    updateTab(activeTabId, {
                      url: fullUrl,
                      title: item.label,
                      isLoading: false,
                    });
                  } else {
                    addTab(fullUrl, item.label);
                  }
                }}
                className={cn(
                  "h-9 px-2 flex items-center justify-center gap-1.5 transition-all text-xs font-semibold select-none group relative",
                  isActive
                    ? "bg-amber-500/15 text-amber-200 shadow-inner"
                    : item.isMore && moreMenuOpen
                    ? "bg-purple-500/15 text-purple-200 shadow-inner"
                    : "text-gray-300 hover:text-white hover:bg-white/5"
                )}
              >
                <span className="text-sm shrink-0 transition-transform group-hover:scale-110">
                  {item.emoji}
                </span>
                <span className="truncate">{item.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-linear-to-r from-amber-400 to-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                )}
                {item.isMore && moreMenuOpen && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-linear-to-r from-purple-400 to-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.6)]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 🟣 Viac Popover Menu */}
      {moreMenuOpen && (
        <div
          ref={moreMenuRef}
          className="absolute bottom-[calc(100%+8px)] right-4 max-w-sm w-64 bg-[#0d0d18]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] p-1.5 z-60 animate-in fade-in slide-in-from-bottom-2 duration-150"
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider border-b border-white/5 flex items-center justify-between">
            <span>Forenzné moduly</span>
            <span className="text-purple-400 text-xs">🟣</span>
          </div>
          <div className="py-1 space-y-0.5">
            {[
              { label: "Zistenia a hypotézy", emoji: "📊", url: "/forza/zistenia" },
              { label: "Subjekty a prepojenia", emoji: "👥", url: "/forza/vztahy" },
              { label: "Forenzné nastavenia", emoji: "⚙️", url: "/forza/nastavenia" },
              { label: "Profil vyšetrovateľa", emoji: "👤", url: "/forza/profil" },
            ].map((subItem) => (
              <button
                key={subItem.url}
                onClick={() => {
                  setMoreMenuOpen(false);
                  openSidebarPanel("bookmarks");
                  const fullUrl = `${window.location.origin}${subItem.url}`;
                  if (activeTabId) {
                    updateTab(activeTabId, {
                      url: fullUrl,
                      title: subItem.label,
                      isLoading: false,
                    });
                  }
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/10 transition-colors text-left font-medium"
              >
                <span className="text-sm">{subItem.emoji}</span>
                <span className="truncate">{subItem.label}</span>
              </button>
            ))}
            <div className="h-px bg-white/5 my-1" />
            <button
              onClick={() => {
                setMoreMenuOpen(false);
                openSidebarPanel("bookmarks");
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 transition-colors text-left font-medium"
            >
              <span className="text-sm">📑</span>
              <span className="truncate">Otvoriť bočný panel Forendo</span>
            </button>
          </div>
        </div>
      )}

      {/* Suggestions Dropdown (Bottom Sheet Style) */}
      {isFocused && suggestions.length > 0 && (
        <div className="absolute bottom-[calc(100%+12px)] left-2 right-2 bg-[#0a0a0f]/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden z-100 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="max-h-100 overflow-y-auto py-2 custom-scrollbar">
            {suggestions.map((item, index) => {
              const IconComp = item.icon;
              return (
                <div
                  key={item.id + index}
                  onMouseDown={(e) => e.preventDefault()} // Prevent blur on click
                  onClick={() => handleExecute(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 cursor-pointer transition-all border-l-2 border-transparent",
                    index === selectedIndex
                      ? "bg-white/5 border-blue-500"
                      : "hover:bg-white/5",
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      item.type === "command"
                        ? "bg-purple-500/10 text-purple-400"
                        : item.type === "bookmark"
                          ? "bg-yellow-500/10 text-yellow-400"
                          : item.type === "search"
                            ? "bg-blue-500/10 text-blue-400"
                            : "bg-white/5 text-gray-400",
                    )}
                  >
                    {IconComp ? (
                      <IconComp size={16} />
                    ) : item.type === "bookmark" ? (
                      <Star size={16} />
                    ) : item.type === "history" ? (
                      <History size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-gray-200 truncate flex items-center gap-2">
                      {item.title}
                      {item.type === "command" && (
                        <span className="text-[8px] bg-white/10 px-1.5 py-0.5 rounded text-gray-400 uppercase tracking-wilder">
                          CMD
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-gray-500 truncate font-mono">
                      {item.description || item.url}
                    </div>
                  </div>
                  {index === selectedIndex && (
                    <span className="text-xs text-gray-500 pr-2">↵ Enter</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="h-6 bg-black/40 border-t border-white/5 flex items-center justify-between px-4 text-[8px] text-gray-600 uppercase tracking-widest">
            <span>Arc Engine v2.0</span>
            <span>{suggestions.length} results</span>
          </div>
        </div>
      )}
    </div>
  );
}
