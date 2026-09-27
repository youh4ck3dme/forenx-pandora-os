"use client";

import {
  Search,
  Monitor,
  Sun,
  Moon,
  ShieldCheck,
  Puzzle,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { getSettings, saveSettings, Settings } from "@/lib/storage";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { config } from "@/lib/config";
import { motion } from "framer-motion";
import { electron, isElectron } from "@/lib/api";
import { useBrowserStore } from "@/lib/store";

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(getSettings());
  const { extensions, loadExtensions, installExtension } = useBrowserStore();
  const [extPath, setExtPath] = useState("");

  useEffect(() => {
    setSettings(getSettings());
    if (isElectron()) {
      loadExtensions();
    }
  }, []);

  const handleInstallExt = async () => {
    if (!extPath || !isElectron()) return;
    try {
      await installExtension(extPath);
      setExtPath("");
    } catch (e) {
      console.error("Failed to install extension", e);
    }
  };

  const updateSetting = (key: keyof Settings, value: any) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveSettings({ [key]: value });

    if (key === "proxy" && isElectron()) {
      electron.send("proxy:set", value);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-auto p-2 no-scrollbar"
    >
      <div className="space-y-6 p-2">
        <div className="space-y-3">
          <h3 className="text-[9px] font-bold text-white/40 flex items-center gap-2 uppercase tracking-[0.2em] px-1">
            <Search className="w-3.5 h-3.5" /> Search Engine
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {[
              "https://www.google.com/search?q=",
              "https://www.bing.com/search?q=",
              "https://duckduckgo.com/?q=",
            ].map((url) => {
              const name = url.includes("google")
                ? "Google"
                : url.includes("bing")
                ? "Bing"
                : "DuckDuckGo";
              return (
                <button
                  key={name}
                  onClick={() => updateSetting("searchEngine", url)}
                  className={cn(
                    "flex items-center justify-between px-3 py-1.5 rounded-lg text-[11px] border transition-all",
                    settings.searchEngine === url
                      ? "bg-primary/10 border-primary/50 text-primary"
                      : "bg-black/20 border-white/5 text-white/60 hover:bg-white/5"
                  )}
                >
                  {name}
                  {settings.searchEngine === url && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[9px] font-bold text-white/40 flex items-center gap-2 uppercase tracking-[0.2em] px-1">
            <Monitor className="w-3.5 h-3.5" /> Appearance
          </h3>
          <div className="flex bg-black/20 p-1 rounded-lg border border-white/5">
            {["light", "system", "dark"].map((theme) => (
              <button
                key={theme}
                onClick={() => updateSetting("theme", theme)}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 py-1.5 text-[10px] font-bold rounded-md transition-all uppercase tracking-tighter",
                  settings.theme === theme
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-white/40 hover:text-white"
                )}
              >
                {theme === "light" && <Sun className="w-3 h-3" />}
                {theme === "dark" && <Moon className="w-3 h-3" />}
                {theme === "system" && <Monitor className="w-3 h-3" />}
                <span className="capitalize">{theme}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[9px] font-bold text-white/40 flex items-center gap-2 uppercase tracking-[0.2em] px-1">
            <ShieldCheck className="w-3.5 h-3.5" /> Proxy / VPN
          </h3>
          <div className="space-y-2">
            <div className="flex bg-black/20 p-1 rounded-lg border border-white/5">
              {["none", "http", "socks5"].map((type) => (
                <button
                  key={type}
                  onClick={() =>
                    updateSetting("proxy", { ...settings.proxy, type })
                  }
                  className={cn(
                    "flex-1 py-1.5 text-xs font-medium rounded-md transition-all capitalize",
                    settings.proxy?.type === type
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-foreground/60 hover:text-foreground"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
            {settings.proxy?.type !== "none" && (
              <div className="grid grid-cols-3 gap-2 animate-in fade-in slide-in-from-top-1">
                <input
                  type="text"
                  placeholder="Host (e.g. 127.0.0.1)"
                  value={settings.proxy?.host || ""}
                  onChange={(e) =>
                    updateSetting("proxy", {
                      ...settings.proxy,
                      host: e.target.value,
                    })
                  }
                  className="col-span-2 bg-black/20 border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                />
                <input
                  type="text"
                  placeholder="Port"
                  value={settings.proxy?.port || ""}
                  onChange={(e) =>
                    updateSetting("proxy", {
                      ...settings.proxy,
                      port: e.target.value,
                    })
                  }
                  className="bg-black/20 border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[11px] font-bold text-white/40 flex items-center gap-2 uppercase tracking-[0.2em] px-1">
            <Puzzle className="w-4 h-4" /> Extensions
          </h3>
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Path to unpacked extension..."
                value={extPath}
                onChange={(e) => setExtPath(e.target.value)}
                className="flex-1 bg-black/20 border border-white/5 rounded-md px-3 py-1.5 text-[11px] text-white outline-none focus:border-primary/50 font-mono"
              />
              <button
                onClick={handleInstallExt}
                className="bg-primary/20 hover:bg-primary/30 text-primary text-[10px] font-bold uppercase tracking-widest px-4 rounded-md transition-colors"
              >
                Load
              </button>
            </div>

            <div className="space-y-1">
              {(extensions || []).map((ext) => (
                <div
                  key={ext.id}
                  className="flex items-center justify-between p-2 rounded-md bg-black/40 border border-border/50"
                >
                  <div className="overflow-hidden">
                    <div className="text-[11px] font-medium text-white truncate">
                      {ext.name}
                    </div>
                    <div className="text-[8px] text-white/40 uppercase tracking-wider truncate">
                      v{ext.version} • {ext.id.slice(0, 8)}...
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {/* TODO: Add disable/remove */}
                    <div className="w-2 h-2 rounded-full bg-green-500/50" />
                  </div>
                </div>
              ))}
              {extensions.length === 0 && (
                <div className="text-[10px] text-foreground/30 text-center py-2 italic">
                  No extensions loaded
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-[9px] font-bold text-white/40 flex items-center gap-2 uppercase tracking-[0.2em] px-1">
            <ShieldAlert className="w-3.5 h-3.5 text-red-500" /> Security
          </h3>
          <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 space-y-3">
            <p className="text-[10px] text-foreground/60 leading-relaxed uppercase tracking-wider">
              Dangerous actions below. This will wipe all session data, history,
              and bookmarks instantly.
            </p>
            <button
              onClick={() => {
                if (
                  confirm(
                    "ARE YOU SURE? This will wipe ALL browser data and reload Pandora."
                  )
                ) {
                  useBrowserStore.getState().clearAllData();
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 transition-all text-[9px] font-bold uppercase tracking-[0.2em] active:scale-[0.98]"
            >
              <Trash2 className="w-3 h-3" /> Panic: Wipe All Data
            </button>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground/80 flex items-center gap-2">
            Updates
          </h3>
          <div className="p-3 rounded-lg border border-border bg-black/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/60">
                Current Version
              </span>
              <span className="text-xs font-mono text-foreground">
                v{config.app.version}
              </span>
            </div>
            <button
              onClick={() => {
                if (isElectron()) {
                  electron.send("updater:check", {});
                } else {
                  alert("Updates are managed by the app store in PWA mode.");
                }
              }}
              className="w-full py-1.5 rounded-md bg-primary/20 hover:bg-primary/30 text-primary text-xs transition-colors"
            >
              Check for Updates
            </button>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <p className="text-[10px] text-white/20 text-center uppercase tracking-widest">
            Pandora Core v{config.app.version}
          </p>
        </div>
      </div>
    </motion.div>
  );
}
