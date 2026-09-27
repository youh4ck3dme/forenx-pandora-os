import type { AiTask } from "@/lib/ai.functions";
import type { ForensicDossier } from "@/lib/types";
import { ARMIVEX_CASE_DOSSIER } from "@/lib/demo-dossier";

export const TASK_LABELS: Record<AiTask, string> = {
  explain_finding: "Vysvetliť vybraný nález",
  case_summary: "Návrh zhrnutia prípadu",
  normalize_descriptions: "Normalizovať popisy platieb",
  alt_devil: "Alternatívne vysvetlenie (Diablov advokát)",
  admiss_audit: "Audit procesnej prípustnosti dôkazov",
};

export function loadDemoDossier(): ForensicDossier {
  return {
    ...ARMIVEX_CASE_DOSSIER,
    analysisMeta: {
      ...ARMIVEX_CASE_DOSSIER.analysisMeta!,
      isDemo: true,
      analysisStatus: "demo",
      createdAt: new Date().toISOString(),
    },
  };
}

export type Suggestion = {
  transaction: string;
  normalized: string;
  counterparty?: string;
  confidence: string;
};

export function lightClasses(light: string) {
  switch (light) {
    case "green":
      return {
        bg: "bg-emerald-500/15",
        text: "text-emerald-400",
        border: "border-emerald-500/30",
        dot: "bg-emerald-400",
      };
    case "yellow":
      return {
        bg: "bg-amber-500/15",
        text: "text-amber-400",
        border: "border-amber-500/30",
        dot: "bg-amber-400",
      };
    case "red":
      return {
        bg: "bg-rose-500/15",
        text: "text-rose-400",
        border: "border-rose-500/30",
        dot: "bg-rose-400",
      };
    default:
      return {
        bg: "bg-slate-500/15",
        text: "text-slate-400",
        border: "border-slate-500/30",
        dot: "bg-slate-400",
      };
  }
}

export function riskBadgeClasses(risk: string) {
  switch (risk) {
    case "KRITICKÉ":
      return "border-rose-500/40 bg-rose-500/15 text-rose-400";
    case "VYSOKÉ":
      return "border-orange-500/40 bg-orange-500/15 text-orange-400";
    case "STREDNÉ":
      return "border-amber-500/40 bg-amber-500/15 text-amber-400";
    default:
      return "border-slate-500/40 bg-slate-500/15 text-slate-400";
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileBadge(name: string) {
  const ext = name.split(".").pop()?.toUpperCase() || "SÚBOR";
  let color = "border-slate-500/30 bg-slate-500/10 text-slate-400";
  if (["PDF"].includes(ext)) {
    color = "border-rose-500/30 bg-rose-500/10 text-rose-400";
  } else if (["DOCX", "DOC", "RTF"].includes(ext)) {
    color = "border-blue-500/30 bg-blue-500/10 text-blue-400";
  } else if (["XLSX", "XLS", "CSV"].includes(ext)) {
    color = "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  } else if (["JSON", "TXT", "MD", "HTML", "HTM"].includes(ext)) {
    color = "border-amber-500/30 bg-amber-500/10 text-amber-400";
  } else if (["PNG", "JPG", "JPEG", "WEBP", "TIFF"].includes(ext)) {
    color = "border-purple-500/30 bg-purple-500/10 text-purple-400";
  }
  return { ext, color };
}
