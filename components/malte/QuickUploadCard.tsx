import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/malte/Shell";
import {
  UploadFileList,
  type UploadFileItem,
} from "@/components/malte/UploadFileList";
import { ProcessingOverlay } from "@/components/malte/ProcessingOverlay";
import { useActiveCase } from "@/hooks/useActiveCase";
import { OFFLINE_AI_MESSAGE, useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useAiConsent } from "@/hooks/useAiConsent";
import {
  AI_CONSENT_MISSING_MESSAGE,
  AI_CONSENT_PREVIEW_FAILED_MESSAGE,
  buildDocumentPreview,
  buildFilesPreview,
} from "@/lib/ai-consent";
import {
  extractBulkFilesText,
  parseUploadedCaseDocument,
  runForensicAutopilot,
} from "@/lib/ai.functions";
import {
  applyAiResultsToCase,
  toTimelineInput,
} from "@/lib/case-graph.functions";
import {
  assessPdfMemory,
  mapUploadNetworkError,
  partitionBySize,
  toUploadPayload,
  UPLOAD_ACCEPT,
} from "@/lib/upload-prep";
import {
  extractPdfViaPageOcr,
  PDF_SCAN_OCR_TOAST,
} from "@/lib/pdf-page-ocr";
import type { ProcessingStage } from "@/lib/processing-progress";

/**
 * Rýchle nahratie spisov a fotografií priamo z prehľadu.
 * Funguje aj na mobile bez webkamery — cez fotoaparát telefónu aj z knižnice,
 * vrátane iPhone fotiek vo formáte HEIC.
 */
