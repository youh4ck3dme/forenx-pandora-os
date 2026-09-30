import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Shield,
  Zap,
  Loader2,
  RotateCcw,
  Compass,
  Trash2,
  Plus,
  FileSpreadsheet,
  UploadCloud,
  Save,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { LawyerTourGuide } from "./LawyerTourGuide";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
} from "./Shell";
import { Button } from "@/components/ui/button";
import { UploadFileList } from "@/components/malte/UploadFileList";
import { Badge } from "@/components/ui/badge";
import { Globe } from "@/components/ui/Globe";
import { Progress } from "@/components/ui/progress";
import { useActiveCase } from "@/hooks/useActiveCase";
import { OFFLINE_AI_MESSAGE, useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAiConsent } from "@/hooks/useAiConsent";
import {
  AI_CONSENT_MISSING_MESSAGE,
  buildFilesPreview,
} from "@/lib/ai-consent";
import { AI_DISCLAIMER } from "@/config/brand";
import { aiUnavailableReason } from "@/lib/ai/availability";
import {
  getAiStatus,
  runForensicAutopilot,
  extractBulkFilesText,
  MIN_EXTRACT_CHARS,
  saveCaseDossier,
  getForensicDossier,
  getForensicWorkflowRuns,
} from "@/lib/ai.functions";
import { getForenZXJobs } from "@/lib/forza/forenzx-mcp.functions";
import type { ForensicDossier } from "@/lib/types";
import { isDemoDossier } from "@/lib/autopilot-meta";
import { useVerifiedEvidence } from "@/hooks/useVerifiedEvidence";
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
  tooLargeForServerFnMessage,
} from "@/lib/upload-prep";
import { loadDemoDossier, formatBytes } from "./assistant/types";
import { useAssistantExport } from "./assistant/hooks/useAssistantExport";
import { useAssistantChat } from "./assistant/hooks/useAssistantChat";
import { AssistantExportCard } from "./assistant/AssistantExportCard";
import { QuickTasksSection } from "./assistant/QuickTasksSection";
import { AutopilotTabsView } from "./assistant/AutopilotTabsView";
import { ForensicWorkflowInspector } from "./assistant/ForensicWorkflowInspector";
import { exportDossierToPDF } from "@/lib/export-pdf";

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
  // Task 4: jediný zdroj väzby tvrdení = hash-overené dôkazy z WORM ledgera.
  const { knownEvidence } = useVerifiedEvidence(hasCase ? activeCase.id : null);
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
  const getForensicWorkflowRunsFn = useServerFn(getForensicWorkflowRuns);
  const getForenZXJobsFn = useServerFn(getForenZXJobs);
  const loadQuarantine = useServerFn(loadQuarantineDocuments);

  const [analysisWarnings, setAnalysisWarnings] = useState<string[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [isTourOpen, setIsTourOpen] = useState(false);

  useEffect(() => {
    if (dossier) setSharedDossier(dossier);
  }, [dossier, setSharedDossier]);

  // Hook pre export, podpis a ukladanie spisu
  const {
    isExportingPdf,
    isSavingDossier,
    lastSavedAt,
    saveError,
    copiedJudgeText,
    handleExportPDF,
    handleSaveDossier,
    handleCopyJudgeText,
    setLastSavedAt,
    setSaveError,
  } = useAssistantExport({
    dossier,
    activeCaseId: activeCase.id,
    demoMode,
    saveCaseDossierFn,
    knownEvidence,
  });

  // Hook pre rýchle triážne úlohy
  const {
    task,
    setTask,
    alertId,
    setAlertId,
    preview,
    setPreview,
    busy,
    result,
    accepted,
    quickBlocked,
    runQuickTask,
    showPreview,
    acceptSuggestion,
  } = useAssistantChat({
    activeCase,
    analysis,
    hasCase,
    isOnline,
    status,
    hasDossier: Boolean(dossier && !demoMode),
    demoMode,
    revisions,
    ensureConsent,
  });

  // Načítaj uložený dossier pre aktívny prípad
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
  }, [activeCase.id, getForensicDossierFn, setLastSavedAt, setSaveError]);

  const loadWorkflowRuns = useCallback(
    (caseId: string) => getForensicWorkflowRunsFn({ data: { caseId } }),
    [getForensicWorkflowRunsFn],
  );
  const loadForenZXJobs = useCallback(
    (caseId: string) => getForenZXJobsFn({ data: { caseId } }),
    [getForenZXJobsFn],
  );
  const loadCompletedDossier = useCallback(() => {
    if (!activeCase.id) return;
    void getForensicDossierFn({ data: { caseId: activeCase.id } }).then((res) => {
      if (res.success && res.dossier && !isDemoDossier(res.dossier)) {
        setDossier(res.dossier);
        toast.success("Trvalá forenzná analýza je dokončená.");
      }
    });
  }, [activeCase.id, getForensicDossierFn]);

  // Načítaj súbory z karantény cez staged sessionStorage
  useEffect(() => {
    const stageData = readQuarantineStage();
    const names = stageData?.names ?? [];
    if (!stageData || stageData.target !== "asistent" || names.length === 0) return;
    clearQuarantineStage();
    quarantineLoaded.current = true;
    void (async () => {
      try {
        const res = await loadQuarantine({ data: { names } });
        if (res && res.files?.length) {
          const files = res.files.map((f: { fileName: string; mime: string; base64: string }) =>
            quarantineBase64ToFile(f.fileName, f.mime, f.base64),
          );
          setBulkFiles((prev) => [...prev, ...files]);
          toast.info(`Prenesených ${files.length} dokumentov z karantény.`);
        }
      } catch (err) {
        console.debug("loadQuarantine fallback:", err);
      }
    })();
  }, [loadQuarantine]);

  const handleQueueFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const valid = list.filter((f) => f.size > 0);
    if (valid.length < list.length) {
      toast.warning("Niektoré súbory boli prázdne (0 B) a boli vynechané.");
    }
    if (valid.length === 0) return;
    setBulkFiles((prev) => {
      const existingNames = new Set(prev.map((f) => f.name));
      const newFiles = valid.filter((f) => !existingNames.has(f.name));
      if (newFiles.length < valid.length) {
        toast.info("Duplicitné súbory v dávke boli vynechané.");
      }
      return [...prev, ...newFiles];
    });
  }, []);

  const handleRemoveQueueFile = useCallback((index: number) => {
    setBulkFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearQueue = useCallback(() => {
    setBulkFiles([]);
    setFileErrors({});
  }, []);

  // Spustenie hromadnej extrakcie a analýzy dávky
  const handleRunBulk = useCallback(
    async (filesToProcess: File[]) => {
      if (filesToProcess.length === 0) {
        toast.error("Žiadne súbory na analýzu.");
        return;
      }
      if (requestLock.current) return;
      if (analysisBlocked) {
        toast.warning(analysisBlocked);
        return;
      }
      if (!isOnline) {
        toast.warning(OFFLINE_AI_MESSAGE);
        return;
      }

      requestLock.current = true;
      setIsProcessing(true);
      setStage("extracting");
      setFileErrors({});

      try {
        const consentCaseId = activeCase.id;
        const consentVersion = await ensureConsent(consentCaseId, () =>
          buildFilesPreview(filesToProcess),
        );
        if (!consentVersion) {
          toast.warning(AI_CONSENT_MISSING_MESSAGE);
          requestLock.current = false;
          setIsProcessing(false);
          setStage("idle");
          return;
        }

        type FileExtractRow = {
          fileName: string;
          success: boolean;
          text: string;
          usedOcr?: boolean;
          error?: string;
        };
        const results: FileExtractRow[] = [];
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
                  ...(payload.fileBase64 ? { fileBase64: payload.fileBase64 } : {}),
                  ...(payload.textContent ? { textContent: payload.textContent } : {}),
                },
              ],
              consentVersion: payload.consentVersion,
            },
          });

        for (const file of filesToProcess) {
          const isPdf = file.name.toLowerCase().endsWith(".pdf");

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

        if (analysisRes.success && analysisRes.workflowRun) {
          setDemoMode(false);
          setLastAutopilotDocumentText(aggregatedText);
          toast.success("Forenzná analýza bola zaradená do trvalého spracovania.");
        } else if (analysisRes.success && analysisRes.dossier) {
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
      setLastSavedAt,
      setSaveError,
    ],
  );

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
      if (analysisRes.success && analysisRes.workflowRun) {
        toast.success("Opakovanie bolo zaradené do trvalého spracovania.");
      } else if (analysisRes.success && analysisRes.dossier) {
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
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-60">
          <Globe />
        </div>
        <div className="relative z-10 space-y-4">
          {/* Trvalé právne upozornenie ku každému AI výstupu. */}
          <div
            role="note"
            className="rounded-xl border border-risk-medium/50 bg-black/85 backdrop-blur-md px-4 py-3 text-xs font-medium leading-relaxed text-neutral-100 shadow-md"
          >
            {AI_DISCLAIMER}
          </div>
          {/* Prepínač hlavného režimu */}
          <div className="flex rounded-xl bg-black/85 backdrop-blur-md border border-white/20 p-1 shadow-md">
            <button
              onClick={() => setMainMode("autopilot")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
                mainMode === "autopilot"
                  ? "bg-primary text-black shadow-md font-bold"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              Forenzný Autopilot
            </button>
            <button
              onClick={() => setMainMode("quick_tasks")}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
                mainMode === "quick_tasks"
                  ? "bg-primary text-black shadow-md font-bold"
                  : "text-neutral-300 hover:text-white"
              }`}
            >
              Rýchle triážne úlohy
            </button>
          </div>

          {/* Stav AI */}
          <div
            role="status"
            className="rounded-xl border border-white/20 bg-black/85 backdrop-blur-md p-4 text-xs space-y-3 text-white shadow-md"
          >
            <p className="text-neutral-200 font-medium leading-relaxed">
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
              className="bg-black/70 border-white/25 text-white hover:bg-white/15 hover:text-white font-semibold transition-all"
            >
              Obnoviť stav AI
            </Button>
          </div>

          {/* ═══ REŽIM 1: FORENZNÝ AUTOPILOT ═══ */}
          {mainMode === "autopilot" && (
            <div className="space-y-4">
              {!isOnline ? (
                <Card className="border-risk-medium/40 bg-black/85 backdrop-blur-md p-3 text-xs font-medium text-risk-medium">
                  {OFFLINE_AI_MESSAGE}
                </Card>
              ) : null}

              {/* Header info */}
              <Card className="p-4 bg-black/85 backdrop-blur-md border border-white/20 space-y-3 shadow-xl text-white">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/20 border border-primary/30 p-2.5 text-primary">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Procesný audit spisu
                      </h3>
                      <p className="text-xs text-neutral-300 font-medium">
                        Trestný poriadok č. 301/2005 Z. z.
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-neutral-300 font-medium">
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
                      className="h-8 text-xs gap-1.5 border border-primary/50 bg-primary/20 text-primary-300 hover:bg-primary/30 text-white cursor-pointer font-bold shadow-xs"
                      title="Spustiť 6-krokového interaktívneho sprievodcu spisom pre obhajcu"
                    >
                      <Compass className="h-3.5 w-3.5 text-primary" />
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

              {hasCase ? (
                <ForensicWorkflowInspector
                  caseId={activeCase.id}
                  loadRuns={loadWorkflowRuns}
                  loadForenZXJobs={loadForenZXJobs}
                  onCompleted={loadCompletedDossier}
                />
              ) : null}

              {/* DropZone / Upload Sandbox */}
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
                    <Card className="p-4 space-y-3 border-primary/40 bg-black/85 backdrop-blur-md text-white shadow-xl">
                      <div className="flex items-center justify-between border-b border-white/15 pb-2.5">
                        <div className="flex items-center gap-2">
                          <div className="rounded-lg bg-primary/20 border border-primary/30 p-2 text-primary">
                            <FileSpreadsheet className="h-4 w-4" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold text-white">
                              Forenzný Sandbox — Pripravená dávka
                            </h4>
                            <p className="text-[11px] text-neutral-300 font-medium">
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
                          className="text-xs h-7 text-neutral-300 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Vyčistiť
                        </Button>
                      </div>

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

                      <div className="flex flex-col sm:flex-row items-center gap-2 pt-1 border-t border-white/15">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isProcessing}
                          className="w-full sm:w-auto text-xs h-9 cursor-pointer gap-1.5 bg-black/80 border-white/25 text-white hover:bg-white/15 font-semibold"
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
                          className="w-full sm:flex-1 text-xs h-9 cursor-pointer gap-1.5 font-bold shadow-md bg-primary text-black hover:bg-primary/90"
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
                      className={`flex flex-col items-center justify-center gap-3.5 rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all shadow-2xl ${
                        isDragging
                          ? "border-primary bg-primary/25 scale-[1.01]"
                          : "border-white/30 bg-black/85 backdrop-blur-md hover:border-primary/60 hover:bg-black/90"
                      } ${isProcessing ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-8 w-8 animate-spin text-primary" />
                          <div>
                            <p className="text-sm font-bold text-white">
                              {stage === "extracting" &&
                                "Extrahujem text zo spisu (PDF / OCR)..."}
                              {stage === "analyzing" &&
                                "Forenzný Autopilot analyzuje spis..."}
                            </p>
                            <p className="text-xs text-neutral-300 mt-1 font-medium">
                              Spracovávam reťazec stôp a právne náležitosti
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-xl bg-primary/20 border border-primary/30 p-3 text-primary">
                            <UploadCloud className="h-6 w-6" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-white">
                              Pretiahnite spisy, tabuľky transakcií alebo posudky
                            </p>
                            <p className="text-xs text-neutral-200 mt-0.5 font-medium">
                              Forenzný sandbox s podporou hromadného nahrávania a
                              OCR
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center justify-center gap-1.5 pt-0.5 text-[10px] text-neutral-300 max-w-sm">
                            <span className="rounded-md border border-rose-500/50 bg-black/90 backdrop-blur-md text-rose-300 px-2.5 py-1 font-mono text-[11px] font-semibold shadow-xs">
                              PDF (aj skeny / OCR)
                            </span>
                            <span className="rounded-md border border-blue-500/50 bg-black/90 backdrop-blur-md text-blue-300 px-2.5 py-1 font-mono text-[11px] font-semibold shadow-xs">
                              DOCX / RTF
                            </span>
                            <span className="rounded-md border border-emerald-500/50 bg-black/90 backdrop-blur-md text-emerald-300 px-2.5 py-1 font-mono text-[11px] font-semibold shadow-xs">
                              XLSX / XLS / CSV
                            </span>
                            <span className="rounded-md border border-amber-500/50 bg-black/90 backdrop-blur-md text-amber-300 px-2.5 py-1 font-mono text-[11px] font-semibold shadow-xs">
                              TXT / MD / HTML / JSON
                            </span>
                            <span className="rounded-md border border-purple-500/50 bg-black/90 backdrop-blur-md text-purple-300 px-2.5 py-1 font-mono text-[11px] font-semibold shadow-xs">
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
                              className="h-9 px-4 cursor-pointer bg-black/90 backdrop-blur-md border border-white/30 hover:bg-white/15 text-white font-medium shadow-md transition-all"
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
                              className="h-9 px-4 gap-1.5 border border-primary/60 bg-black/90 backdrop-blur-md font-semibold text-primary shadow-md transition-all hover:border-primary hover:bg-primary/20 cursor-pointer"
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
                /* Zobrazenie Dossieru */
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-black/85 backdrop-blur-md p-3 rounded-xl border border-white/20 shadow-xl">
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
                    <Card className="border-amber-500/40 bg-black/75 backdrop-blur-md p-3 text-xs text-amber-200">
                      Syntetická ukážka (Armivex) — fiktívne údaje. Neukladá sa do
                      produkčného prípadu a nie je výsledkom AI analýzy spisu.
                    </Card>
                  ) : null}

                  {analysisWarnings.length > 0 ? (
                    <Card className="border-risk-medium/40 bg-black/75 backdrop-blur-md p-3 space-y-1">
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
                      className="border border-risk-medium/40 bg-black/75 backdrop-blur-md rounded-lg p-3 text-xs text-risk-medium space-y-2"
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

                  {/* 9 Záložiek spisu */}
                  <AutopilotTabsView
                    dossier={dossier}
                    showTimestory={Boolean(demoMode || isDemoDossier(dossier))}
                    autopilotTab={autopilotTab}
                    setAutopilotTab={setAutopilotTab}
                    knownEvidence={knownEvidence}
                    onSimulateDevilsAdvocate={() => {
                      setTask("alt_devil");
                      setMainMode("quick_tasks");
                      void runQuickTask("alt_devil");
                    }}
                  />

                  {/* Exportná karta */}
                  <AssistantExportCard
                    copiedJudgeText={copiedJudgeText}
                    isSavingDossier={isSavingDossier}
                    lastSavedAt={lastSavedAt}
                    isExportingPdf={isExportingPdf}
                    demoMode={demoMode}
                    onCopyJudgeText={handleCopyJudgeText}
                    onSaveDossier={() => void handleSaveDossier()}
                    onExportPDF={() => void handleExportPDF()}
                  />

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

          {/* ═══ REŽIM 2: RÝCHLE TRIÁŽNE ÚLOHY ═══ */}
          {mainMode === "quick_tasks" && (
            <QuickTasksSection
              isOnline={isOnline}
              hasCase={hasCase}
              task={task}
              setTask={setTask}
              alertId={alertId}
              setAlertId={setAlertId}
              alerts={analysis.alerts}
              quickBlocked={quickBlocked}
              busy={busy}
              isProcessing={isProcessing}
              runQuickTask={runQuickTask}
              showPreview={showPreview}
              preview={preview}
              setPreview={setPreview}
              status={status}
              result={result}
              accepted={accepted}
              acceptSuggestion={acceptSuggestion}
            />
          )}
        </div>

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
