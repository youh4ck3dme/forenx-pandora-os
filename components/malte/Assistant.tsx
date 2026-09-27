import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { aiUnavailableReason } from "@/lib/ai/availability";
import { assessControlReadiness } from "@/lib/ai/control-readiness";
import { useServerFn } from "@tanstack/react-start";
import {
  Bot,
  Eye,
  Loader2,
  ShieldAlert,
  Shield,
  Scale,
  Gavel,
  FileCheck,
  Download,
  Clock,
  AlertTriangle,
  CheckCheck,
  Gauge,
  Scan,
  FileText,
  Lock,
  UploadCloud,
  RotateCcw,
  Copy,
  Check,
  Zap,
  HelpCircle,
  Landmark,
  Users,
  Trash2,
  Plus,
  X,
  FileSpreadsheet,
  ArrowRightLeft,
  Save,
  Compass,
  Sparkles,
  BrainCircuit,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { LawyerTourGuide } from "./LawyerTourGuide";
import { TruthTimestorySection } from "./TruthTimestorySection";
import { DevilsAdvocatePanel } from "@/components/features/forensic/DevilsAdvocatePanel";
import { AdmissibilityAuditView } from "@/components/features/forensic/AdmissibilityAuditView";
import { CustodyLedgerViewer } from "@/components/features/forensic/CustodyLedgerViewer";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "./Shell";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/ui/button";
import { UploadFileList } from "@/components/malte/UploadFileList";
import { Badge } from "@/components/ui/badge";
import { Globe } from "@/components/ui/Globe";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveCase } from "@/hooks/useActiveCase";
import { OFFLINE_AI_MESSAGE, useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAiConsent } from "@/hooks/useAiConsent";
import {
  AI_CONSENT_MISSING_MESSAGE,
  AI_CONSENT_PREVIEW_FAILED_MESSAGE,
  buildFilesPreview,
} from "@/lib/ai-consent";
import { AI_DISCLAIMER } from "@/config/brand";
import {
  getAiStatus,
  previewAiPayload,
  runAiTask,
  runForensicAutopilot,
  extractBulkFilesText,
  MIN_EXTRACT_CHARS,
  saveCaseDossier,
  getForensicDossier,
  type AiRunResult,
  type AiTask,
} from "@/lib/ai.functions";
import type { ForensicDossier, BulkFileItem } from "@/lib/types";
import { formatSourceRef } from "@/lib/types";
import {
  computeDossierSha256,
  exportDossierToPDF,
} from "@/lib/export-pdf";
import { createSignatureBinding } from "@/lib/forza/webauthn-signature";
import { logCaseAccess } from "@/lib/forza/access-audit";
import { useAccountProfile } from "@/lib/hooks/useAccountProfile";
import { upsertTransaction } from "@/lib/case-data";
import { ARMIVEX_CROSS_CONTRADICTIONS } from "@/lib/cross-contradictions";
import { ARMIVEX_CASE_DOSSIER } from "@/lib/demo-dossier";
import { isDemoDossier } from "@/lib/autopilot-meta";
import { loadQuarantineDocuments } from "@/lib/quarantine.functions";
import {
  clearQuarantineStage,
  quarantineBase64ToFile,
  readQuarantineStage,
} from "@/lib/quarantine-stage";
import {
  extractPdfViaPageOcr,
  fileToDirectPayload,
  PDF_SCAN_OCR_TOAST,
} from "@/lib/pdf-page-ocr";
import {
  isOverServerFnBudget,
  mapUploadNetworkError,
  partitionBySize,
  tooLargeForServerFnMessage,
} from "@/lib/upload-prep";

const TASK_LABELS: Record<AiTask, string> = {
  explain_finding: "Vysvetliť vybraný nález",
  case_summary: "Návrh zhrnutia prípadu",
  normalize_descriptions: "Normalizovať popisy platieb",
  alt_devil: "Alternatívne vysvetlenie (Diablov advokát)",
  admiss_audit: "Audit procesnej prípustnosti dôkazov",
};