export function QuickUploadCard() {
  const { activeCase, refresh } = useActiveCase();
  const isOnline = useOnlineStatus();
  const { ensureConsent, consentDialog } = useAiConsent();
  const parseDoc = useServerFn(parseUploadedCaseDocument);
  const extractBulkTextFn = useServerFn(extractBulkFilesText);
  const autopilot = useServerFn(runForensicAutopilot);
  const applyResults = useServerFn(applyAiResultsToCase);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ProcessingStage>("preparing");
  const [currentItem, setCurrentItem] = useState(1);
  const [activeFileName, setActiveFileName] = useState("");
  const [pending, setPending] = useState<{
    caseId: string;
    text: string;
    fileCount: number;
    persons: { name: string; role?: string }[];
    companies: string[];
  } | null>(null);

  const hasCase = Boolean(activeCase.id) && activeCase.id !== "demo";

  async function handleFiles(all: File[]) {
    if (all.length === 0 || busy) return;
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }
    if (!hasCase) {
      toast.error("Najprv vyberte alebo vytvorte prípad.");
      return;
    }
    const { accepted, rejected } = partitionBySize(all);
    const oversizedPdfs = rejected
      .filter((r) => r.file.name.toLowerCase().endsWith(".pdf"))
      .map((r) => r.file);
    for (const item of rejected) {
      if (!item.file.name.toLowerCase().endsWith(".pdf")) {
        toast.error(item.reason);
      }
    }
    if (oversizedPdfs.length > 0) toast.info(PDF_SCAN_OCR_TOAST);
    const queue = [...accepted, ...oversizedPdfs];
    if (queue.length === 0) return;

    const caseId = activeCase.id;

    // Fail-closed: bez potvrdeného súhlasu nič neodchádza do AI.
    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(caseId, () =>
        buildFilesPreview(
          queue.map((f) => ({ name: f.name, size: f.size })),
        ),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
      );
      return;
    }
    if (!consentVersion) {
      toast.warning(AI_CONSENT_MISSING_MESSAGE);
      return;
    }

    setBusy(true);
    setStage("preparing");
    setCurrentItem(1);
    setActiveFileName(queue[0]?.name ?? "");
    setPending(null);
    setFiles(queue.map((f) => ({ name: f.name, status: "queued" })));

    const texts: string[] = [];
    const persons: { name: string; role?: string }[] = [];
    const companies: string[] = [];

    // Spisy sa spracúvajú po jednom, nikdy nie všetky naraz v pamäti.
    for (let i = 0; i < queue.length; i++) {
      const file = queue[i]!;
      setStage("reading");
      setCurrentItem(i + 1);
      setActiveFileName(file.name);
      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "reading" } : f)),
      );
      try {
        const { pages, blockedReason } = await assessPdfMemory(file);
        if (typeof pages === "number") {
          setFiles((prev) =>
            prev.map((f, idx) => (idx === i ? { ...f, pages } : f)),
          );
        }
        if (blockedReason) {
          toast.error(blockedReason);
          setFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, status: "failed", error: blockedReason } : f,
            ),
          );
          continue;
        }
        const payload = await toUploadPayload(file);
        const result = await parseDoc({
          data: { ...payload, consentVersion },
        });
        texts.push(
          `=== DOKUMENT: ${result.fileName} ===\n\n${result.rawText ?? ""}`,
        );
        for (const person of result.entities?.persons ?? []) {
          if (person?.name) {
            persons.push({
              name: person.name,
              ...(person.role ? { role: person.role } : {}),
            });
          }
        }
        companies.push(...(result.entities?.companies ?? []));
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: "done",
                  chars: result.charCount,
                  usedOcr: result.usedOcr,
                }
              : f,
          ),
        );
      } catch (error) {
        if (file.name.toLowerCase().endsWith(".pdf")) {
          try {
            toast.info(PDF_SCAN_OCR_TOAST);
            const pageRes = await extractPdfViaPageOcr(
              file,
              consentVersion,
              async (payload) =>
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
                }),
            );
            if (pageRes.success && pageRes.text.trim()) {
              texts.push(
                `=== DOKUMENT: ${file.name} ===\n\n${pageRes.text}`,
              );
              setFiles((prev) =>
                prev.map((f, idx) =>
                  idx === i
                    ? {
                        ...f,
                        status: "done",
                        chars: pageRes.text.length,
                        usedOcr: true,
                      }
                    : f,
                ),
              );
              continue;
            }
            throw new Error(pageRes.error || mapUploadNetworkError(error));
          } catch (ocrErr) {
            const message = mapUploadNetworkError(ocrErr);
            setFiles((prev) =>
              prev.map((f, idx) =>
                idx === i ? { ...f, status: "failed", error: message } : f,
              ),
            );
            continue;
          }
        }
        const message = mapUploadNetworkError(error);
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: "failed", error: message } : f,
          ),
        );
      }
    }

    const joined = texts.join("\n\n\n");
    setBusy(false);
    if (joined.trim().length < 30) {
      toast.error("Z nahraných spisov sa nepodarilo prečítať žiadny text.");
      return;
    }
    // Zjednodušený tok: súhlas už bol potvrdený, analýza beží hneď.
    const job = {
      caseId,
      text: joined,
      fileCount: texts.length,
      persons,
      companies,
    };
    setPending(job);
    await startAnalysis(job);
  }

  async function startAnalysis(given?: NonNullable<typeof pending>) {
    const job = given ?? pending;
    if (!job) return;
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }

    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(job.caseId, () =>
        buildDocumentPreview(job.text, job.fileCount),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : AI_CONSENT_PREVIEW_FAILED_MESSAGE,
      );
      return;
    }
    if (!consentVersion) {
      toast.warning(AI_CONSENT_MISSING_MESSAGE);
      return;
    }

    setPending(null);
    setBusy(true);
    setStage("analysing");
    setCurrentItem(job.fileCount);
    setActiveFileName(`${job.fileCount} spracovaných spisov`);
    if (job.text.length > 30_000) {
      toast.info(
        "Prebieha hĺbková analýza rozsiahleho spisu — môže trvať až 90 sekúnd.",
      );
    }
    try {
      const result = await autopilot({
        data: {
          caseId: job.caseId,
          documentText: job.text,
          fileName: `Prehľad (${job.fileCount} spisov)`,
          consentVersion,
        },
      });
      setStage("saving");
      if (result?.workflowRun) {
        refresh(job.caseId);
        toast.success(
          "Forenzná analýza bola zaradená do trvalého spracovania. Výsledky grafu doplňte po dokončení analýzy.",
        );
        setStage("complete");
        await new Promise((resolve) => window.setTimeout(resolve, 450));
        return;
      }
      const applied = await applyResults({
        data: {
          caseId: job.caseId,
          persons: job.persons,
          companies: job.companies,
          timeline: toTimelineInput(result?.dossier),
        },
      });
      refresh(job.caseId);
      toast.success(
        `AI doplnila ${applied.entities} entít, ${applied.events} udalostí a ${applied.relations} prepojení do grafu a časovej osi.`,
      );
      setStage("complete");
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Analýza AI zlyhala.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className="space-y-3">
        <div>
          <p className="text-sm font-semibold">Nahrať spis alebo fotografiu</p>
          <p className="text-[11px] text-muted-foreground">
            Odfoťte výsluch priamo telefónom alebo vyberte súbor z mobilu — PDF,
            DOCX, XLSX, TXT aj fotky vrátane iPhone HEIC. Maximum 8 MB na súbor.
          </p>
        </div>
        <input
          ref={fileInput}
          id="prehlad-files"
          type="file"
          multiple
          accept={UPLOAD_ACCEPT}
          className="sr-only"
          aria-label="Vybrať spisy alebo fotografie z telefónu"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void handleFiles(selected);
          }}
        />
        <input
          ref={cameraInput}
          id="prehlad-camera"
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          aria-label="Odfotiť dokument kamerou"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            event.target.value = "";
            void handleFiles(selected);
          }}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={busy || !isOnline || !hasCase}
            onClick={() => cameraInput.current?.click()}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Camera className="mr-1.5 h-4 w-4" aria-hidden />
            )}
            {busy ? "Spracúvam…" : "Odfotiť dokument"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full"
            disabled={busy || !isOnline || !hasCase}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" aria-hidden />
            Vybrať z telefónu
          </Button>
        </div>
        {!isOnline ? (
          <p className="text-[11px] font-medium text-risk-medium">
            {OFFLINE_AI_MESSAGE}
          </p>
        ) : null}
        <UploadFileList files={files} />
        {pending ? (
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={busy || !isOnline}
            onClick={() => void startAnalysis()}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            {`Spustiť AI analýzu (${pending.fileCount})`}
          </Button>
        ) : null}
        {consentDialog}
      </Card>
      <ProcessingOverlay
        active={busy}
        stage={stage}
        fileName={activeFileName}
        currentItem={currentItem}
        totalItems={pending?.fileCount ?? Math.max(files.length, 1)}
      />
    </>
  );
}
