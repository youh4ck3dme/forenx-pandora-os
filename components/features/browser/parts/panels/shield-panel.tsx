"use client";

import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Lock,
  LockOpen,
  Fingerprint,
  Globe,
  Eye,
  Activity,
  ExternalLink,
  Ban,
} from "lucide-react";
import { useBrowserStore } from "@/lib/store";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { Switch } from "../../../../ui/switch";
import { electron, isElectron } from "@/lib/api";

// Animated number component
function AnimatedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value !== prevValue.current) {
      // Animate from previous to new value
      const controls = animate(prevValue.current, value, {
        duration: 0.5,
        onUpdate: (v) => setDisplayValue(Math.round(v)),
      });
      prevValue.current = value;
      return () => controls.stop();
    }
  }, [value]);

  return (
    <motion.span
      className={className}
      key={value}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.1, 1] }}
      transition={{ duration: 0.3 }}
    >
      {displayValue.toLocaleString()}
    </motion.span>
  );
}

// Category stat card
function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <motion.div
      className="bg-black/30 backdrop-blur-sm rounded-xl p-4 border border-white/5 flex flex-col items-center justify-center gap-2"
      whileHover={{ scale: 1.02, borderColor: "rgba(255,255,255,0.1)" }}
      transition={{ type: "spring", stiffness: 300 }}
    >
      <Icon className={cn("w-5 h-5", color)} />
      <AnimatedNumber
        value={value}
        className="text-2xl font-mono font-bold text-foreground"
      />
      <span className="text-[10px] text-foreground/40 uppercase tracking-wider">
        {label}
      </span>
    </motion.div>
  );
}

