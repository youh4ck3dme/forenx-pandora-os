"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  Building2,
  Camera,
  Car,
  CheckCircle2,
  Crosshair,
  Loader2,
  MapPin,
  Scale,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  AppHeader,
  BottomNav,
  Card,
  PhoneFrame,
  Screen,
  SectionTitle,
} from "@/components/malte/Shell";
import { EmptyState } from "@/components/malte/EmptyState";
import { Button } from "@/components/ui/button";
import { StepProgress } from "@/components/malte/StepProgress";
import { NewCaseForm } from "@/components/malte/NewCaseForm";
import { UploadFileList } from "@/components/malte/UploadFileList";
import { ProcessingOverlay } from "@/components/malte/ProcessingOverlay";
import { useActiveCase } from "@/lib/hooks/useActiveCase";
import { OFFLINE_AI_MESSAGE, useOnlineStatus } from "@/lib/hooks/useOnlineStatus";
import { useAiConsent } from "@/lib/hooks/useAiConsent";
import {
  AI_CONSENT_MISSING_MESSAGE,
  AI_CONSENT_PREVIEW_FAILED_MESSAGE,
  buildDocumentPreview,
  buildFilesPreview,
} from "@/lib/forza/ai-consent";
import {
  extractBulkFilesText,
  parseUploadedCaseDocument,
  runAiTask,
  type AiTask,
} from "@/lib/forza/ai.functions";
import {
  assessControlReadiness,
  CASE_NOT_READY_MESSAGE,
  snapshotFromCounts,
} from "@/lib/forza/ai/control-readiness";
import { BRAND } from "@/config/brand";
import {
  assessPdfMemory,
  mapUploadNetworkError,
  partitionBySize,
  toUploadPayload,
  UPLOAD_ACCEPT,
} from "@/lib/forza/upload-prep";
import { applyAiResultsToCase } from "@/lib/forza/case-graph.functions";
import type { ProcessingStage } from "@/lib/forza/processing-progress";
import { loadQuarantineDocuments } from "@/lib/forza/quarantine.functions";
import {
  clearQuarantineStage,
  quarantineBase64ToFile,
  readQuarantineStage,
} from "@/lib/forza/quarantine-stage";
import {
  extractPdfViaPageOcr,
  PDF_SCAN_OCR_TOAST,
} from "@/lib/forza/pdf-page-ocr";

export default function SandboxPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background text-foreground" />}>
      <Sandbox />
    </Suspense>
  );
}

type FileState = {
  name: string;
  status: "queued" | "reading" | "done" | "failed";
  chars?: number;
  pages?: number;
  usedOcr?: boolean;
  error?: string;
  pdfHeaderOk?: boolean;
};

type Stats = {
  persons: { name: string; role?: string | undefined }[];
  places: string[];
  vehicles: string[];
  weapons: string[];
  companies: string[];
  paragraphs: string[];
  amounts: number[];
};

const emptyStats: Stats = {
  persons: [],
  places: [],
  vehicles: [],
  weapons: [],
  companies: [],
  paragraphs: [],
  amounts: [],
};

const CHECKS: { task: AiTask; label: string; detail: string }[] = [
  {
    task: "case_summary",
    label: "Zhrnutie prípadu",
    detail: "Prehľad faktov a hlavných tokov.",
  },
  {
    task: "normalize_descriptions",
    label: "Normalizácia popisov",
    detail: "Zjednotenie názvov a protistrán.",
  },
  {
    task: "admiss_audit",
    label: "Audit prípustnosti",
    detail: "Procesné vady a použiteľnosť dôkazov.",
  },
  {
    task: "alt_devil",
    label: "Alternatívne scenáre",
    detail: "Protiargumenty obhajoby.",
  },
];

type CheckState =
  | "idle"
  | "running"
  | "done"
  | "empty"
  | "not_ready"
  | "failed";

function money(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/([0-9][0-9\s.,]{2,})\s*(?:€|EUR|eur)\b/g)) {
    const raw = (m[1] ?? "").replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "");
    const value = Number(raw.replace(",", "."));
    if (Number.isFinite(value) && value > 0) out.push(value);
  }
  return out;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.filter(Boolean)));
}