function loadDemoDossier(): ForensicDossier {
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

type Suggestion = {
  transaction: string;
  normalized: string;
  counterparty?: string;
  confidence: string;
};

function lightClasses(light: string) {
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

function riskBadgeClasses(risk: string) {
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

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileBadge(name: string) {
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

export function Assistant() {
  const searchParams = useSearchParams();
  const search = {
    quarantine: searchParams?.get("quarantine") ?? undefined,
    case: searchParams?.get("case") ?? undefined,
  };
  const {
    activeCase,
    analysis,
    hasCase,
    revisions,
    setDossier: setSharedDossier,
  } = useActiveCase();
  const isOnline = useOnlineStatus();
  const status = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => getAiStatus(),
    enabled: hasCase,
  });
  const requestLock = useRef(false);
  const quarantineLoaded = useRef(false);
  const analysisBlocked = !hasCase
    ? "Najprv vyberte prípad."
    : aiUnavailableReason(status, "analysis", isOnline);
  const { ensureConsent, consentDialog } = useAiConsent();
  const [mainMode, setMainMode] = useState<"autopilot" | "quick_tasks">(
    "autopilot",
  );

  // Forenzný Autopilot State
  const [isProcessing, setIsProcessing] = useState(false);
  const [stage, setStage] = useState<"idle" | "extracting" | "analyzing">(
    "idle",
  );
  const [dossier, setDossier] = useState<ForensicDossier | null>(null);
  /** Text poslednej Autopilot extrakcie — potrebný na retry zlyhaných častí. */
  const [lastAutopilotDocumentText, setLastAutopilotDocumentText] = useState<
    string | null
  >(null);
  const [autopilotTab, setAutopilotTab] = useState("facts");
  const [isDragging, setIsDragging] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Server functions
  const runAutopilotFn = useServerFn(runForensicAutopilot);
  const extractBulkTextFn = useServerFn(extractBulkFilesText);
  const saveCaseDossierFn = useServerFn(saveCaseDossier);
  const getForensicDossierFn = useServerFn(getForensicDossier);
  const loadQuarantine = useServerFn(loadQuarantineDocuments);

  const [isSavingDossier, setIsSavingDossier] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);

  useEffect(() => {
    if (dossier) setSharedDossier(dossier);
  }, [dossier, setSharedDossier]);

  // Načítaj uložený dossier pre aktívny prípad. Pri zmene prípadu resetuj lokálny stav,
  // aby sa nenechal zobraziť spis predchádzajúceho prípadu.
  useEffect(() => {
    let active = true;
    setDossier(null);
    setLastSavedAt(null);
    setSaveError(null);
    setAnalysisWarnings([]);
    setDemoMode(false);
    setLastAutopilotDocumentText(null);
    if (!activeCase.id) return;

    async function checkExistingDossier() {
      try {
        const res = await getForensicDossierFn({
          data: { caseId: activeCase.id },
        });
        if (active && res && res.success && res.dossier) {
          if (isDemoDossier(res.dossier)) return;
          setDossier(res.dossier);
          setDemoMode(false);
        }
      } catch (err) {
        console.debug("checkExistingDossier fallback:", err);
      }
    }

    void checkExistingDossier();
    return () => {
      active = false;
    };
  }, [activeCase.id, getForensicDossierFn]);

  const showTimestory = Boolean(dossier);

  useEffect(() => {
    if (!showTimestory && autopilotTab === "timestory") {
      setAutopilotTab("facts");
    }
  }, [showTimestory, autopilotTab]);

  const handleQueueFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;
      const { accepted, rejected } = partitionBySize(incoming);
      // Veľké PDF necháme vo fronte — spracujú sa stránkovým OCR.
      const oversizedPdfs = rejected
        .filter((r) => r.file.name.toLowerCase().endsWith(".pdf"))
        .map((r) => r.file);
      const hardRejects = rejected.filter(
        (r) => !r.file.name.toLowerCase().endsWith(".pdf"),
      );
      for (const r of hardRejects) {
        toast.error(r.reason);
      }
      if (oversizedPdfs.length > 0) {
        toast.info(PDF_SCAN_OCR_TOAST);
      }
      const toAdd = [...accepted, ...oversizedPdfs];
      if (toAdd.length === 0) return;
      const existingNames = new Set(bulkFiles.map((f) => f.name));
      const newItems = toAdd.filter((f) => !existingNames.has(f.name));
      if (newItems.length === 0) {
        toast.info("Tieto súbory už sú vo fronte.");
        return;
      }
      setBulkFiles((prev) => [...prev, ...newItems]);
      setFileErrors((prev) => {
        const next = { ...prev };
        for (const f of newItems) delete next[f.name];
        for (const r of hardRejects) next[r.file.name] = r.reason;
        return next;
      });
      toast.info(
        `Pridané ${newItems.length} ${newItems.length === 1 ? "súbor" : newItems.length < 5 ? "súbory" : "súborov"} do fronty.`,
      );
    },
    [bulkFiles],
  );

  useEffect(() => {
    quarantineLoaded.current = false;
  }, [activeCase.id]);

  // Admin quarantine → fronta Autopilota
  useEffect(() => {
    if (search.quarantine !== "1" || !hasCase || quarantineLoaded.current)
      return;
    if (search.case && search.case !== activeCase.id) return;
    const staged = readQuarantineStage();
    if (
      !staged ||
      staged.target !== "asistent" ||
      staged.caseId !== activeCase.id ||
      staged.names.length === 0
    ) {
      return;
    }
    quarantineLoaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const res = await loadQuarantine({ data: { names: staged.names } });
        if (cancelled) return;
        const files = res.files.map((f: any) =>
          quarantineBase64ToFile(f.fileName, f.mime, f.base64),
        );
        clearQuarantineStage();
        handleQueueFiles(files);
      } catch (err) {
        quarantineLoaded.current = false;
        toast.error(
          err instanceof Error
            ? err.message
            : "Nepodarilo sa načítať quarantine dokumenty.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    search.quarantine,
    search.case,
    hasCase,
    activeCase.id,
    loadQuarantine,
    handleQueueFiles,
  ]);

  const handleRemoveQueueFile = useCallback((index: number) => {
    setBulkFiles((prev) => {
      const removed = prev[index];
      if (removed) {
        setFileErrors((errors) => {
          const next = { ...errors };
          delete next[removed.name];
          return next;
        });
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleClearQueue = useCallback(() => {
    setBulkFiles([]);
    setFileErrors({});
  }, []);

  const handleRunBulk = useCallback(
    async (filesToProcess: File[]) => {
      if (filesToProcess.length === 0 || analysisBlocked || requestLock.current)
        return;
      if (!isOnline) {
        toast.warning(OFFLINE_AI_MESSAGE);
        return;
      }

      // Fail-closed: bez potvrdeného súhlasu sa nič neodošle do AI.
      requestLock.current = true;
      setIsProcessing(true);
      const consentCaseId = activeCase.id || "case-autopilot";
      let consentVersion: string | null = null;
      try {
        consentVersion = await ensureConsent(consentCaseId, () =>
          buildFilesPreview(
            filesToProcess.map((f) => ({ name: f.name, size: f.size })),
          ),
        );
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
        );
        requestLock.current = false;
        setIsProcessing(false);
        return;
      }
      if (!consentVersion) {
        toast.warning(AI_CONSENT_MISSING_MESSAGE);
        requestLock.current = false;
        setIsProcessing(false);
        return;
      }

      setIsProcessing(true);
      setStage("extracting");

      try {
        const perFileErrors: Record<string, string> = {};
        const extractOne = async (payload: {
          fileName: string;
          fileBase64?: string;
          textContent?: string;
          consentVersion: string;
        }) =>
          extractBulkTextFn({
            data: {
              files: [
                {
                  fileName: payload.fileName,
                  ...(payload.fileBase64
                    ? { fileBase64: payload.fileBase64 }
                    : {}),
                  ...(payload.textContent
                    ? { textContent: payload.textContent }
                    : {}),
                },
              ],
              consentVersion: payload.consentVersion,
            },
          });

        type Row = {
          fileName: string;
          success: boolean;
          text: string;
          usedOcr?: boolean;
          error?: string;
        };
        const results: Row[] = [];

        for (const file of filesToProcess) {
          const isPdf = file.name.toLowerCase().endsWith(".pdf");

          // Veľké PDF → rovno stránkový OCR (obíde 413).
          if (isPdf && isOverServerFnBudget(file)) {
            toast.info(PDF_SCAN_OCR_TOAST);
            const pageRes = await extractPdfViaPageOcr(
              file,
              consentVersion,
              extractOne,
            );
            results.push({
              fileName: file.name,
              success: pageRes.success,
              text: pageRes.text,
              usedOcr: true,
              ...(pageRes.error ? { error: pageRes.error } : {}),
            });
            if (!pageRes.success && pageRes.error) {
              perFileErrors[file.name] = pageRes.error;
            }
            continue;
          }

          if (isOverServerFnBudget(file)) {
            const reason = tooLargeForServerFnMessage(file);
            perFileErrors[file.name] = reason;
            results.push({
              fileName: file.name,
              success: false,
              text: "",
              error: reason,
            });
            continue;
          }

          try {
            const payload = await fileToDirectPayload(file);
            const bulkExtractRes = await extractOne({
              ...payload,
              consentVersion,
            });
            const row = bulkExtractRes.results?.[0];
            const textContent = row?.text || bulkExtractRes?.aggregatedText;
            const ok = Boolean(row?.success && textContent?.trim());
            const usedOcr = Boolean(row?.usedOcr);

            // Low-text / OCR fail na PDF → skús stránky.
            if (
              isPdf &&
              (!ok || (usedOcr && (textContent?.trim().length ?? 0) < 50))
            ) {
              toast.info(PDF_SCAN_OCR_TOAST);
              const pageRes = await extractPdfViaPageOcr(
                file,
                consentVersion,
                extractOne,
              );
              results.push({
                fileName: file.name,
                success: pageRes.success,
                text: pageRes.text,
                usedOcr: true,
                ...(pageRes.error ? { error: pageRes.error } : {}),
              });
              if (!pageRes.success && pageRes.error) {
                perFileErrors[file.name] = pageRes.error;
              }
              continue;
            }

            if (row?.success && textContent) {
              results.push({
                fileName: file.name,
                success: true,
                text: textContent,
                ...(usedOcr ? { usedOcr: true } : {}),
              });
            } else {
              const err =
                row?.error ||
                "Extrakcia textu zlyhala (prázdny alebo príliš krátky text).";
              perFileErrors[file.name] = err;
              results.push({
                fileName: file.name,
                success: false,
                text: "",
                error: err,
              });
            }
          } catch (fileErr) {
            const err = mapUploadNetworkError(fileErr);
            perFileErrors[file.name] = err;
            // 413 na PDF → skús stránky.
            if (isPdf) {
              toast.info(PDF_SCAN_OCR_TOAST);
              const pageRes = await extractPdfViaPageOcr(
                file,
                consentVersion,
                extractOne,
              );
              if (pageRes.success) {
                delete perFileErrors[file.name];
                results.push({
                  fileName: file.name,
                  success: true,
                  text: pageRes.text,
                  usedOcr: true,
                });
                continue;
              }
              perFileErrors[file.name] = pageRes.error || err;
              results.push({
                fileName: file.name,
                success: false,
                text: "",
                error: pageRes.error || err,
              });
              continue;
            }
            results.push({
              fileName: file.name,
              success: false,
              text: "",
              error: err,
            });
          }
        }

        setFileErrors(perFileErrors);

        const failed = results.filter((r) => !r.success);
        const succeeded = results.filter((r) => r.success);
        const ocrCount = results.filter((r) => r.success && r.usedOcr).length;
        const aggregatedText = succeeded.map((r) => r.text).join("\n\n");
        const totalCharCount = aggregatedText.length;

        if (failed.length > 0) {
          const names = failed.map((r) => r.fileName).join(", ");
          toast.warning(
            failed.length === results.length
              ? `Žiadny súbor sa nepodarilo prečítať: ${names}`
              : `${failed.length} z ${results.length} súborov zlyhalo: ${names}`,
          );
        }

        if (
          succeeded.length === 0 ||
          aggregatedText.trim().length < MIN_EXTRACT_CHARS
        ) {
          throw new Error(
            failed[0]?.error ||
              "Extrakcia textu zo súborov zlyhala (prázdny alebo príliš krátky text).",
          );
        }

        if (ocrCount > 0) {
          toast.info(
            `${ocrCount} ${ocrCount === 1 ? "dokument rozpoznaný" : "dokumenty rozpoznané"} cez Mistral OCR.`,
          );
        }

        toast.info(
          `Extrahovaných ${totalCharCount.toLocaleString("sk-SK")} znakov z ${succeeded.length}/${results.length} spisov. Spúšťam forenznú analýzu...`,
        );

        setStage("analyzing");
        const analysisRes = await runAutopilotFn({
          data: {
            caseId: consentCaseId,
            documentText: aggregatedText,
            fileName: `Hromadná dávka (${filesToProcess.length} spisov)`,
            documentIds: filesToProcess.map((f) => f.name),
            consentVersion,
          },
        });

        if (analysisRes.success && analysisRes.dossier) {
          setDemoMode(false);
          setDossier(analysisRes.dossier);
          setLastAutopilotDocumentText(aggregatedText);
          setAnalysisWarnings(analysisRes.warnings ?? []);
          const failedNames = new Set(failed.map((r) => r.fileName));
          setBulkFiles((prev) => prev.filter((f) => failedNames.has(f.name)));
          if (failed.length === 0) setFileErrors({});
          for (const w of analysisRes.warnings ?? []) {
            toast.warning(w, { duration: 7000 });
          }
          if (analysisRes.saveStatus === "saved") {
            setSaveError(null);
            setLastSavedAt(
              new Date().toLocaleTimeString("sk-SK", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              }),
            );
            toast.success("Forenzná analýza dokončená a uložená do prípadu.");
          } else if (analysisRes.saveStatus === "failed") {
            setSaveError(
              analysisRes.saveError ?? "Automatické uloženie analýzy zlyhalo.",
            );
            toast.error(
              `Analýza hotová, ale uloženie zlyhalo: ${analysisRes.saveError ?? "neznáma chyba"}. Použite Retry.`,
              { duration: 8000 },
            );
          } else {
            toast.success("Forenzná analýza dávky bola úspešne dokončená!");
          }
        } else {
          toast.error("Forenzná analýza nevrátila použiteľný výsledok.");
        }
      } catch (err: unknown) {
        toast.error(mapUploadNetworkError(err));
      } finally {
        requestLock.current = false;
        setIsProcessing(false);
        setStage("idle");
      }
    },
    [
      activeCase.id,
      analysisBlocked,
      ensureConsent,
      extractBulkTextFn,
      isOnline,
      runAutopilotFn,
    ],
  );

  // Quick tasks state
  const [task, setTask] = useState<AiTask>("case_summary");
  const [alertId, setAlertId] = useState<string>(analysis.alerts[0]?.id ?? "");
  const [result, setResult] = useState<AiRunResult | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!alertId && analysis.alerts[0]?.id) {
      setAlertId(analysis.alerts[0].id);
    }
  }, [alertId, analysis.alerts]);

  const output = result?.output as
    | {
        summary?: string;
        explanation?: string;
        unverified?: string[];
        cited?: string[];
        suggestions?: Suggestion[];
        idMap?: { transactions: Record<string, string> };
        hypotheses?: Array<{
          id: string;
          title: string;
          scenario: string;
          explainedEvidence?: string[];
          requiredTracesIfTrue?: string[];
          rebuttalTest?: string;
        }>;
        overallStatus?: string;
        score?: number;
        defects?: Array<{
          severity: string;
          paragraph: string;
          description: string;
          remedyAction: string;
        }>;
        courtReadySummary?: string;
      }
    | undefined;

  const text = output?.summary ?? output?.explanation ?? "";
  const suggestions = useMemo(() => output?.suggestions ?? [], [output]);

  const profile = useAccountProfile();

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPDF = useCallback(async () => {
    if (!dossier || isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      // P1-04: export citlivého spisu sa nezmeniteľne zaznamená do auditného ledgeri.
      void logCaseAccess(dossier.caseId, "export");
      // P1-01: export podpíše vyšetrovateľ (identita z profilu), ak je profil vyplnený.
      const investigator = profile.data?.fullName
        ? {
            investigator: {
              id: profile.data?.email || profile.data.fullName,
              name: profile.data.fullName,
            },
          }
        : undefined;
      // P0-01: podpis viažeme na passkey (navigator.credentials.create);
      // fallback = lokálny ned exportovateľný softvérový kľúč.
      const binding = investigator
        ? await createSignatureBinding({
            challenge: computeDossierSha256(dossier),
            userId: investigator.investigator.id,
            userName: investigator.investigator.name,
          })
        : undefined;
      exportDossierToPDF(
        dossier,
        investigator
          ? { ...investigator, webauthn: binding ?? undefined }
          : undefined,
      );
      toast.success(
        "AI pracovná analýza (A4) so SHA-256 pečaťou bola pripravená na tlač/stiahnutie.",
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [dossier, isExportingPdf, profile.data?.fullName, profile.data?.email]);

  const handleRetryFailedChunks = useCallback(async () => {
    if (!dossier?.analysisMeta || !lastAutopilotDocumentText) {
      toast.error(
        "Opakovanie častí vyžaduje rovnaký text spisu z aktuálnej relácie. Nahrajte spis znova.",
      );
      return;
    }
    const failed = (dossier.analysisMeta.chunks ?? [])
      .filter((c) => c.status === "failed")
      .map((c) => c.index);
    if (failed.length === 0) {
      toast.message("Žiadne zlyhané časti na opakovanie.");
      return;
    }
    const caseId = activeCase.id;
    if (!caseId) {
      toast.error("Nie je vybratý aktívny prípad.");
      return;
    }
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }
    setIsProcessing(true);
    setStage("analyzing");
    try {
      const consentVersion = await ensureConsent(caseId, () =>
        Promise.resolve(
          `Opakovanie zlyhaných častí Autopilota (${failed.join(", ")})`,
        ),
      );
      if (!consentVersion) {
        toast.warning(AI_CONSENT_MISSING_MESSAGE);
        return;
      }
      const analysisRes = await runAutopilotFn({
        data: {
          caseId,
          documentText: lastAutopilotDocumentText,
          documentIds: dossier.analysisMeta.documentIds,
          consentVersion,
          retryChunkIndexes: failed,
          priorDossier: dossier,
        },
      });
      if (analysisRes.success && analysisRes.dossier) {
        setDossier(analysisRes.dossier);
        setAnalysisWarnings(analysisRes.warnings ?? []);
        for (const w of analysisRes.warnings ?? []) {
          toast.warning(w, { duration: 7000 });
        }
        toast.success(
          analysisRes.dossier.analysisMeta?.analysisStatus === "complete"
            ? "Zlyhané časti boli znovu analyzované."
            : "Čiastočné opakovanie dokončené — skontrolujte stav častí.",
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Opakovanie častí zlyhalo.",
      );
    } finally {
      setIsProcessing(false);
      setStage("idle");
    }
  }, [
    dossier,
    lastAutopilotDocumentText,
    activeCase.id,
    isOnline,
    ensureConsent,
    runAutopilotFn,
  ]);

  const handleSaveDossier = useCallback(async () => {
    if (!dossier) {
      toast.error("Žiadna vygenerovaná analýza na uloženie.");
      return;
    }
    if (demoMode || isDemoDossier(dossier)) {
      toast.error(
        "Syntetická ukážka sa neukladá do produkčného prípadu. Nahrajte reálny spis.",
      );
      return;
    }
    const caseId = activeCase.id;
    if (!caseId) {
      toast.error("Nie je vybratý aktívny prípad pre uloženie analýzy.");
      return;
    }

    setIsSavingDossier(true);
    setSaveError(null);
    try {
      const res = await saveCaseDossierFn({
        data: {
          caseId,
          dossier,
        },
      });
      if (res && res.success) {
        const timeStr = new Date().toLocaleTimeString("sk-SK", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        setLastSavedAt(timeStr);
        setSaveError(null);
        toast.success(
          `AI pracovná analýza bola uložená do prípadu (${timeStr}).`,
        );
      } else {
        const msg = "Uloženie analýzy do databázy zlyhalo.";
        setSaveError(msg);
        toast.error(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("42703") ||
        msg.includes("forensic_dossier") ||
        msg.toLowerCase().includes("column")
      ) {
        console.warn("Supabase column forensic_dossier missing:", msg);
        const warn =
          "Databázová schéma ešte neobsahuje stĺpec forensic_dossier (migrácia čaká). Spis je len v lokálnom stave.";
        setSaveError(warn);
        toast.warning(warn, { duration: 6000 });
      } else {
        setSaveError(msg);
        toast.error(`Chyba pri ukladaní: ${msg}`);
      }
    } finally {
      setIsSavingDossier(false);
    }
  }, [activeCase.id, demoMode, dossier, saveCaseDossierFn]);

  const handleTourAction = useCallback(
    (stepId: number) => {
      switch (stepId) {
        case 1:
          if (!dossier) {
            setDemoMode(true);
            setDossier(loadDemoDossier());
            setAutopilotTab("timestory");
            toast.success("Načítaný autentický spis: Kauza Armivex & Novák.");
          }
          break;
        case 2:
          if (!dossier) {
            setDemoMode(true);
            setDossier(loadDemoDossier());
          }
          setAutopilotTab("facts");
          break;
        case 3:
          if (!dossier) {
            setDemoMode(true);
            setDossier(loadDemoDossier());
          }
          setAutopilotTab("transakcie");
          break;
        case 4:
          if (!dossier) {
            setDemoMode(true);
            setDossier(loadDemoDossier());
          }
          setAutopilotTab("rozpory");
          break;
        case 5:
          if (!dossier) {
            setDemoMode(true);
            setDossier(loadDemoDossier());
          }
          setAutopilotTab("defense");
          break;
        case 6:
          if (dossier) {
            void handleExportPDF();
          } else {
            setDemoMode(true);
            const demo = loadDemoDossier();
            setDossier(demo);
            exportDossierToPDF(demo);
            toast.success(
              "Vzorová AI pracovná analýza (A4) so SHA-256 pečaťou vygenerovaná.",
            );
          }
          break;
      }
    },
    [dossier, handleExportPDF],
  );

  // Quick tasks run
  /** Náhľad presne tých minimalizovaných dát, ktoré by odišli k poskytovateľovi AI. */
  async function buildTaskPreview(
    requestedTask: AiTask = task,
  ): Promise<string> {
    const value = await previewAiPayload({
      data: {
        caseId: activeCase.id,
        task: requestedTask,
        ...(requestedTask === "explain_finding" ? { alertId } : {}),
      },
    });
    return JSON.stringify(value.payload, null, 2).slice(0, 1500);
  }

  const taskReadiness = assessControlReadiness(task, {
    entityCount: activeCase.entities?.length ?? 0,
    transactionCount: activeCase.transactions?.length ?? 0,
    findingCount: analysis.alerts.length,
    eventCount: activeCase.events?.length ?? 0,
    hasDossier: Boolean(dossier && !demoMode),
  });
  const quickBlocked = !hasCase
    ? "Najprv vyberte prípad."
    : (aiUnavailableReason(status, "chat", isOnline) ??
      (!taskReadiness.ready ? taskReadiness.message : null) ??
      (task === "explain_finding" &&
      !analysis.alerts.some((a) => a.id === alertId)
        ? "Vyberte nález na vysvetlenie."
        : null));

  async function runQuickTask(requestedTask: AiTask = task) {
    const requestedReadiness = assessControlReadiness(requestedTask, {
      entityCount: activeCase.entities?.length ?? 0,
      transactionCount: activeCase.transactions?.length ?? 0,
      findingCount: analysis.alerts.length,
      eventCount: activeCase.events?.length ?? 0,
      hasDossier: Boolean(dossier && !demoMode),
    });
    const requestedBlocked =
      !hasCase
        ? "Najprv vyberte prípad."
        : (aiUnavailableReason(status, "chat", isOnline) ??
          (!requestedReadiness.ready ? requestedReadiness.message : null) ??
          (requestedTask === "explain_finding" &&
          !analysis.alerts.some((a) => a.id === alertId)
            ? "Vyberte nález na vysvetlenie."
            : null));
    if (requestedBlocked || requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      requestLock.current = false;
      setBusy(false);
      return;
    }

    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(activeCase.id, () =>
        buildTaskPreview(requestedTask),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
      );
      requestLock.current = false;
      setBusy(false);
      return;
    }
    if (!consentVersion) {
      toast.warning(AI_CONSENT_MISSING_MESSAGE);
      requestLock.current = false;
      setBusy(false);
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const value = await runAiTask({
        data: {
          caseId: activeCase.id,
          task: requestedTask,
          consentVersion,
          ...(requestedTask === "explain_finding" ? { alertId } : {}),
        },
      });
      setResult(value);
      if (value.status === "not_ready") {
        toast.warning(value.message ?? "Kontrola nie je pripravená.");
      } else if (value.status === "no_findings") {
        toast.message(value.message ?? "Kontrola nenašla žiadne nálezy.");
      } else if (value.status !== "ok") {
        toast.error(value.message ?? "Volanie AI zlyhalo.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Volanie AI zlyhalo.",
      );
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  async function showPreview() {
    try {
      const value = await previewAiPayload({
        data: {
          caseId: activeCase.id,
          task,
          ...(task === "explain_finding" ? { alertId } : {}),
        },
      });
      setPreview(JSON.stringify(value.payload, null, 2));
    } catch {
      toast.error("Náhľad sa nepodarilo zostaviť.");
    }
  }

  async function acceptSuggestion(suggestion: Suggestion) {
    const realId = output?.idMap?.transactions?.[suggestion.transaction];
    const transaction = activeCase.transactions.find((t) => t.id === realId);
    if (!transaction) {
      toast.error("Transakcia sa už nenašla — obnovte prípad.");
      return;
    }
    try {
      await upsertTransaction({
        data: {
          id: transaction.id,
          expectedRevision: revisions[transaction.id],
          caseId: activeCase.id,
          date: transaction.date,
          amount: transaction.amount,
          currency: transaction.currency,
          method: transaction.method,
          fromId: transaction.fromId,
          toId: transaction.toId,
          payerId: transaction.payerId,
          originCountry: transaction.originCountry,
          destinationCountry: transaction.destinationCountry,
          description: suggestion.normalized,
        },
      });
      setAccepted((prev) => ({ ...prev, [suggestion.transaction]: true }));
      toast.success("Popis transakcie bol aktualizovaný.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Aktualizácia zlyhala.",
      );
    }
  }

  const [copiedAttackId, setCopiedAttackId] = useState<string | null>(null);
  const [copiedJudgeText, setCopiedJudgeText] = useState(false);

  function handleCopyCounterStrike(attackId: string, text: string) {
    void navigator.clipboard.writeText(text).then(
      () => {
        setCopiedAttackId(attackId);
        toast.success("Protiúder bol skopírovaný do schránky.");
        setTimeout(() => setCopiedAttackId(null), 2000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }

  function handleCopyJudgeText() {
    if (!dossier) return;
    const fullText = `ROZSUDKOVÝ FORMÁT (§ 168 TP) — ${dossier.caseTitle}
Spis: ${dossier.caseId}

I. ZISTENÝ SKUTKOVÝ STAV:
${dossier.judgeReadyText.skutkovyStav}

II. VYPORIADANIE SA S OBHAJOBOU OBVINENÉHO:
${dossier.judgeReadyText.vyporiadanie}

III. VEDECKÉ ZHODNOTENIE STÔP (LR & METODIKA):
${dossier.judgeReadyText.vedecke}`;

    void navigator.clipboard.writeText(fullText).then(
      () => {
        setCopiedJudgeText(true);
        toast.success(
          "Kompletné odôvodnenie (§ 168 TP) skopírované do schránky.",
        );
        setTimeout(() => setCopiedJudgeText(false), 2000);
      },
      () => {
        toast.error("Kopírovanie do schránky zlyhalo.");
      },
    );
  }

  const idx = dossier?.defendabilityIndex ?? 0;
  const idxColor =
    idx >= 75
      ? "text-emerald-400"
      : idx >= 50
        ? "text-amber-400"
        : "text-rose-400";
  const idxBar =
    idx >= 75
      ? "[&>div]:bg-emerald-500"
      : idx >= 50
        ? "[&>div]:bg-amber-500"
        : "[&>div]:bg-rose-500";

  return (
    <PhoneFrame>
      <AppHeader title="Forenzný Autopilot">
        <p className="px-5 pb-1 text-xs text-foreground/80">
          1 Drop → 1 Obrazovka → 1 Export
        </p>
      </AppHeader>
      <Screen>
        <Globe />
        {/* Trvalé právne upozornenie ku každému AI výstupu. */}
        <div
          role="note"
          className="rounded-xl border border-risk-medium/40 bg-risk-medium/10 px-3 py-2 text-[11px] font-medium leading-snug text-foreground"
        >
          {AI_DISCLAIMER}
        </div>
        {/* Prepínač hlavného režimu */}
        <div className="flex rounded-xl liquid-glass-card border border-border p-1">
          <button
            onClick={() => setMainMode("autopilot")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all ${
              mainMode === "autopilot"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Forenzný Autopilot
          </button>
          <button
            onClick={() => setMainMode("quick_tasks")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-all ${
              mainMode === "quick_tasks"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Rýchle triážne úlohy
          </button>
        </div>

        {/* ═══ REŽIM 1: FORENZNÝ AUTOPILOT ═══ */}
        <div
          role="status"
          className="rounded-lg border border-border bg-card p-3 text-xs space-y-2"
        >
          <p>
            {aiUnavailableReason(
              status,
              mainMode === "autopilot" ? "analysis" : "chat",
              isOnline,
            ) ??
              "Mistral API kľúč je nastavený. Funkčnosť spojenia sa overí pri spustení."}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!isOnline || status.isFetching}
            onClick={() => void status.refetch()}
          >
            Obnoviť stav AI
          </Button>
        </div>

        {mainMode === "autopilot" && (
          <div className="space-y-4">
            {!isOnline ? (
              <Card className="border-risk-medium/30 bg-risk-medium/10 p-3 text-xs font-medium text-risk-medium">
                {OFFLINE_AI_MESSAGE}
              </Card>
            ) : null}
            {/* Header info */}
            <Card className="p-4 bg-muted/40 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-primary/15 p-2.5 text-primary">
                    <Shield className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">
                      Procesný audit spisu
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Trestný poriadok č. 301/2005 Z. z.
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      Výstup je AI pracovná analýza na overenie. Registry a
                      cross-border signály sú heuristiky z textu spisu — nie
                      live ORSR / RPVS.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setIsTourOpen(true)}
                    className="h-8 text-xs gap-1.5 border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer font-semibold shadow-xs"
                    title="Spustiť 6-krokového interaktívneho sprievodcu spisom pre obhajcu"
                  >
                    <Compass className="h-3.5 w-3.5" />
                    <span>Sprievodca spisom (1–6)</span>
                  </Button>
                  {dossier && (
                    <div className="text-right">
                      <span className="text-[10px] text-muted-foreground uppercase font-mono">
                        Index obhájiteľnosti
                      </span>
                      <div className={`text-xl font-bold ${idxColor}`}>
                        {idx}
                        <span className="text-xs text-muted-foreground">
                          /100
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {dossier && (
                <div className="flex items-center gap-2 pt-1 border-t border-border/40">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                      idx >= 75
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : idx >= 50
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        idx >= 75
                          ? "bg-emerald-400"
                          : idx >= 50
                            ? "bg-amber-400"
                            : "bg-rose-400 animate-pulse"
                      }`}
                    />
                    {idx >= 75
                      ? "VYSOKÁ SÚDNA NEPRIESTRELNOSŤ"
                      : idx >= 50
                        ? "PODMIENEČNÁ OBHÁJITEĽNOSŤ"
                        : "VÁŽNE PROCESNÉ RIZIKO"}
                  </span>
                </div>
              )}
            </Card>

            {/* DropZone / Upload */}
            {/* DropZone / Bulk Sandbox */}
            {!dossier ? (
              <div id="tour-upload-zone" className="space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.pdf,.docx,.xlsx,.csv,.json,.png,.jpg,.jpeg,.webp,.tiff,.html,.htm,.rtf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleQueueFiles(e.target.files);
                    }
                    e.target.value = "";
                  }}
                />

                {bulkFiles.length > 0 ? (
                  /* Staged Bulk Queue View */
                  <Card className="p-4 space-y-3 border-primary/40 bg-card">
                    <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <div className="rounded-lg bg-primary/15 p-2 text-primary">
                          <FileSpreadsheet className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-foreground">
                            Forenzný Sandbox — Pripravená dávka
                          </h4>
                          <p className="text-[11px] text-muted-foreground">
                            {bulkFiles.length}{" "}
                            {bulkFiles.length === 1
                              ? "súbor"
                              : bulkFiles.length < 5
                                ? "súbory"
                                : "súborov"}{" "}
                            (
                            {formatBytes(
                              bulkFiles.reduce((acc, f) => acc + f.size, 0),
                            )}
                            )
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleClearQueue}
                        className="text-xs h-7 text-muted-foreground hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Vyčistiť
                      </Button>
                    </div>

                    {/* Zoznam súborov vo fronte (spoločný komponent so Sandboxom) */}
                    <div className="max-h-56 overflow-y-auto pr-1">
                      <UploadFileList
                        files={bulkFiles.map((file) => ({
                          name: file.name,
                          size: file.size,
                          status: fileErrors[file.name] ? "failed" : "queued",
                          error: fileErrors[file.name],
                        }))}
                        onRemove={(name) => {
                          const index = bulkFiles.findIndex(
                            (file) => file.name === name,
                          );
                          if (index >= 0) handleRemoveQueueFile(index);
                        }}
                      />
                    </div>

                    {/* Akčné tlačidlá fronty */}
                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-border/50">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="w-full sm:w-auto text-xs h-9 cursor-pointer gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Pridať ďalšie
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleRunBulk(bulkFiles)}
                        disabled={
                          isProcessing ||
                          busy ||
                          Boolean(analysisBlocked) ||
                          bulkFiles.length === 0
                        }
                        className="w-full sm:flex-1 text-xs h-9 cursor-pointer gap-1.5 font-bold shadow-sm"
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {stage === "extracting" && "Extrahujem text..."}
                            {stage === "analyzing" && "Analyzujem spis..."}
                          </>
                        ) : (
                          <>
                            <Zap className="h-4 w-4" />
                            {isOnline
                              ? `Spustiť forenznú analýzu dávky (${bulkFiles.length})`
                              : "AI vyžaduje internet"}
                          </>
                        )}
                      </Button>
                    </div>
                  </Card>
                ) : (
                  /* Standard Drag and Drop Area */
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      if (
                        e.dataTransfer.files &&
                        e.dataTransfer.files.length > 0
                      ) {
                        handleQueueFiles(e.dataTransfer.files);
                      }
                    }}
                    onClick={() =>
                      !isProcessing && fileInputRef.current?.click()
                    }
                    className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all ${
                      isDragging
                        ? "border-primary bg-primary/10 scale-[1.01]"
                        : "border-border/80 bg-card hover:border-primary/50 hover:bg-accent/30"
                    } ${isProcessing ? "opacity-60 pointer-events-none" : ""}`}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <div>
                          <p className="text-sm font-medium">
                            {stage === "extracting" &&
                              "Extrahujem text zo spisu (PDF / OCR)..."}
                            {stage === "analyzing" &&
                              "Forenzný Autopilot analyzuje spis..."}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Spracovávam reťazec stôp a právne náležitosti
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-xl bg-primary/10 p-3 text-primary">
                          <UploadCloud className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-sm font-semibold">
                            Pretiahnite spisy, tabuľky transakcií alebo posudky
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Forenzný sandbox s podporou hromadného nahrávania a
                            OCR
                          </p>
                        </div>

                        {/* Format badges */}
                        <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5 text-[10px] text-muted-foreground max-w-sm">
                          <span className="rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 px-2 py-0.5 font-mono">
                            PDF (aj skeny / OCR)
                          </span>
                          <span className="rounded-md border border-blue-500/30 bg-blue-500/10 text-blue-300 px-2 py-0.5 font-mono">
                            DOCX / RTF
                          </span>
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 px-2 py-0.5 font-mono">
                            XLSX / XLS / CSV
                          </span>
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-300 px-2 py-0.5 font-mono">
                            TXT / MD / HTML / JSON
                          </span>
                          <span className="rounded-md border border-purple-500/30 bg-purple-500/10 text-purple-300 px-2 py-0.5 font-mono">
                            PNG / JPG / WEBP
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRef.current?.click();
                            }}
                            className="h-9 cursor-pointer"
                          >
                            Vybrať súbory z počítača
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDemoMode(true);
                              setDossier(loadDemoDossier());
                              setAnalysisWarnings([]);
                              setSaveError(null);
                              setAutopilotTab("timestory");
                              toast.success(
                                "Načítaná syntetická ukážka: Kauza ARMIVEX (fiktívne údaje — neukladá sa)",
                              );
                            }}
                            className="h-9 gap-1.5 border border-primary/40 bg-primary/15 font-semibold text-primary shadow-xs transition-all hover:border-primary/60 hover:bg-primary/25 cursor-pointer"
                          >
                            <Zap className="h-4 w-4 text-primary" />
                            <span>
                              ⚡ Načítať syntetickú ukážku (fiktívne údaje)
                            </span>
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Zobrazenie Dossieru (5 Kariet + Export) */
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-card/60 p-2.5 rounded-xl border border-border/60">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className="border-primary/40 text-primary font-mono text-xs shrink-0"
                    >
                      {dossier.caseId}
                    </Badge>
                    <span className="text-xs font-semibold text-foreground truncate">
                      {dossier.caseTitle}
                    </span>
                    {demoMode ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/40 text-amber-300 text-[10px] shrink-0"
                      >
                        DEMO
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSaveDossier}
                      disabled={isSavingDossier || demoMode}
                      className="h-8 text-xs gap-1.5 cursor-pointer border-primary/30 hover:bg-primary/10"
                      title={
                        demoMode
                          ? "Demo sa neukladá do produkčného prípadu"
                          : "Uložiť analýzu do prípadu"
                      }
                    >
                      {isSavingDossier ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : (
                        <Save className="h-3.5 w-3.5 text-primary" />
                      )}
                      <span>
                        {lastSavedAt
                          ? `Uložené (${lastSavedAt})`
                          : "Uložiť do prípadu"}
                      </span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleExportPDF()}
                      disabled={isExportingPdf}
                      className="h-8 text-xs gap-1.5 cursor-pointer font-medium"
                      title="Stiahnuť / vytlačiť AI pracovnú analýzu (PDF)"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>AI pracovná analýza (PDF)</span>
                    </Button>
                  </div>
                </div>

                {demoMode ? (
                  <Card className="border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                    Syntetická ukážka (Armivex) — fiktívne údaje. Neukladá sa do
                    produkčného prípadu a nie je výsledkom AI analýzy spisu.
                  </Card>
                ) : null}

                {analysisWarnings.length > 0 ? (
                  <Card className="border-risk-medium/30 bg-risk-medium/10 p-3 space-y-1">
                    {analysisWarnings.map((w) => (
                      <p
                        key={w}
                        className="text-xs font-medium text-risk-medium"
                      >
                        {w}
                      </p>
                    ))}
                  </Card>
                ) : null}

                {dossier.analysisMeta?.analysisStatus === "partial" ? (
                  <div
                    role="alert"
                    className="border border-risk-medium/30 bg-risk-medium/10 rounded-lg p-3 text-xs text-risk-medium space-y-2"
                  >
                    <p>
                      Výsledok je čiastočný — niektoré časti spisu sa nepodarilo
                      analyzovať. Pred použitím skontrolujte úplnosť zdrojov.
                    </p>
                    {(dossier.analysisMeta.chunks ?? []).some(
                      (c) => c.status === "failed",
                    ) ? (
                      <div className="space-y-1">
                        <ul className="list-disc pl-4 text-[11px]">
                          {(dossier.analysisMeta.chunks ?? [])
                            .filter((c) => c.status === "failed")
                            .map((c) => (
                              <li key={c.index}>
                                Časť {c.index}/{c.total}
                                {c.error ? `: ${c.error}` : ""}
                              </li>
                            ))}
                        </ul>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            isProcessing ||
                            !lastAutopilotDocumentText ||
                            !isOnline
                          }
                          onClick={() => void handleRetryFailedChunks()}
                        >
                          Znova analyzovať zlyhané časti
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {dossier.analysisMeta?.truncation.truncated ? (
                  <Card className="border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Spis bol skrátený alebo rozdelený na{" "}
                    {dossier.analysisMeta.truncation.chunkCount} častí (
                    {dossier.analysisMeta.truncation.analyzedChars.toLocaleString(
                      "sk-SK",
                    )}{" "}
                    /{" "}
                    {dossier.analysisMeta.truncation.inputChars.toLocaleString(
                      "sk-SK",
                    )}{" "}
                    znakov). Model: {dossier.analysisMeta.model} · prompt{" "}
                    {dossier.analysisMeta.promptVersion}.
                  </Card>
                ) : dossier.analysisMeta ? (
                  <p className="text-[10px] text-muted-foreground px-1">
                    AI pracovná analýza · {dossier.analysisMeta.model} · prompt{" "}
                    {dossier.analysisMeta.promptVersion} ·{" "}
                    {new Date(dossier.analysisMeta.createdAt).toLocaleString(
                      "sk-SK",
                    )}
                  </p>
                ) : null}

                {saveError ? (
                  <Card className="border-rose-500/30 bg-rose-500/10 p-3 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
                    <p className="text-xs text-rose-300">{saveError}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs shrink-0"
                      disabled={isSavingDossier || demoMode}
                      onClick={() => void handleSaveDossier()}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Retry uloženia
                    </Button>
                  </Card>
                ) : null}

                {(dossier.registryAnalysis || dossier.crossBorderAnalysis) && (
                  <Card className="border-border/60 bg-muted/30 p-3 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Heuristické odhady (nie live registry)
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {dossier.analysisMeta?.heuristicModulesNote ??
                        "registryAnalysis / crossBorderAnalysis sú AI odhady z textu spisu — nie live ORSR, RPVS ani Dimitri API."}
                    </p>
                    {dossier.registryAnalysis?.findings?.length ? (
                      <p className="text-xs">
                        Registry findings:{" "}
                        {dossier.registryAnalysis.findings.length} (neoverené)
                      </p>
                    ) : null}
                    {dossier.crossBorderAnalysis?.signals?.length ? (
                      <p className="text-xs">
                        Cross-border signals:{" "}
                        {dossier.crossBorderAnalysis.signals.length} (neoverené)
                      </p>
                    ) : null}
                  </Card>
                )}

                <Progress value={idx} className={`h-2 ${idxBar}`} />

                {/* ═══ RÝCHLY PREPÍNAČ POHĽADOV PRE OBHAJCU (§ 125 TP & TOKY) ═══ */}
                <div
                  id="tour-switcher"
                  className="rounded-xl border border-border bg-card/80 p-2 shadow-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between px-1 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                    <span>Forenzný Switcher pre obhajobu</span>
                    <span className="text-primary font-mono">
                      4 kľúčové perspektívy
                    </span>
                  </div>
                  <div
                    className={`grid grid-cols-2 gap-1.5 ${showTimestory ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
                  >
                    {showTimestory ? (
                      <button
                        type="button"
                        onClick={() => setAutopilotTab("timestory")}
                        className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
                          autopilotTab === "timestory"
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs"
                            : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
                        }`}
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          ⭐ 1. Pravda & Timestory
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setAutopilotTab("facts")}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
                        autopilotTab === "facts"
                          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-xs"
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
                      }`}
                    >
                      <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate">⏱️ Časová os spisu</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutopilotTab("transakcie")}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
                        autopilotTab === "transakcie"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs"
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
                      }`}
                    >
                      <Landmark className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">👥 Toky & Entity</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutopilotTab("rozpory")}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 px-2 text-xs font-semibold transition-all cursor-pointer ${
                        autopilotTab === "rozpory"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs"
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                      <span className="truncate">⚖️ Rozpory § 125</span>
                    </button>
                  </div>
                </div>

                <Tabs
                  value={autopilotTab}
                  onValueChange={setAutopilotTab}
                  className="space-y-3"
                >
                  <TabsList
                    className={`grid w-full h-auto p-1 gap-1 ${showTimestory ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5"}`}
                  >
                    {showTimestory ? (
                      <TabsTrigger
                        value="timestory"
                        className="text-[11px] py-1.5 gap-1 font-semibold text-amber-300 data-[state=active]:text-amber-200"
                      >
                        <Sparkles className="h-3 w-3 text-amber-400" />
                        <span className="truncate">1. Pravda & Timestory</span>
                      </TabsTrigger>
                    ) : null}
                    <TabsTrigger
                      value="otazky"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <HelpCircle className="h-3 w-3 text-primary" />
                      <span className="truncate">3 Otázky</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="rozpory"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <AlertTriangle className="h-3 w-3 text-rose-400" />
                      <span className="truncate">Rozpory</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="transakcie"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <Landmark className="h-3 w-3 text-emerald-400" />
                      <span className="truncate">Transakcie</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="facts"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <CheckCheck className="h-3 w-3 text-cyan-400" />
                      <span className="truncate">Fakty</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="defense"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <Gavel className="h-3 w-3 text-amber-400" />
                      <span className="truncate">Obhajoba</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="devils-advocate"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <BrainCircuit className="h-3 w-3 text-rose-400" />
                      <span className="truncate">👿 Devil&apos;s Advocate</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="admissibility"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <Scale className="h-3 w-3 text-cyan-400" />
                      <span className="truncate">⚖️ Procesná prípustnosť</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="custody-ledger"
                      className="text-[11px] py-1.5 gap-1"
                    >
                      <Link2 className="h-3 w-3 text-emerald-400" />
                      <span className="truncate">🔗 Dôkazný Ledger</span>
                    </TabsTrigger>
                  </TabsList>

                  {showTimestory ? (
                    <TabsContent value="timestory" className="space-y-3 m-0">
                      <TruthTimestorySection />
                    </TabsContent>
                  ) : null}

                  <TabsContent value="devils-advocate" className="space-y-3 m-0">
                    <Card className="p-3.5">
                      <DevilsAdvocatePanel
                        hypotheses={dossier.alternativeHypotheses ?? []}
                        onSimulate={() => {
                          setTask("alt_devil");
                          setMainMode("quick_tasks");
                          void runQuickTask("alt_devil");
                        }}
                      />
                    </Card>
                  </TabsContent>

                  <TabsContent value="admissibility" className="space-y-3 m-0">
                    <Card className="p-3.5">
                      <AdmissibilityAuditView audit={dossier.admissibilityAudit} />
                    </Card>
                  </TabsContent>

                  <TabsContent value="custody-ledger" className="space-y-3 m-0">
                    <Card className="p-3.5">
                      <CustodyLedgerViewer entries={dossier.custodyLedger ?? []} />
                    </Card>
                  </TabsContent>

                  {/* KARTA 1: 3 OTÁZKY (SOURCE OF TRUTH ÚBOK) */}
                  <TabsContent value="otazky" className="space-y-3 m-0">
                    <Card className="space-y-3 p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <HelpCircle className="h-3.5 w-3.5 text-primary" />{" "}
                          Source of Truth ÚBOK — 3 Hlavné vyšetrovacie otázky
                        </div>
                        <Badge
                          variant="outline"
                          className="border-primary/40 text-primary text-[10px]"
                        >
                          PPZ-51/UBOK
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        {[
                          dossier.investigativeAnswers?.q1_buyer_seller,
                          dossier.investigativeAnswers?.q2_planner_coordinator,
                          dossier.investigativeAnswers?.q3_financier,
                        ]
                          .filter(Boolean)
                          .map((q) => {
                            if (!q) return null;
                            return (
                              <div
                                key={q.questionNumber}
                                className="rounded-xl border border-border bg-card p-3.5 space-y-2.5 text-xs shadow-xs"
                              >
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 border-b border-border/50 pb-2">
                                  <h4 className="font-bold text-foreground text-sm flex items-center gap-2">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
                                      {q.questionNumber}
                                    </span>
                                    {q.question}
                                  </h4>
                                  <Badge
                                    variant="outline"
                                    className={
                                      q.confidenceLevel >= 90
                                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px]"
                                        : "border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px]"
                                    }
                                  >
                                    Preukázanosť: {q.confidenceLevel} %
                                  </Badge>
                                </div>

                                {/* Odpoveď */}
                                <div className="rounded-lg bg-muted/40 border border-border/60 p-2.5">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                                    Zistený skutkový záver:
                                  </p>
                                  <p className="text-foreground/95 leading-relaxed">
                                    {q.answer}
                                  </p>
                                </div>

                                {/* Stotožnené osoby */}
                                {q.identifiedPersons.length > 0 && (
                                  <div className="space-y-1">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                      Stotožnené osoby a role:
                                    </span>
                                    <div className="flex flex-wrap gap-1.5">
                                      {q.identifiedPersons.map((p, pIdx) => (
                                        <Badge
                                          key={pIdx}
                                          variant="secondary"
                                          className="text-[10px] font-medium bg-muted/60 border border-border/80"
                                        >
                                          <Users className="h-3 w-3 mr-1 text-primary/80" />
                                          {p}
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* Priame dôkazy */}
                                {q.directEvidence.length > 0 && (
                                  <div className="space-y-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                                      <CheckCheck className="h-3 w-3" /> Priame
                                      usvedčujúce dôkazy v spise:
                                    </span>
                                    <ul className="space-y-1 mt-1">
                                      {q.directEvidence.map((ev, eIdx) => (
                                        <li
                                          key={eIdx}
                                          className="text-[11px] text-foreground/90 flex items-start gap-1.5"
                                        >
                                          <span className="text-emerald-400 shrink-0 font-bold">
                                            •
                                          </span>
                                          <span>{ev}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {/* Chýbajúce dôkazy / neoverené hypotézy */}
                                {(q.missingEvidence.length > 0 ||
                                  q.unverifiedHypotheses.length > 0) && (
                                  <div className="space-y-1 rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />{" "}
                                      Úkony na doplnenie dokazovania (§ 119 TP):
                                    </span>
                                    <ul className="space-y-1 mt-1">
                                      {q.missingEvidence.map((me, mIdx) => (
                                        <li
                                          key={mIdx}
                                          className="text-[11px] text-foreground/80 flex items-start gap-1.5"
                                        >
                                          <span className="text-amber-400 shrink-0 font-bold">
                                            ⚠️
                                          </span>
                                          <span>{me}</span>
                                        </li>
                                      ))}
                                      {q.unverifiedHypotheses.map(
                                        (uh, uIdx) => (
                                          <li
                                            key={`uh-${uIdx}`}
                                            className="text-[11px] text-muted-foreground flex items-start gap-1.5"
                                          >
                                            <span className="text-muted-foreground shrink-0 font-bold">
                                              ?
                                            </span>
                                            <span>Hypotéza: {uh}</span>
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    </Card>
                  </TabsContent>

                  {/* KARTA 2: ROZPORY VO VÝPOVEDIACH & MATICA NEPRAVDIVOSTI */}
                  <TabsContent value="rozpory" className="space-y-3 m-0">
                    <Card id="tour-contradictions" className="space-y-3 p-3.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />{" "}
                          Rozpory vo výpovediach & Matica nepravdivosti
                        </div>
                        {dossier.testimonyContradictions && (
                          <Badge
                            variant="outline"
                            className="border-rose-500/30 text-rose-400 bg-rose-500/10 text-[10px]"
                          >
                            {dossier.testimonyContradictions.length} detegované
                            rozpory
                          </Badge>
                        )}
                      </div>

                      <p className="text-[11px] text-muted-foreground">
                        Porovnanie tvrdení obvinených a svedkov so zisteným
                        stavom spisu a návrhy procesného postupu (§ 125 TP
                        konfrontácia, § 142 TP znalecké dokazovanie).
                      </p>

                      <div className="space-y-3">
                        {dossier.testimonyContradictions?.map((c) => {
                          const deceitColor =
                            c.deceitPercentage >= 85
                              ? "text-rose-400 border-rose-500/30 bg-rose-500/10"
                              : c.deceitPercentage >= 70
                                ? "text-orange-400 border-orange-500/30 bg-orange-500/10"
                                : "text-amber-400 border-amber-500/30 bg-amber-500/10";

                          const barColor =
                            c.deceitPercentage >= 85
                              ? "[&>div]:bg-rose-500"
                              : c.deceitPercentage >= 70
                                ? "[&>div]:bg-orange-500"
                                : "[&>div]:bg-amber-500";

                          return (
                            <div
                              key={c.id}
                              className="rounded-xl border border-border bg-card p-3 space-y-2.5 text-xs shadow-xs"
                            >
                              {/* Header: Topic & Severity */}
                              <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-mono text-[10px] font-bold text-muted-foreground shrink-0">
                                    {c.id}
                                  </span>
                                  <h5 className="font-semibold text-foreground truncate">
                                    {c.topic}
                                  </h5>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={
                                    c.contradictionSeverity === "critical"
                                      ? "border-rose-500/40 text-rose-400 text-[9px] py-0"
                                      : c.contradictionSeverity === "high"
                                        ? "border-orange-500/40 text-orange-400 text-[9px] py-0"
                                        : "border-amber-500/40 text-amber-400 text-[9px] py-0"
                                  }
                                >
                                  {c.contradictionSeverity === "critical"
                                    ? "KRITICKÝ ROZPOR"
                                    : c.contradictionSeverity === "high"
                                      ? "VYSOKÝ ROZPOR"
                                      : "STREDNÝ ROZPOR"}
                                </Badge>
                              </div>

                              {/* Deceit meter */}
                              <div className="space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="text-muted-foreground font-medium">
                                    Odhadovaná miera nepravdivosti tvrdenia:
                                  </span>
                                  <span
                                    className={`font-bold font-mono px-2 py-0.5 rounded border text-[11px] ${deceitColor}`}
                                  >
                                    {c.deceitPercentage} % (Vyvrátené)
                                  </span>
                                </div>
                                <Progress
                                  value={c.deceitPercentage}
                                  className={`h-1.5 ${barColor}`}
                                />
                              </div>

                              {/* 2 Stĺpce: Tvrdenie vs. Konfrontácia */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5 space-y-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
                                    ⚠️ {c.personA.name} ({c.personA.status}):
                                  </p>
                                  <p className="italic text-foreground/90 text-[11px]">
                                    "{c.personA.claim}"
                                  </p>
                                </div>

                                <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-2.5 space-y-1">
                                  <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                                    🔍 Konfrontácia (
                                    {c.personB?.name ?? "Materiálny dôkaz"}):
                                  </p>
                                  <p className="text-foreground/90 text-[11px]">
                                    {c.personB
                                      ? `"${c.personB.claim}"`
                                      : c.factualRecord}
                                  </p>
                                </div>
                              </div>

                              {/* Skutočnosť podľa spisu */}
                              <div className="rounded-lg bg-muted/40 border border-border/70 p-2 space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                  Zistený skutkový stav podľa spisu:
                                </p>
                                <p className="text-foreground/90 text-[11px]">
                                  {c.factualRecord}
                                </p>
                              </div>

                              {/* Procesné riešenie */}
                              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-2 space-y-1">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                                  <Scale className="h-3 w-3" /> Procesný postup
                                  (§ 125 TP / § 142 TP):
                                </p>
                                <p className="text-foreground/90 text-[11px]">
                                  {c.proceduralResolution}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </TabsContent>

                  {/* KARTA 3: ANALÝZA TRANSAKCIÍ & FINANCOVANIA */}
                  <TabsContent value="transakcie" className="space-y-3 m-0">
                    <Card className="space-y-3 p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Landmark className="h-3.5 w-3.5 text-emerald-400" />{" "}
                          Analýza transakcií & Toky financií
                        </div>
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 text-emerald-400 text-[10px]"
                        >
                          § 233a TZ (Legalizácia)
                        </Badge>
                      </div>

                      {dossier.financialAnalysis && (
                        <>
                          {/* KPI Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                              <span className="text-[10px] uppercase font-mono text-muted-foreground">
                                Celkový objem
                              </span>
                              <p className="text-base font-bold text-foreground font-mono mt-0.5">
                                {dossier.financialAnalysis.totalVolume.toLocaleString(
                                  "sk-SK",
                                )}{" "}
                                €
                              </p>
                            </div>

                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-center">
                              <span className="text-[10px] uppercase font-mono text-rose-400 font-semibold">
                                Hotovosť
                              </span>
                              <p className="text-base font-bold text-rose-400 font-mono mt-0.5">
                                {dossier.financialAnalysis.cashVolume.toLocaleString(
                                  "sk-SK",
                                )}{" "}
                                €
                              </p>
                            </div>

                            <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-2.5 text-center">
                              <span className="text-[10px] uppercase font-mono text-blue-400 font-semibold">
                                Bankové prevody
                              </span>
                              <p className="text-base font-bold text-blue-400 font-mono mt-0.5">
                                {dossier.financialAnalysis.transferVolume.toLocaleString(
                                  "sk-SK",
                                )}{" "}
                                €
                              </p>
                            </div>

                            <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                              <span className="text-[10px] uppercase font-mono text-muted-foreground">
                                Podiel hotovosti
                              </span>
                              <p className="text-base font-bold text-amber-400 font-mono mt-0.5">
                                {dossier.financialAnalysis.cashRatioPercent} %
                              </p>
                            </div>
                          </div>

                          {/* Hotovostný pomer progress bar */}
                          <div className="rounded-lg border border-border/70 bg-muted/20 p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-rose-400">
                                Hotovosť:{" "}
                                {dossier.financialAnalysis.cashRatioPercent} %
                                (Smurfing & anonymné vklady)
                              </span>
                              <span className="font-semibold text-blue-400">
                                Prevody:{" "}
                                {(
                                  100 -
                                  dossier.financialAnalysis.cashRatioPercent
                                ).toFixed(1)}{" "}
                                %
                              </span>
                            </div>
                            <Progress
                              value={dossier.financialAnalysis.cashRatioPercent}
                              className="h-2 [&>div]:bg-rose-500"
                            />
                          </div>

                          {/* Podozrivé toky zoznam */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Podozrivé finančné toky (Red Flags)
                              </span>
                              <span className="text-[10px] font-mono text-muted-foreground">
                                {
                                  dossier.financialAnalysis.suspiciousFlows
                                    .length
                                }{" "}
                                záchytov
                              </span>
                            </div>

                            <div className="space-y-2">
                              {dossier.financialAnalysis.suspiciousFlows.map(
                                (flow) => (
                                  <div
                                    key={flow.id}
                                    className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs shadow-xs"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-[10px] text-muted-foreground">
                                          {flow.id}
                                        </span>
                                        <Badge
                                          variant="outline"
                                          className={
                                            flow.method === "cash_deposit"
                                              ? "border-rose-500/40 text-rose-400 bg-rose-500/10 text-[9px] py-0"
                                              : "border-blue-500/40 text-blue-400 bg-blue-500/10 text-[9px] py-0"
                                          }
                                        >
                                          {flow.method === "cash_deposit"
                                            ? "HOTOVOSŤ"
                                            : "PREVOD"}
                                        </Badge>
                                        <span className="font-mono text-[10px] text-muted-foreground">
                                          {flow.date}
                                        </span>
                                      </div>
                                      <span className="font-mono font-bold text-sm text-foreground">
                                        {flow.amount.toLocaleString("sk-SK")} €
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 text-[11px] text-foreground/90">
                                      <span className="font-medium text-muted-foreground truncate max-w-35">
                                        {flow.payer}
                                      </span>
                                      <ArrowRightLeft className="h-3 w-3 text-primary shrink-0" />
                                      <span className="font-medium text-foreground truncate max-w-35">
                                        {flow.recipient}
                                      </span>
                                    </div>

                                    <p className="text-[11px] text-muted-foreground">
                                      {flow.purpose}
                                    </p>

                                    {/* Red flag */}
                                    <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 p-2 flex items-start gap-1.5">
                                      <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                                      <span className="text-[11px] text-rose-300 leading-tight">
                                        {flow.redFlag}
                                      </span>
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>

                          {/* Záver financovania */}
                          <div className="rounded-xl bg-primary/5 border border-primary/20 p-3 space-y-1.5">
                            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                              <Scale className="h-3.5 w-3.5" /> Záver forenzného
                              vyšetrovania tokov financií
                            </div>
                            <p className="text-xs text-foreground/90 leading-relaxed">
                              {dossier.financialAnalysis.financingConclusion}
                            </p>
                          </div>
                        </>
                      )}
                    </Card>
                  </TabsContent>

                  {/* KARTA 4: FAKTY */}
                  <TabsContent value="facts" className="space-y-3 m-0">
                    <Card id="tour-timeline" className="space-y-3 p-3.5">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" /> Časová os a reťazec
                        zaistenia
                      </div>
                      <div className="space-y-2">
                        {(dossier.facts?.timeline ?? []).map((item, i) => (
                          <div
                            key={i}
                            className={`rounded-lg border p-2.5 text-xs ${
                              item.chainBreak
                                ? "border-rose-500/40 bg-rose-500/10"
                                : "border-border/60 bg-muted/20"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {item.time}
                              </span>
                              {item.chainBreak && (
                                <Badge
                                  variant="outline"
                                  className="border-rose-500/40 text-rose-400 text-[9px] py-0"
                                >
                                  ZLOM REŤAZCA{" "}
                                  {item.paragraph ? `· ${item.paragraph}` : ""}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 font-medium text-foreground/90">
                              {item.event}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Zdroj:{" "}
                              {formatSourceRef(item.sourceRef) || item.source}
                            </p>
                          </div>
                        ))}
                      </div>

                      <Separator className="my-2" />

                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Scan className="h-3.5 w-3.5" /> Stopy a semafor
                        integrity
                      </div>
                      <div className="grid gap-2">
                        {(dossier.facts?.traces ?? []).map((t) => {
                          const c = lightClasses(t.light);
                          return (
                            <div
                              key={t.id}
                              className={`rounded-lg border p-2.5 text-xs ${c.border} ${c.bg}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-mono font-bold text-muted-foreground">
                                  {t.id}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${c.text} ${c.border}`}
                                >
                                  {t.type}
                                </Badge>
                              </div>
                              <p className="mt-1 text-foreground/90">
                                {t.description}
                              </p>
                              {!t.chainComplete && (
                                <p className="mt-1 text-[11px] text-rose-400 font-medium">
                                  ⚠️ Reťazec nie je úplný
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </TabsContent>

                  {/* KARTA 5: OBHAJOBA & SÚDNA SILA */}
                  <TabsContent value="defense" className="space-y-3 m-0">
                    <Card id="tour-legal-audit" className="space-y-3 p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          <Gavel className="h-3.5 w-3.5 text-rose-400" />{" "}
                          Simulátor útoku advokáta
                        </div>
                        <Badge
                          variant="outline"
                          className={riskBadgeClasses(
                            dossier.defenseAttack?.overallRisk ?? "STREDNÉ",
                          )}
                        >
                          Riziko: {dossier.defenseAttack?.overallRisk ?? "—"}
                        </Badge>
                      </div>

                      <div className="space-y-3">
                        {(dossier.defenseAttack?.attacks ?? []).map((atk) => (
                          <div
                            key={atk.id}
                            className="rounded-xl border border-border bg-card p-3 space-y-2 text-xs"
                          >
                            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2.5">
                              <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider">
                                ⚖️ Obhajoba na súde povie:
                              </p>
                              <p className="mt-0.5 italic text-foreground/90">
                                {atk.defenseClaim}
                              </p>
                            </div>

                            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 space-y-1">
                              <div className="flex items-center justify-between">
                                <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
                                  🛡️ Váš protiúder (ako to vyvrátiť):
                                </p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyCounterStrike(
                                      atk.id,
                                      atk.counterStrike,
                                    )
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                                  title="Kopírovať protiúder"
                                >
                                  {copiedAttackId === atk.id ? (
                                    <>
                                      <Check className="h-3 w-3" />
                                      <span>Skopírované</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="h-3 w-3" />
                                      <span>Kopírovať</span>
                                    </>
                                  )}
                                </button>
                              </div>
                              <p className="text-foreground/90">
                                {atk.counterStrike}
                              </p>
                            </div>

                            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                              <span>Medzera v spise: {atk.evidenceGap}</span>
                              <Badge
                                variant="outline"
                                className={riskBadgeClasses(atk.risk)}
                              >
                                {atk.risk}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>

                      <Separator className="my-2" />

                      {/* Súdna sila a Likelihood Ratio */}
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5 text-cyan-400" />{" "}
                        Likelihood Ratio & Sila dôkazov
                      </div>
                      <div className="space-y-2">
                        {(dossier.evidenceStrength?.traces ?? []).map((t) => {
                          const c = lightClasses(t.light);
                          return (
                            <div
                              key={t.id}
                              className={`flex items-center justify-between rounded-lg border p-2.5 text-xs ${c.border} ${c.bg}`}
                            >
                              <div>
                                <p className="font-semibold text-foreground/90">
                                  {t.name}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {t.paragraph}
                                </p>
                              </div>
                              <div className="text-right">
                                {t.lr !== "—" && (
                                  <p className="font-mono text-xs font-bold">
                                    {t.lr}
                                  </p>
                                )}
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${c.text} ${c.border}`}
                                >
                                  {t.strength}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <Separator className="my-2" />

                      {/* Procesné paragrafy */}
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <FileText className="h-3.5 w-3.5 text-primary" />{" "}
                        Procesné paragrafy (Trestný poriadok)
                      </div>
                      <div className="space-y-1.5">
                        {(dossier.evidenceStrength?.paragraphs ?? []).map(
                          (p) => (
                            <div
                              key={p.para}
                              className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 p-2 text-xs"
                            >
                              <div>
                                <span className="font-mono font-bold text-foreground/90">
                                  {p.para}
                                </span>
                                <span className="ml-2 text-muted-foreground">
                                  {p.title}
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  p.status === "OK"
                                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                                    : p.status === "Narušené"
                                      ? "border-rose-500/30 text-rose-400 bg-rose-500/10"
                                      : "border-amber-500/30 text-amber-400 bg-amber-500/10"
                                }
                              >
                                {p.status}
                              </Badge>
                            </div>
                          ),
                        )}
                      </div>
                    </Card>
                  </TabsContent>
                </Tabs>

                {/* Export Card */}
                <Card
                  id="tour-export-pdf"
                  className="p-3.5 bg-primary/5 border-primary/20 space-y-3"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                        Export AI pracovnej analýzy
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Návrh odôvodnenia (§ 168 TP), PDF s pečaťou integrity a
                        uloženie do prípadu — nie znalecký posudok
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyJudgeText}
                        className="gap-1.5 text-xs h-8 cursor-pointer"
                      >
                        {copiedJudgeText ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                            Skopírované
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            Kopírovať text
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSaveDossier}
                        disabled={isSavingDossier}
                        className="gap-1.5 text-xs h-8 cursor-pointer border-primary/40 hover:bg-primary/10"
                        title="Uložiť vygenerovanú analýzu priamo do prípadu"
                      >
                        {isSavingDossier ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            Ukladám...
                          </>
                        ) : (
                          <>
                            <Save className="h-3.5 w-3.5 text-primary" />
                            {lastSavedAt
                              ? `Uložené (${lastSavedAt})`
                              : "Uložiť do prípadu"}
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void handleExportPDF()}
                        disabled={isExportingPdf}
                        className="gap-1.5 h-8 cursor-pointer font-semibold shadow-xs"
                        title="Vygenerovať A4 PDF (AI pracovná analýza) so SHA-256 pečaťou"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Stiahnuť AI pracovnú analýzu (PDF)
                      </Button>
                    </div>
                  </div>
                </Card>

                {/* Reset button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDossier(null);
                    setLastSavedAt(null);
                    setBulkFiles([]);
                    setFileErrors({});
                    setAutopilotTab("facts");
                  }}
                  className="w-full gap-1.5 text-muted-foreground"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Nahrať a analyzovať iný spis
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ═══ REŽIM 2: RÝCHLE TRIÁŽNE ÚLOHY (Pôvodná logika) ═══ */}
        {mainMode === "quick_tasks" && (
          <>
            {!isOnline ? (
              <Card className="border-risk-medium/30 bg-risk-medium/10 p-3 text-xs font-medium text-risk-medium">
                {OFFLINE_AI_MESSAGE}
              </Card>
            ) : null}
            <SectionTitle>Výber úlohy</SectionTitle>

            <div className="space-y-2">
              {(Object.keys(TASK_LABELS) as AiTask[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTask(t)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    task === t
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <p className="text-sm font-medium">{TASK_LABELS[t]}</p>
                </button>
              ))}
            </div>

            {task === "explain_finding" ? (
              <>
                <SectionTitle>Vyberte nález na vysvetlenie</SectionTitle>
                <div className="space-y-1.5">
                  {analysis.alerts.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setAlertId(a.id)}
                      className={`w-full rounded-md border p-2 text-left text-xs ${
                        alertId === a.id
                          ? "border-primary bg-primary/15"
                          : "border-border bg-card"
                      }`}
                    >
                      <span className="font-semibold">{a.title}</span>
                      <span className="ml-2 text-caption">({a.source})</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {quickBlocked && (
              <p role="status" className="text-xs text-risk-medium">
                {quickBlocked}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={() => void runQuickTask()}
                disabled={busy || isProcessing || Boolean(quickBlocked)}
                className="flex-1"
              >
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Bot className="mr-2 h-4 w-4" />
                )}
                {isOnline ? "Spustiť úlohu" : "AI vyžaduje internet"}
              </Button>
              <Button
                variant="outline"
                onClick={() => void showPreview()}
                disabled={!hasCase}
                className="gap-1.5"
              >
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline">Náhľad údajov</span>
              </Button>
            </div>

            {preview ? (
              <>
                <SectionTitle
                  action={
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      Skryť
                    </button>
                  }
                >
                  Údaje odosielané modelu
                </SectionTitle>
                <Card className="space-y-2 p-3 text-xs animate-fade-in">
                  <p className="text-caption">
                    Presne toto sa odošle poskytovateľovi (
                    {status.data?.providerName ?? "AI"}). Mená a identifikátory
                    sú nahradené pseudonymami; preklad späť prebieha na serveri.
                  </p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                    {preview}
                  </pre>
                </Card>
              </>
            ) : null}

            {result && (
              <p
                role={
                  result.status === "ok" || result.status === "no_findings"
                    ? "status"
                    : "alert"
                }
                data-ai-result={result.status}
                className="text-xs"
              >
                {result.status === "ok"
                  ? "Mistral dokončil úlohu."
                  : (result.message ?? "Kontrola bola dokončená bez nálezov.")}
              </p>
            )}
            {result?.status === "not_ready" ? (
              <Card className="space-y-2 p-3 text-xs">
                <p className="font-medium">{result.message}</p>
                {result.missing?.length ? (
                  <p className="text-muted-foreground">
                    Chýba: {result.missing.join(", ")}.
                  </p>
                ) : null}
              </Card>
            ) : null}

            {result?.status === "no_findings" ? (
              <Card className="space-y-2 p-3 text-xs text-muted-foreground">
                <p>
                  {result.control?.summary ??
                    result.message ??
                    "Kontrola nenašla žiadne nálezy."}
                </p>
              </Card>
            ) : null}

            {result?.status === "ok" &&
            (text ||
              (output?.hypotheses && output.hypotheses.length > 0) ||
              output?.courtReadySummary ||
              (suggestions && suggestions.length > 0)) ? (
              <>
                <SectionTitle>Výsledok</SectionTitle>
                {text ? (
                  <Card className="space-y-2 p-3 text-xs">
                    <p className="whitespace-pre-wrap">{text}</p>
                  </Card>
                ) : null}

                {output?.hypotheses?.map((h) => (
                  <Card key={h.id} className="space-y-2 p-3 text-xs">
                    <p className="font-semibold">{h.title}</p>
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {h.scenario}
                    </p>
                    {h.explainedEvidence && h.explainedEvidence.length > 0 ? (
                      <p>Vysvetľuje: {h.explainedEvidence.join("; ")}</p>
                    ) : null}
                    {h.requiredTracesIfTrue &&
                    h.requiredTracesIfTrue.length > 0 ? (
                      <p>
                        Ak pravda, v spise by muselo byť:{" "}
                        {h.requiredTracesIfTrue.join("; ")}
                      </p>
                    ) : null}
                    {h.rebuttalTest ? <p>Test: {h.rebuttalTest}</p> : null}
                  </Card>
                ))}

                {output?.courtReadySummary ? (
                  <Card className="space-y-2 p-3 text-xs">
                    <p className="font-semibold">
                      Procesný stav: {output.overallStatus ?? "—"}
                      {typeof output.score === "number"
                        ? ` (${output.score}/100)`
                        : ""}
                    </p>
                    <p className="whitespace-pre-wrap">
                      {output.courtReadySummary}
                    </p>
                    {output.defects?.map((d, i) => (
                      <div
                        key={`${d.paragraph}-${i}`}
                        className="rounded-md border border-border p-2"
                      >
                        <p className="font-medium">
                          {d.severity} · {d.paragraph}
                        </p>
                        <p className="text-muted-foreground">{d.description}</p>
                        <p>Náprava: {d.remedyAction}</p>
                      </div>
                    ))}
                  </Card>
                ) : null}

                {suggestions.map((s) => (
                  <Card
                    key={s.transaction}
                    className="flex items-start justify-between gap-2 p-3 text-xs"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{s.normalized}</p>
                      <p className="text-muted-foreground">
                        {s.transaction}
                        {s.counterparty ? ` · ${s.counterparty}` : ""}
                        {s.confidence ? ` · ${s.confidence}` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={Boolean(accepted[s.transaction])}
                      onClick={() => void acceptSuggestion(s)}
                    >
                      {accepted[s.transaction] ? "Prijaté" : "Prijať"}
                    </Button>
                  </Card>
                ))}
              </>
            ) : result?.status === "ok" ? (
              <Card className="p-3 text-xs text-muted-foreground">
                Úloha prebehla, ale výstup nemá zobraziteľný obsah.
              </Card>
            ) : null}
          </>
        )}

        {/* Interaktívny sprievodca pre obhajcu (1 - 6) */}
        <LawyerTourGuide
          isOpen={isTourOpen}
          onClose={() => setIsTourOpen(false)}
          onSelectStepAction={handleTourAction}
        />
      </Screen>
      <BottomNav />
      {consentDialog}
    </PhoneFrame>
  );
}

export default Assistant;
