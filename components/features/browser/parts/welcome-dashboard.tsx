"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  FolderGit2,
  Network,
  ShieldCheck,
  Cpu,
  Search,
  ArrowRight,
  Lock,
  Activity,
  Sparkles,
  KeyRound,
  Database,
  ExternalLink,
} from "lucide-react";
import { PandoraLogo } from "@/components/ui/branding/pandora-logo";
import { useBrowserStore } from "@/lib/store/browser-store";

interface LaunchpadCard {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  route: string;
  icon: typeof FolderGit2;
  gradient: string;
  borderColor: string;
  glowColor: string;
  badge: string;
  tags: string[];
}

const LAUNCHPAD_CARDS: LaunchpadCard[] = [
  {
    id: "cases",
    title: "VYŠETROVACIE SPISY",
    subtitle: "Cases & Timeline",
    description: "Správa otvorených vyšetrovaní, auditovaná reťaz dôkazov a časová os zistení.",
    route: "/forza/pripady",
    icon: FolderGit2,
    gradient: "from-cyan-500/20 via-blue-500/10 to-transparent",
    borderColor: "group-hover:border-cyan-500/50 border-cyan-500/20",
    glowColor: "group-hover:shadow-[0_0_30px_rgba(6,182,212,0.25)]",
    badge: "WORM CHRÁNENÉ",
    tags: ["Vyšetrovací spis", "Časová os", "Reťaz úschovy"],
  },
  {
    id: "graph",
    title: "SIEŤOVÝ GRAF ENTÍT",
    subtitle: "Entity & Money Flow",
    description: "Vizuálna rekonštrukcia finančných tokov, prepojenia osôb, firiem a bankových účtov.",
    route: "/forza/siet",
    icon: Network,
    gradient: "from-purple-500/20 via-indigo-500/10 to-transparent",
    borderColor: "group-hover:border-purple-500/50 border-purple-500/20",
    glowColor: "group-hover:shadow-[0_0_30px_rgba(168,85,247,0.25)]",
    badge: "GRAFOVÝ ENGINE",
    tags: ["Analýza tokov", "IČO väzby", "AI klastre"],
  },
  {
    id: "vault",
    title: "NEMENNÝ DÔKAZOVÝ VAULT",
    subtitle: "WORM Ledger & SHA-256",
    description: "Kryptograficky zabezpečený ingest súborov s povinným kontrolným súčtom a nemennou auditnou stopou.",
    route: "/forza/upload",
    icon: ShieldCheck,
    gradient: "from-emerald-500/20 via-teal-500/10 to-transparent",
    borderColor: "group-hover:border-emerald-500/50 border-emerald-500/20",
    glowColor: "group-hover:shadow-[0_0_30px_rgba(16,185,129,0.25)]",
    badge: "LEVEL 4 VAULT",
    tags: ["SHA-256 kontrola", "WORM zápis", "Hetzner Object Lock"],
  },
  {
    id: "ai",
    title: "AUTOPILOT FORENSIC AI",
    subtitle: "Document & Sandbox",
    description: "Autonómne vyťažovanie bankových výpisov a zmlúv so suverénnym AI Privacy Gateway bez úniku dát.",
    route: "/forza/sandbox",
    icon: Cpu,
    gradient: "from-amber-500/20 via-orange-500/10 to-transparent",
    borderColor: "group-hover:border-amber-500/50 border-amber-500/20",
    glowColor: "group-hover:shadow-[0_0_30px_rgba(245,158,11,0.25)]",
    badge: "ZERO-LEAK GATEWAY",
    tags: ["Deep Reasoning", "Kategorizácia", "Výpisy PDF/CSV"],
  },
];

interface WelcomeDashboardProps {
  tabId: string;
}