function Sandbox() {
  const searchParams = useSearchParams();
  const search = {
    upload: searchParams.get("upload") ?? undefined,
    quarantine: searchParams.get("quarantine") ?? undefined,
    case: searchParams.get("case") ?? undefined,
  };
  const { activeCase, analysis, hasCase, refresh } = useActiveCase();
  const isOnline = useOnlineStatus();
  const { ensureConsent, consentDialog } = useAiConsent();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadPanel = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);
  const quarantineLoaded = useRef(false);
  const generation = useRef(0);

  const [files, setFiles] = useState<FileState[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] =
    useState<ProcessingStage | "idle">("idle");
  const [extractedText, setExtractedText] = useState("");

  const [checkStates, setCheckStates] = useState<Record<AiTask, CheckState>>({
    explain_finding: "idle",
    case_summary: "idle",
    normalize_descriptions: "idle",
    admiss_audit: "idle",
    alt_devil: "idle",
  });

  const [checkResults, setCheckResults] = useState<
    Partial<Record<AiTask, string>>
  >({});
  const [checkBusy, setCheckBusy] = useState<AiTask | null>(null);

  const readiness = useMemo(() => {
    return assessControlReadiness(
      "case_summary",
      snapshotFromCounts({
        entities: stats.persons.length + stats.companies.length,
        transactions: stats.amounts.length,
        findings: 0,
      }),
    );
  }, [stats]);

  const processFileList = async (fileList: File[]) => {
    if (fileList.length === 0) return;

    // Fail-closed: bez potvrdeného súhlasu sa údaje do AI neodosielajú.
    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(activeCase.id, () =>
        buildFilesPreview(fileList.map((f) => ({ name: f.name, size: f.size }))),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
      );
      return;
    }
    if (!consentVersion) return;

    setProcessing(true);
    setProcessingStage("uploading");

    const fileStates: FileState[] = fileList.map((f) => ({
      name: f.name,
      status: "queued",
    }));
    setFiles(fileStates);

    try {
      const payloads = await Promise.all(fileList.map(toUploadPayload));
      // Po jednom súbore: všetky naraz by prekročili limit tela požiadavky (Vercel ~4.5 MB).
      const result: { results: Awaited<ReturnType<typeof extractBulkFilesText>>["results"] } = { results: [] };
      for (const payload of payloads) {
        const single = await extractBulkFilesText({ data: { files: [payload], consentVersion } });
        result.results.push(...single.results);
      }
      let combined = "";

      result.results.forEach((r: any, idx: number) => {
        const fName = r.fileName || fileStates[idx]?.name || `Dokument_${idx + 1}`;
        combined += `\n--- SÚBOR: ${fName} ---\n${r.text || ""}`;
        fileStates[idx] = {
          name: fName,
          status: r.error ? "failed" : "done",
          chars: r.charCount || r.text?.length || 0,
          pages: r.pageCount,
          usedOcr: r.usedOcr,
          error: r.error,
        };
      });

      setFiles([...fileStates]);
      setExtractedText(combined);

      const parsed = await parseUploadedCaseDocument({
        data: { fileName: "sandbox_spisy.txt", textContent: combined, consentVersion },
      });

      if (parsed.entities) {
        setStats({
          persons: parsed.entities.persons || [],
          places: [],
          vehicles: parsed.entities.vehicles || [],
          weapons: parsed.entities.weapons || [],
          companies: (parsed.entities.companies || []).map((c: any) => typeof c === "string" ? c : c.name || ""),
          paragraphs: parsed.entities.legalParagraphs || [],
          amounts: [],
        });
      }

      if (parsed.entities?.persons?.length || parsed.entities?.companies?.length) {
        await applyAiResultsToCase({
          data: {
            caseId: activeCase.id,
            persons: (parsed.entities.persons || []).map((p: any) => ({
              name: p.name,
              ...(p.role ? { role: p.role } : {}),
            })),
            companies: (parsed.entities.companies || []).map((c: any) => typeof c === "string" ? c : c.name || ""),
          },
        });
      }

      refresh();
      toast.success("Spis bol úspešne spracovaný a entity boli vytvorené.");
    } catch (err: any) {
      toast.error(err?.message || "Spracovanie spisov zlyhalo.");
    } finally {
      setProcessing(false);
      setProcessingStage("idle");
    }
  };

  return (
    <PhoneFrame>
      <AppHeader title="AI Sandbox" />
      <Screen>
        {!hasCase ? (
          <Card className="space-y-3">
            <StepProgress step={1} label="Založenie prípadu" />
            <p className="text-sm font-semibold">Vytvorte prípad pre Sandbox</p>
            <NewCaseForm goToHub={false} />
          </Card>
        ) : (
          <>
            <Card className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider">
                    Aktívny prípad
                  </p>
                  <p className="text-base font-bold text-foreground">
                    {activeCase.name}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={processing}
                >
                  <Upload className="mr-1.5 h-4 w-4" />
                  Nahrať spisy
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const list = Array.from(e.target.files || []) as File[];
                    if (list.length > 0) void processFileList(list);
                  }}
                />
              </div>

              {files.length > 0 && <UploadFileList files={files} />}
            </Card>

            <SectionTitle>Detegované entity ({stats.persons.length + stats.companies.length})</SectionTitle>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Osoby</p>
                  <p className="text-sm font-bold">{stats.persons.length}</p>
                </div>
              </Card>
              <Card className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Firmy</p>
                  <p className="text-sm font-bold">{stats.companies.length}</p>
                </div>
              </Card>
              <Card className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Zbrane</p>
                  <p className="text-sm font-bold">{stats.weapons.length}</p>
                </div>
              </Card>
              <Card className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Suma</p>
                  <p className="text-sm font-bold">{stats.amounts.length}</p>
                </div>
              </Card>
            </div>

            <SectionTitle>Forenzné AI Kontroly</SectionTitle>
            <div className="grid gap-3 sm:grid-cols-2">
              {CHECKS.map((chk) => (
                <Card key={chk.task} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{chk.label}</p>
                    <Sparkles className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="text-xs text-muted-foreground">{chk.detail}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full mt-2"
                    disabled={checkBusy === chk.task}
                    onClick={async () => {
                      let consentVersion: string | null = null;
                      try {
                        consentVersion = await ensureConsent(activeCase.id, () =>
                          Promise.resolve(
                            `Spustenie kontroly: ${chk.label}\n${chk.detail}`,
                          ),
                        );
                      } catch (err: any) {
                        toast.error(
                          err instanceof Error
                            ? err.message
                            : "Príprava súhlasu zlyhala.",
                        );
                        return;
                      }
                      if (!consentVersion) return;

                      setCheckBusy(chk.task);
                      try {
                        const res = await runAiTask({
                          data: {
                            caseId: activeCase.id,
                            task: chk.task,
                            consentVersion,
                          },
                        });
                        setCheckResults((prev: any) => ({
                          ...prev,
                          [chk.task]:
                            res.output?.summary ||
                            res.control?.summary ||
                            res.message ||
                            "Hotovo.",
                        }));
                        toast.success(`Kontrola "${chk.label}" dokončená.`);
                      } catch (err: any) {
                        toast.error(err?.message || "Spustenie zlyhalo.");
                      } finally {
                        setCheckBusy(null);
                      }
                    }}
                  >
                    {checkBusy === chk.task ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : null}
                    Spustiť kontrolu
                  </Button>
                  {checkResults[chk.task] && (
                    <div className="mt-2 rounded-lg bg-accent/40 p-2.5 text-xs whitespace-pre-wrap">
                      {checkResults[chk.task]}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </Screen>
      <ProcessingOverlay
        active={processing}
        stage={processingStage === "idle" ? "preparing" : processingStage}
      />
      {consentDialog}
      <BottomNav />
    </PhoneFrame>
  );
}