// Toggle row component
function ToggleRow({
  icon: Icon,
  label,
  description,
  enabled,
  onToggle,
  color,
}: {
  icon: any;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/5 hover:border-white/10 transition-colors">
      <div
        className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          enabled ? color : "bg-white/5"
        )}
      >
        <Icon
          className={cn(
            "w-5 h-5",
            enabled ? "text-white" : "text-foreground/40"
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-foreground/40 truncate">{description}</p>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}
interface ShieldLog {
  id: string;
  url: string;
  category: 'ads' | 'trackers' | 'scripts';
  timestamp: number;
}

export function ShieldPanel() {
  const {
    shieldEnabled,
    blockedCount,
    blockedAds,
    blockedTrackers,
    blockedScripts,
    fingerprintProtection,
    httpsEverywhere,
    toggleShield,
    toggleFingerprintProtection,
    toggleHttpsEverywhere,
  } = useBrowserStore();

  const [logs, setLogs] = useState<ShieldLog[]>([]);

  useEffect(() => {
    if (!isElectron()) return;

    void electron.invoke("shield:getLogs").then((initialLogs) => {
      setLogs(Array.isArray(initialLogs) ? initialLogs as ShieldLog[] : []);
    });

    // Listen for new blocks
    const handleBlocked = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const log = data as ShieldLog;
      setLogs(prev => {
        const newLogs = [{
          id: log.id,
          url: log.url,
          category: log.category,
          timestamp: log.timestamp
        }, ...prev];
        return newLogs.slice(0, 50); // Keep last 50
      });
    };

    electron.on("shield:blocked", handleBlocked);
    return () => electron.off("shield:blocked", handleBlocked);
  }, []);

  // Calculate protection percentage (visual indicator)
  const protectionScore = shieldEnabled
    ? (fingerprintProtection ? 33 : 0) + (httpsEverywhere ? 33 : 0) + 34
    : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-auto p-4 no-scrollbar"
    >
      <div className="space-y-5">
        {/* Header / Status */}
        <div className="flex flex-col items-center justify-center py-6 gap-4 relative">
          {/* Glow background */}
          <div
            className={cn(
              "absolute inset-0 rounded-3xl blur-3xl opacity-20 transition-colors duration-700",
              shieldEnabled ? "bg-green-500" : "bg-red-500"
            )}
          />

          <motion.div
            animate={{
              scale: shieldEnabled ? 1 : 0.9,
              opacity: shieldEnabled ? 1 : 0.5,
            }}
            className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-colors duration-500 relative z-10",
              shieldEnabled
                ? "bg-linear-to-br from-green-500/20 to-emerald-500/10 text-green-500 shadow-[0_0_40px_-5px_rgba(34,197,94,0.4)]"
                : "bg-red-500/10 text-red-500"
            )}
          >
            <AnimatePresence mode="wait">
              {shieldEnabled ? (
                <motion.div
                  key="shield"
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: 180 }}
                  transition={{ type: "spring", stiffness: 200 }}
                >
                  <ShieldCheck className="w-10 h-10" />
                </motion.div>
              ) : (
                <motion.div
                  key="alert"
                  initial={{ scale: 0, rotate: 180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0, rotate: -180 }}
                  transition={{ type: "spring", stiffness: 200 }}
                >
                  <ShieldAlert className="w-10 h-10" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          <div className="text-center z-10">
            <h2 className="text-[15px] font-bold text-white tracking-tight">
              {shieldEnabled ? "Pandora Shield Active" : "Protection Disabled"}
            </h2>
            <p className="text-[9px] text-white/40 mt-1 uppercase tracking-widest">
              {shieldEnabled
                ? `Blocking ads, trackers, and malicious scripts`
                : "Your privacy is at risk"}
            </p>
          </div>

          {/* Protection Progress Bar */}
          {shieldEnabled && (
            <div className="w-full max-w-[200px] z-10">
              <div className="flex justify-between text-[8px] text-white/40 mb-1 uppercase tracking-tighter">
                <span>Protection Level</span>
                <span>{protectionScore}%</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-linear-to-r from-green-500 to-emerald-400 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${protectionScore}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
          )}

          <button
            onClick={() => toggleShield(!shieldEnabled)}
            className={cn(
              "px-6 py-1.5 rounded-full text-[9px] font-bold transition-all z-10 uppercase tracking-widest",
              shieldEnabled
                ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20"
                : "bg-green-500/10 text-green-500 hover:bg-green-500/20 border border-green-500/20"
            )}
          >
            {shieldEnabled ? "Deactivate Shield" : "Activate Shield"}
          </button>
        </div>

        {/* Stats Grid - Category Breakdown */}
        <div className="space-y-2">
          <h3 className="text-[9px] font-bold text-white/40 uppercase tracking-[0.2em] px-1">
            Threats Blocked
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              icon={Ban}
              label="Ads"
              value={blockedAds}
              color="text-red-400"
            />
            <StatCard
              icon={Eye}
              label="Trackers"
              value={blockedTrackers}
              color="text-yellow-400"
            />
            <StatCard
              icon={Zap}
              label="Scripts"
              value={blockedScripts}
              color="text-purple-400"
            />
          </div>

          {/* Total blocked card */}
          <div className="bg-linear-to-r from-green-500/10 to-emerald-500/5 rounded-xl p-4 border border-green-500/10 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-white">
                  Total Protected
                </p>
                <p className="text-[8px] text-white/40 uppercase tracking-wider">
                  All threats intercepted
                </p>
              </div>
            </div>
            <AnimatedNumber
              value={blockedCount}
              className="text-2xl font-mono font-bold text-green-400"
            />
          </div>
        </div>

        {/* Protection Features */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-foreground/60 uppercase tracking-wider px-1">
            Protection Features
          </h3>
          <div className="space-y-2">
            <ToggleRow
              icon={Fingerprint}
              label="Fingerprint Protection"
              description="Randomize browser fingerprint"
              enabled={fingerprintProtection}
              onToggle={toggleFingerprintProtection}
              color="bg-purple-500/20"
            />
            <ToggleRow
              icon={Lock}
              label="HTTPS Everywhere"
              description="Force secure connections"
              enabled={httpsEverywhere}
              onToggle={toggleHttpsEverywhere}
              color="bg-blue-500/20"
            />
          </div>
        </div>

        {/* Live Logs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[9px] font-bold text-white/40 uppercase tracking-[0.2em] flex items-center gap-2">
              <Activity className="w-3 h-3 text-blue-400" />
              Live Intercept Logs
            </h3>
            <span className="text-[8px] font-mono text-white/20 uppercase">Real-time Feed</span>
          </div>

          <div className="space-y-1 max-h-[400px] overflow-auto no-scrollbar pr-1">
            <AnimatePresence initial={false}>
              {logs.length === 0 ? (
                <div className="py-8 text-center bg-black/10 rounded-xl border border-dashed border-white/5 mx-1">
                    <p className="text-[10px] text-white/20 italic">Awaiting network activities...</p>
                </div>
              ) : (
                logs.map((log) => (
                  <motion.div
                    key={log.id}
                    initial={{ opacity: 0, x: -10, height: 0 }}
                    animate={{ opacity: 1, x: 0, height: 'auto' }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center gap-3 p-2 bg-black/40 border border-white/5 rounded-lg group hover:border-white/10 transition-colors"
                  >
                    <div className={cn(
                        "w-1.5 h-1.5 rounded-full shrink-0",
                        log.category === 'ads' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]" :
                        log.category === 'trackers' ? "bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]" :
                        "bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                    )} />

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                            <span className={cn(
                                "text-[8px] font-black uppercase tracking-widest",
                                log.category === 'ads' ? "text-red-400" :
                                log.category === 'trackers' ? "text-yellow-400" :
                                "text-purple-400"
                            )}>
                                {log.category}
                            </span>
                            <span className="text-[7px] font-mono text-white/20">
                                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                        </div>
                        <p className="text-[9px] text-white/60 font-mono truncate hover:text-white transition-colors cursor-default">
                            {log.url}
                        </p>
                    </div>

                    {isElectron() && (
                      <button
                          onClick={() => void window.pandoraDesktop!.openExternalSafely(log.url)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
                      >
                          <ExternalLink className="w-3 h-3 text-white/40" />
                      </button>
                    )}
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Connection Status */}
        <div className="bg-black/20 rounded-xl p-4 border border-white/5">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "w-3 h-3 rounded-full",
                httpsEverywhere ? "bg-green-500 animate-pulse" : "bg-yellow-500"
              )}
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                {httpsEverywhere ? "Secure Connection" : "Standard Connection"}
              </p>
              <p className="text-xs text-foreground/40">
                {httpsEverywhere
                  ? "HTTPS upgrade enabled for all sites"
                  : "Some connections may be unencrypted"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