export function WelcomeDashboard({ tabId }: WelcomeDashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const updateTab = useBrowserStore((s) => s.updateTab);
  const toggleCommandPalette = useBrowserStore((s) => s.toggleCommandPalette);

  function handleNavigate(route: string, title: string) {
    updateTab(tabId, {
      url: route,
      title: title,
      isLoading: true,
    });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) {
      toggleCommandPalette(true);
      return;
    }

    const query = searchQuery.trim();
    // If it looks like a URL or internal path
    if (query.startsWith("/") || query.startsWith("http://") || query.startsWith("https://")) {
      handleNavigate(query, "Navigácia");
    } else {
      // Search in cases
      handleNavigate(`/forza/pripady?q=${encodeURIComponent(query)}`, `Hľadanie: ${query}`);
    }
  }

  return (
    <div className="absolute inset-0 z-20 overflow-y-auto overflow-x-hidden flex flex-col justify-between p-6 md:p-10 pointer-events-auto select-none">
      {/* Background radial gradient glow */}
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_10%,rgba(120,50,255,0.12),transparent_70%)]" />

      {/* Top Header / Branding Area */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 flex flex-col items-center text-center mt-2 md:mt-6"
      >
        {/* Holographic Logo with Pulse Effect */}
        <div className="relative mb-5 group cursor-default">
          <div className="absolute -inset-4 bg-linear-to-r from-cyan-500/30 via-purple-500/30 to-amber-500/20 rounded-full blur-2xl opacity-60 group-hover:opacity-100 transition-opacity duration-700 animate-pulse" />
          <div className="relative p-3.5 bg-black/60 rounded-2xl border border-white/10 backdrop-blur-xl shadow-2xl shadow-purple-500/20">
            <PandoraLogo size={52} className="drop-shadow-[0_0_15px_rgba(168,85,247,0.6)]" />
          </div>
        </div>

        {/* System Title */}
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-white/4 border border-white/10 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-[11px] font-mono tracking-[0.25em] text-emerald-400 font-semibold uppercase">
            Systém pripravený | PΛND0RΛ FORENX OS v2.0
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white mb-2">
          VÍTAJTE V OPERAČNOM CENTRE{" "}
          <span className="bg-clip-text text-transparent bg-linear-to-r from-cyan-400 via-purple-400 to-amber-300">
            PΛND0RΛ
          </span>
        </h1>
        <p className="max-w-2xl text-xs sm:text-sm text-zinc-400 font-normal">
          Suverénna platforma pre digitálne vyšetrovanie, entitné grafy, finančné toky a nemenný WORM archív dôkazov.
        </p>

        {/* Omnisearch & Quick Command Trigger */}
        <form
          onSubmit={handleSearchSubmit}
          className="w-full max-w-xl mt-6 relative group"
        >
          <div className="absolute -inset-0.5 bg-linear-to-r from-cyan-500/40 via-purple-500/30 to-blue-500/40 rounded-xl opacity-40 group-hover:opacity-80 blur transition-opacity duration-500" />
          <div className="relative flex items-center bg-[#0a0a0f]/90 border border-white/15 rounded-xl shadow-2xl backdrop-blur-2xl px-4 py-2.5">
            <Search className="w-4 h-4 text-cyan-400 shrink-0 mr-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rýchle vyhľadávanie v dôkazoch a spisoch, URL alebo príkaz..."
              className="w-full bg-transparent text-sm text-white placeholder-zinc-500 focus:outline-none font-sans"
            />
            <button
              type="button"
              onClick={() => toggleCommandPalette(true)}
              className="flex items-center gap-1 px-2 py-0.5 ml-2 rounded bg-white/10 hover:bg-white/15 text-[11px] font-mono text-zinc-300 transition-colors shrink-0"
              title="Otvoriť Command Palette"
            >
              <span>Ctrl</span>
              <span>+</span>
              <span>K</span>
            </button>
          </div>
        </form>
      </motion.div>

      {/* Launchpad Grid of 4 Sovereign Modules */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
        className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5 my-8 max-w-7xl mx-auto w-full"
      >
        {LAUNCHPAD_CARDS.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.id}
              whileHover={{ y: -5, scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              onClick={() => handleNavigate(card.route, card.title)}
              className={`group relative flex flex-col justify-between p-5 md:p-6 rounded-2xl bg-[#09090d]/80 backdrop-blur-xl border ${card.borderColor} ${card.glowColor} transition-all duration-300 cursor-pointer shadow-xl overflow-hidden`}
            >
              {/* Card gradient ambient background */}
              <div
                className={`absolute inset-0 bg-linear-to-b ${card.gradient} opacity-40 group-hover:opacity-100 transition-opacity duration-500`}
              />

              <div className="relative z-10">
                {/* Header: Icon + Badge */}
                <div className="flex items-center justify-between mb-4">
                  <div className="p-3 rounded-xl bg-white/6 border border-white/10 group-hover:border-white/20 transition-colors shadow-inner">
                    <Icon className="w-6 h-6 text-white group-hover:scale-110 transition-transform duration-300" />
                  </div>
                  <span className="text-[9px] font-mono font-bold tracking-wider px-2 py-0.5 rounded-full bg-white/6 border border-white/10 text-zinc-300">
                    {card.badge}
                  </span>
                </div>

                {/* Title & Subtitle */}
                <h2 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors tracking-tight">
                  {card.title}
                </h2>
                <div className="text-[11px] font-mono text-zinc-400 mb-2.5">
                  ({card.subtitle})
                </div>

                {/* Description */}
                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                  {card.description}
                </p>
              </div>

              {/* Footer: Tags + Arrow Link */}
              <div className="relative z-10 pt-4 mt-4 border-t border-white/5 flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {card.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] text-zinc-400 bg-white/3 px-2 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="w-7 h-7 rounded-lg bg-white/4 group-hover:bg-white/15 flex items-center justify-center text-zinc-400 group-hover:text-white transition-all shrink-0">
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      {/* Bottom Live Sovereign Telemetry Ticker */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.4 }}
        className="relative z-10 w-full max-w-7xl mx-auto"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-[#08080c]/90 border border-white/10 backdrop-blur-xl text-[11px] font-mono shadow-2xl">
          {/* Item 1: WORM Status */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-zinc-400">WORM LEDGER:</span>
            <span className="text-emerald-400 font-bold">VERIFIED (SHA-256)</span>
          </div>

          <div className="hidden sm:block text-zinc-700">|</div>

          {/* Item 2: Security Level */}
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-zinc-400">BEZPEČNOSTNÝ PROFIL:</span>
            <span className="text-amber-400 font-bold">LEVEL 4 SOVEREIGN</span>
          </div>

          <div className="hidden md:block text-zinc-700">|</div>

          {/* Item 3: Evidence Integrity */}
          <div className="flex items-center gap-2">
            <Lock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-zinc-400">INTEGRITA DÔKAZOV:</span>
            <span className="text-cyan-400 font-bold">100% NEMENNÁ</span>
          </div>

          <div className="hidden lg:block text-zinc-700">|</div>

          {/* Item 4: Hardware Auth */}
          <div className="flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-zinc-400">AUTENTIFIKÁCIA:</span>
            <span className="text-purple-400 font-bold">FIDO2 / WEBAUTHN</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
