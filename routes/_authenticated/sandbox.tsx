import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
  runAiTask,
  type AiTask,
} from "@/lib/ai.functions";
import {
  assessControlReadiness,
  CASE_NOT_READY_MESSAGE,
  snapshotFromCounts,
} from "@/lib/ai/control-readiness";
import { BRAND } from "@/config/brand";
import {
  assessPdfMemory,
  mapUploadNetworkError,
  partitionBySize,
  toUploadPayload,
  UPLOAD_ACCEPT,
} from "@/lib/upload-prep";
import { applyAiResultsToCase } from "@/lib/case-graph.functions";
import type { ProcessingStage } from "@/lib/processing-progress";
import { loadQuarantineDocuments } from "@/lib/quarantine.functions";
import {
  clearQuarantineStage,
  quarantineBase64ToFile,
  readQuarantineStage,
} from "@/lib/quarantine-stage";
import {
  extractPdfViaPageOcr,
  PDF_SCAN_OCR_TOAST,
} from "@/lib/pdf-page-ocr";

export const Route = createFileRoute("/_authenticated/sandbox" as any)({
  validateSearch: (
    search: Record<string, unknown>,
  ): { upload?: "1"; case?: string; quarantine?: "1" } => ({
    ...(search["upload"] === "1" ? { upload: "1" as const } : {}),
    ...(typeof search["case"] === "string" && search["case"]
      ? { case: search["case"] }
      : {}),
    ...(search["quarantine"] === "1" ? { quarantine: "1" as const } : {}),
  }),
  head: () => ({
    meta: [
      { title: `AI Sandbox — ${BRAND.name}` },
      {
        name: "description",
        content:
          "Workspace pre nahrávanie spisov, extrakciu entít, evidence readiness a AI kontroly. Forenzný Autopilot je na /asistent.",
      },
      { property: "og:title", content: `AI Sandbox — ${BRAND.name}` },
      {
        property: "og:description",
        content:
          "Kontrola dôkazov a validačné úlohy. Plný Autopilot spúšťajte v sekcii Forenzný Autopilot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Sandbox,
});

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

/** Kontroly sa spúšťajú vždy v tomto logickom poradí. */
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
  "idle" | "running" | "done" | "empty" | "not_ready" | "failed";

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
  const { activeCase, analysis, hasCase, refresh } = useActiveCase();
  const isOnline = useOnlineStatus();
  const { ensureConsent, consentDialog } = useAiConsent();
  const search = Route.useSearch();
  const parseDoc = useServerFn(parseUploadedCaseDocument);
  const extractBulkTextFn = useServerFn(extractBulkFilesText);
  const runTask = useServerFn(runAiTask);
  const applyResults = useServerFn(applyAiResultsToCase);
  const loadQuarantine = useServerFn(loadQuarantineDocuments);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const uploadPanel = useRef<HTMLDivElement>(null);
  const autoOpened = useRef(false);
  const quarantineLoaded = useRef(false);
  // Každá zmena prípadu zvýši generáciu; neskoré výsledky starých operácií
  // sa potom zahodia a nezasiahnu obrazovku nového prípadu.
  const generation = useRef(0);

  const [files, setFiles] = useState<FileState[]>([]);
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [processing, setProcessing] = useState(false);
  const [processingStage, setProcessingStage] =
    useState<ProcessingStage>("preparing");
  const [currentItem, setCurrentItem] = useState(1);
  const [activeFileName, setActiveFileName] = useState("");
  const [aggregated, setAggregated] = useState("");
  const [analysing, setAnalysing] = useState(false);
  const [analysisDone, setAnalysisDone] = useState(false);
  const [keyFindings, setKeyFindings] = useState<string[]>([]);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [checkOutput, setCheckOutput] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [checksRunning, setChecksRunning] = useState(false);
  // Pripravené spisy čakajú na výslovné spustenie AI analýzy používateľom.
  const [pending, setPending] = useState<{
    text: string;
    fileCount: number;
    caseId: string;
    persons: Stats["persons"];
    companies: string[];
  } | null>(null);
  const busy = processing || analysing;

  // Dáta z DB (nie len lokálne načítaný súbor) určujú, či sú kontroly pripravené.
  const controlSnapshot = useMemo(
    () =>
      snapshotFromCounts({
        entities: activeCase.entities.length,
        transactions: activeCase.transactions.length,
        findings: analysis.alerts.length,
        events: activeCase.events.length,
        hasDossier: analysisDone,
      }),
    [
      activeCase.entities.length,
      activeCase.transactions.length,
      activeCase.events.length,
      analysis.alerts.length,
      analysisDone,
    ],
  );

  const controlReadiness = useMemo(() => {
    const byTask: Record<
      string,
      ReturnType<typeof assessControlReadiness>
    > = {};
    for (const check of CHECKS) {
      byTask[check.task] = assessControlReadiness(check.task, controlSnapshot);
    }
    return byTask;
  }, [controlSnapshot]);

  const anyControlReady = CHECKS.some(
    (c) => controlReadiness[c.task]?.ready === true,
  );
  const missingUnion = useMemo(() => {
    const set = new Set<string>();
    for (const check of CHECKS) {
      for (const m of controlReadiness[check.task]?.missing ?? []) set.add(m);
    }
    return Array.from(set);
  }, [controlReadiness]);

  // Zmena prípadu vyčistí stav sandboxu — spisy sa nikdy nepriradia k inému prípadu.
  useEffect(() => {
    generation.current += 1;
    setFiles([]);
    setUploadOpen(false);
    setProcessing(false);
    setAnalysing(false);
    setAnalysisDone(false);
    setStats(emptyStats);
    setAggregated("");
    setKeyFindings([]);
    setChecks({});
    setCheckOutput({});
    setPending(null);
    autoOpened.current = false;
    quarantineLoaded.current = false;
  }, [activeCase.id]);

  // Po obnovení z DB: entity/udalosti znamenajú, že analýza už bola persistovaná.
  useEffect(() => {
    if (
      activeCase.entities.length > 0 ||
      activeCase.events.length > 0 ||
      activeCase.transactions.length > 0
    ) {
      setAnalysisDone(true);
    }
  }, [
    activeCase.entities.length,
    activeCase.events.length,
    activeCase.transactions.length,
  ]);

  // Panel nahrávania sa otvorí len pre práve založený prípad z adresy —
  // nikdy pre starý prípad, ktorý ostal vybraný.
  useEffect(() => {
    if (search.upload !== "1" || !hasCase || autoOpened.current) return;
    if (!search.case || search.case !== activeCase.id) return;
    autoOpened.current = true;
    setUploadOpen(true);
    uploadPanel.current?.scrollIntoView({ block: "center" });
  }, [search.upload, search.case, hasCase, activeCase.id]);

  // Admin quarantine: načítaj staged súbory zo servera a vlož do upload fronty.
  useEffect(() => {
    if (search.quarantine !== "1" || !hasCase || quarantineLoaded.current)
      return;
    if (search.case && search.case !== activeCase.id) return;
    const stage = readQuarantineStage();
    if (
      !stage ||
      stage.target !== "sandbox" ||
      stage.caseId !== activeCase.id ||
      stage.names.length === 0
    ) {
      return;
    }
    quarantineLoaded.current = true;
    let cancelled = false;
    void (async () => {
      try {
        setUploadOpen(true);
        const res = await loadQuarantine({ data: { names: stage.names } });
        if (cancelled) return;
        const files = res.files.map((f: any) =>
          quarantineBase64ToFile(f.fileName, f.mime, f.base64),
        );
        clearQuarantineStage();
        toast.success(
          `Načítaných ${files.length} dokumentov z quarantine.`,
        );
        await handleFiles(files);
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
    // handleFiles je stabilné v rámci renderu; závisíme od case + search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.quarantine, search.case, hasCase, activeCase.id, loadQuarantine]);

  const done = files.filter((f) => f.status === "done").length;
  const progress = files.length ? Math.round((done / files.length) * 100) : 0;
  const totalMoney = useMemo(
    () => stats.amounts.reduce((sum, value) => sum + value, 0),
    [stats.amounts],
  );

  async function handleFiles(all: File[]) {
    if (all.length === 0) return;
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }
    if (busy) {
      toast.message("Počkajte, kým sa dokončí prebiehajúce spracovanie.");
      return;
    }
    // Príliš veľké ne-PDF odmietneme; veľké PDF idú cez stránkový OCR.
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
    const selected = [...accepted, ...oversizedPdfs];
    if (selected.length === 0) return;
    const runGen = generation.current;
    const caseId = activeCase.id;
    const alive = () =>
      generation.current === runGen && activeCase.id === caseId;

    // Bez potvrdeného súhlasu neodíde do AI žiadny obsah spisu.
    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(caseId, () =>
        buildFilesPreview(
          selected.map((f) => ({ name: f.name, size: f.size })),
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

    setProcessing(true);
    setProcessingStage("preparing");
    setCurrentItem(1);
    setActiveFileName(selected[0]?.name ?? "");
    setFiles(selected.map((f) => ({ name: f.name, status: "queued" })));
    setStats(emptyStats);
    setKeyFindings([]);
    setChecks({});
    setCheckOutput({});

    const texts: string[] = [];
    const collected: Stats = {
      persons: [],
      places: [],
      vehicles: [],
      weapons: [],
      companies: [],
      paragraphs: [],
      amounts: [],
    };

    for (let i = 0; i < selected.length; i++) {
      const file = selected[i]!;
      setProcessingStage("reading");
      setCurrentItem(i + 1);
      setActiveFileName(file.name);
      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: "reading" } : f)),
      );
      try {
        const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        const isPdfName = file.name.toLowerCase().endsWith(".pdf");
        const pdfHeaderOk = isPdfName
          ? head[0] === 0x25 &&
            head[1] === 0x50 &&
            head[2] === 0x44 &&
            head[3] === 0x46
          : undefined;

        // Počet strán zistíme z metadát; mnohostranové PDF na mobile zastavíme.
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
        collected.persons.push(...(result.entities?.persons ?? []));
        collected.vehicles.push(...(result.entities?.vehicles ?? []));
        collected.weapons.push(...(result.entities?.weapons ?? []));
        collected.companies.push(...(result.entities?.companies ?? []));
        collected.paragraphs.push(...(result.entities?.legalParagraphs ?? []));
        if (result.metadata?.location) {
          collected.places.push(result.metadata.location);
        }
        collected.amounts.push(...money(result.rawText ?? ""));

        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: "done",
                  chars: result.charCount,
                  usedOcr: result.usedOcr,
                  ...(pdfHeaderOk === undefined ? {} : { pdfHeaderOk }),
                }
              : f,
          ),
        );
      } catch (error) {
        const isPdf = file.name.toLowerCase().endsWith(".pdf");
        if (isPdf) {
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
              collected.amounts.push(...money(pageRes.text));
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

    const seen = new Map<string, Stats["persons"][number]>();
    for (const person of collected.persons) {
      if (person?.name && !seen.has(person.name)) seen.set(person.name, person);
    }
    const persons = Array.from(seen.values());
    const companies = uniq(collected.companies);
    setStats({
      persons,
      places: uniq(collected.places),
      vehicles: uniq(collected.vehicles),
      weapons: uniq(collected.weapons),
      companies,
      paragraphs: uniq(collected.paragraphs),
      amounts: collected.amounts,
    });

    if (!alive()) return;
    const joined = texts.join("\n\n\n");
    setAggregated(joined);
    setProcessing(false);

    if (joined.trim().length < 30) {
      setPending(null);
      toast.error("Z nahraných spisov sa nepodarilo prečítať žiadny text.");
      return;
    }
    // AI sa nespúšťa sama — čaká sa na výslovné potvrdenie používateľa.
    setPending({
      text: joined,
      fileCount: texts.length,
      caseId,
      persons,
      companies,
    });
    toast.success(
      "Spisy sú načítané. AI analýzu spustíte tlačidlom, kedy chcete.",
    );
  }

  /** AI analýza beží až na výslovný pokyn používateľa. */
  function startPendingAnalysis() {
    if (!pending || busy) return;
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }
    const job = pending;
    setPending(null);
    void runAnalysis(job.text, job.fileCount, generation.current, job.caseId, {
      persons: job.persons,
      companies: job.companies,
    });
  }

  /** Prenos extrahovaných entít do prípadu — plný Autopilot je na /asistent. */
  async function runAnalysis(
    _text: string,
    fileCount: number,
    runGen: number,
    caseId: string,
    found: { persons: Stats["persons"]; companies: string[] },
  ) {
    if (!caseId) return;
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      return;
    }
    const alive = () =>
      generation.current === runGen && activeCase.id === caseId;

    setAnalysing(true);
    setProcessingStage("analysing");
    setCurrentItem(fileCount);
    setActiveFileName(`${fileCount} spracovaných spisov`);
    try {
      setProcessingStage("saving");
      const applied = await applyResults({
        data: {
          caseId,
          persons: found.persons.map((p) => ({
            name: p.name,
            ...(p.role ? { role: p.role } : {}),
          })),
          companies: found.companies,
          timeline: [],
        },
      });
      if (!alive()) return;
      if (applied.entities + applied.events + applied.relations > 0) {
        toast.success(
          `Do prípadu pribudlo ${applied.entities} entít, ${applied.events} udalostí a ${applied.relations} prepojení.`,
        );
      }
      setKeyFindings([
        ...found.persons.slice(0, 4).map((p) => `Osoba: ${p.name}`),
        ...found.companies.slice(0, 3).map((c) => `Firma: ${c}`),
        "Plnú AI pracovnú analýzu spustite vo Forenznom Autopilote (/asistent).",
      ]);
      await refresh(caseId);
      if (!alive()) return;
      setAnalysisDone(true);
      toast.success(
        "Entity sú v prípade. Pokračujte Autopilotom pre AI analýzu a PDF.",
      );
      setProcessingStage("complete");
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    } catch (error) {
      if (!alive()) return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Prenos entít do prípadu zlyhal.",
      );
    } finally {
      if (alive()) setAnalysing(false);
    }
  }

  async function runChecksInOrder() {
    if (!activeCase.id) {
      toast.error("Najprv vyberte alebo vytvorte prípad.");
      return;
    }
    if (checksRunning) {
      toast.message("Kontroly už bežia.");
      return;
    }
    if (!isOnline) {
      toast.warning(OFFLINE_AI_MESSAGE);
      setMenuOpen(false);
      return;
    }
    if (!anyControlReady) {
      toast.warning(CASE_NOT_READY_MESSAGE);
      setMenuOpen(false);
      return;
    }
    const runGen = generation.current;
    const caseId = activeCase.id;
    const alive = () =>
      generation.current === runGen && activeCase.id === caseId;

    let consentVersion: string | null = null;
    try {
      consentVersion = await ensureConsent(caseId, () =>
        buildDocumentPreview(aggregated, files.length),
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

    setMenuOpen(false);
    setChecksRunning(true);
    for (const check of CHECKS) {
      if (!alive()) break;
      const localReady = controlReadiness[check.task];
      if (localReady && !localReady.ready) {
        setChecks((prev) => ({ ...prev, [check.task]: "not_ready" }));
        setCheckOutput((prev) => ({
          ...prev,
          [check.task]: `${CASE_NOT_READY_MESSAGE} Chýba: ${localReady.missing.join(", ")}.`,
        }));
        continue;
      }
      setChecks((prev) => ({ ...prev, [check.task]: "running" }));
      try {
        const result = await runTask({
          data: { caseId, task: check.task, consentVersion },
        });
        if (!alive()) break;
        if (result.status === "ok") {
          setChecks((prev) => ({ ...prev, [check.task]: "done" }));
          setCheckOutput((prev) => ({
            ...prev,
            [check.task]:
              result.control?.summary ??
              result.output?.summary ??
              result.output?.courtReadySummary ??
              result.output?.explanation ??
              "Kontrola dokončená.",
          }));
        } else if (result.status === "no_findings") {
          setChecks((prev) => ({ ...prev, [check.task]: "empty" }));
          setCheckOutput((prev) => ({
            ...prev,
            [check.task]:
              result.control?.summary ??
              result.message ??
              "Kontrola nenašla žiadne nálezy.",
          }));
        } else if (result.status === "not_ready") {
          setChecks((prev) => ({ ...prev, [check.task]: "not_ready" }));
          const missing = result.missing?.length
            ? ` Chýba: ${result.missing.join(", ")}.`
            : "";
          setCheckOutput((prev) => ({
            ...prev,
            [check.task]: (result.message ?? CASE_NOT_READY_MESSAGE) + missing,
          }));
        } else {
          setChecks((prev) => ({ ...prev, [check.task]: "failed" }));
          setCheckOutput((prev) => ({
            ...prev,
            [check.task]: result.message ?? "Kontrola zlyhala.",
          }));
        }
      } catch (error) {
        if (!alive()) break;
        setChecks((prev) => ({ ...prev, [check.task]: "failed" }));
        setCheckOutput((prev) => ({
          ...prev,
          [check.task]:
            error instanceof Error ? error.message : "Kontrola zlyhala.",
        }));
      }
    }
    if (alive()) setChecksRunning(false);
  }

  const statCards = [
    { label: "Osoby", value: stats.persons.length, icon: Users },
    { label: "Miesta", value: stats.places.length, icon: MapPin },
    { label: "Vozidlá", value: stats.vehicles.length, icon: Car },
    { label: "Zbrane", value: stats.weapons.length, icon: Crosshair },
    { label: "Firmy", value: stats.companies.length, icon: Building2 },
    { label: "Paragrafy", value: stats.paragraphs.length, icon: Scale },
  ];

  const hasStats =
    files.some((f) => f.status === "done") &&
    statCards.some((card) => card.value > 0);

  return (
    <PhoneFrame>
      <AppHeader title="AI Sandbox" brand back />
      <Screen>
        {!isOnline ? (
          <Card className="border-risk-medium/30 bg-risk-medium/10 p-3 text-xs font-medium text-risk-medium">
            {OFFLINE_AI_MESSAGE}
          </Card>
        ) : null}
        {!hasCase ? (
          <Card className="space-y-3">
            <StepProgress step={4} label="Nový prípad" />
            <div>
              <h2 className="text-base font-semibold tracking-tight">
                Nový prípad
              </h2>
              <p className="text-caption">
                Každý prípad má vlastný šifrovaný priestor, do ktorého AI ukladá
                prečítané spisy. Vidíte ich len vy.
              </p>
            </div>
            <NewCaseForm withSubtitle={false} goToSandbox={false} />
          </Card>
        ) : (
          <Card className="space-y-3">
            <StepProgress step={5} label="Spisy a AI" />
            <div>
              <p className="text-label">Šifrovaný priestor prípadu</p>
              <p className="text-sm font-semibold">{activeCase.name}</p>
            </div>
            <input
              ref={fileInput}
              id="sandbox-files"
              type="file"
              multiple
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                void handleFiles(selected);
              }}
            />
            {/* Fotoaparát telefónu — funguje aj bez webkamery, vrátane iPhonu (HEIC). */}
            <input
              ref={cameraInput}
              id="sandbox-camera"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={(event) => {
                const selected = Array.from(event.target.files ?? []);
                event.target.value = "";
                void handleFiles(selected);
              }}
            />
            {uploadOpen ? (
              <div
                ref={uploadPanel}
                role="group"
                aria-label="Nahrávanie spisov"
                className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3"
              >
                <p className="text-sm font-semibold">Nahrať spisy do prípadu</p>
                <p className="text-[11px] text-muted-foreground">
                  PDF, DOCX, XLSX, TXT, CSV, JSON a fotografie vrátane iPhone
                  HEIC. Skeny AI prečíta cez OCR. Maximálne 8 MB na súbor; fotky
                  sa pred odoslaním automaticky zmenšia.
                </p>
                <Button
                  type="button"
                  className="min-h-11 w-full"
                  disabled={busy || !isOnline}
                  onClick={() => fileInput.current?.click()}
                >
                  {processing ? (
                    <Loader2
                      className="mr-1.5 h-4 w-4 animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                  )}
                  {processing
                    ? "Spracúvam spisy…"
                    : isOnline
                      ? "Vybrať súbory"
                      : "AI vyžaduje internet"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 w-full"
                  disabled={busy || !isOnline}
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera className="mr-1.5 h-4 w-4" aria-hidden />
                  {isOnline ? "Odfotiť dokument" : "AI vyžaduje internet"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 w-full"
                  disabled={busy || !isOnline}
                  onClick={() => setUploadOpen(false)}
                >
                  Zrušiť nahrávanie
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={busy || !isOnline}
                onClick={() => setUploadOpen(true)}
              >
                <Upload className="mr-1.5 h-4 w-4" aria-hidden />
                {isOnline
                  ? "Nahrať spisy a fotografie"
                  : "AI vyžaduje internet"}
              </Button>
            )}
            {files.some((f) => f.status === "failed") && !busy ? (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full"
                disabled={!isOnline}
                onClick={() => {
                  setUploadOpen(true);
                  fileInput.current?.click();
                }}
              >
                Skúsiť nahrať znova
              </Button>
            ) : null}
            {files.length > 0 && !busy ? (
              <Button asChild variant="outline" className="min-h-11 w-full">
                <Link to="/prehlad">Prejsť na prehľad</Link>
              </Button>
            ) : null}
          </Card>
        )}

        {files.length > 0 ? (
          <>
            <SectionTitle>
              Spracovanie ({done}/{files.length})
            </SectionTitle>
            <Card className="space-y-3">
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <UploadFileList files={files} />
              {pending ? (
                <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-3">
                  <p className="text-[11px] text-muted-foreground">
                    Spisy sú načítané v prípade. AI analýza sa spustí až na váš
                    pokyn.
                  </p>
                  <Button
                    type="button"
                    className="min-h-11 w-full"
                    disabled={busy || !isOnline}
                    onClick={startPendingAnalysis}
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                    {isOnline
                      ? `Spustiť AI analýzu (${pending.fileCount})`
                      : "AI vyžaduje internet"}
                  </Button>
                </div>
              ) : null}
            </Card>
          </>
        ) : hasCase ? (
          <EmptyState
            icon={Upload}
            title="Sandbox je prázdny"
            detail="Nahrajte spisy alebo fotografie — AI ich prečíta, uloží do priestoru prípadu a spočíta štatistiky."
          />
        ) : null}

        {hasStats ? (
          <>
            <SectionTitle>Štatistika spisov</SectionTitle>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              {statCards.map(({ label, value, icon: Icon }) => (
                <Card key={label} className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div>
                    <p className="text-label">{label}</p>
                    <p className="text-metric">{value}</p>
                  </div>
                </Card>
              ))}
              <Card className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Banknote className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-label">Peniaze</p>
                  <p className="text-metric truncate">
                    {totalMoney.toLocaleString("sk-SK", {
                      style: "currency",
                      currency: "EUR",
                      maximumFractionDigits: 0,
                    })}
                  </p>
                </div>
              </Card>
            </div>
          </>
        ) : null}

        {analysing ? (
          <Card className="flex items-center gap-2 text-sm">
            <Loader2
              className="h-4 w-4 animate-spin text-primary"
              aria-hidden
            />
            Prenášam entity zo spisov do prípadu…
          </Card>
        ) : keyFindings.length > 0 ? (
          <>
            <SectionTitle>Nájdené entity</SectionTitle>
            <Card className="space-y-3">
              <ul className="space-y-2 text-sm">
                {keyFindings.map((finding) => (
                  <li key={finding} className="flex gap-2">
                    <Sparkles
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    <span>{finding}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="min-h-11 w-full">
                <Link to="/asistent">
                  <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                  Otvoriť Forenzný Autopilot
                </Link>
              </Button>
            </Card>
          </>
        ) : null}

        {Object.keys(checks).length > 0 || (!anyControlReady && hasCase) ? (
          <>
            <SectionTitle>Kontroly AI</SectionTitle>
            {!anyControlReady ? (
              <Card className="space-y-3">
                <p className="text-sm font-medium">{CASE_NOT_READY_MESSAGE}</p>
                {missingUnion.length > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    Chýbajúce dáta: {missingUnion.join(", ")}.
                  </p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  Nahrajte spisy a preniešte entity do prípadu. Plnú AI pracovnú
                  analýzu spustite vo Forenznom Autopilote.
                </p>
                {(pending || aggregated) && !analysing ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      className="min-h-11 w-full"
                      disabled={busy || !isOnline || (!pending && !aggregated)}
                      onClick={() => {
                        if (pending) startPendingAnalysis();
                        else
                          toast.message(
                            "Najprv nahrajte spisy a potom preniešte entity.",
                          );
                      }}
                    >
                      <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                      Preniesť entity do prípadu
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="min-h-11 w-full"
                    >
                      <Link to="/asistent">
                        Forenzný Autopilot (analýza + PDF)
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </Card>
            ) : null}
            {Object.keys(checks).length > 0 ? (
              <Card>
                <ul className="space-y-3">
                  {CHECKS.map((check) => {
                    const state = checks[check.task] ?? "idle";
                    return (
                      <li key={check.task} className="flex items-start gap-2">
                        <span className="mt-0.5 shrink-0">
                          {state === "done" ? (
                            <CheckCircle2
                              className="h-4 w-4 text-risk-low"
                              aria-hidden
                            />
                          ) : state === "empty" ? (
                            <CheckCircle2
                              className="h-4 w-4 text-muted-foreground"
                              aria-hidden
                            />
                          ) : state === "not_ready" ? (
                            <AlertTriangle
                              className="h-4 w-4 text-risk-medium"
                              aria-hidden
                            />
                          ) : state === "failed" ? (
                            <AlertTriangle
                              className="h-4 w-4 text-risk-high"
                              aria-hidden
                            />
                          ) : state === "running" ? (
                            <Loader2
                              className="h-4 w-4 animate-spin text-primary"
                              aria-hidden
                            />
                          ) : (
                            <span className="block h-4 w-4 rounded-full border border-border" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">
                            {check.label}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {checkOutput[check.task] ??
                              (controlReadiness[check.task]?.ready
                                ? check.detail
                                : `${CASE_NOT_READY_MESSAGE} Chýba: ${(controlReadiness[check.task]?.missing ?? []).join(", ") || "dáta prípadu"}.`)}
                          </span>
                          {state === "failed" ? (
                            <button
                              type="button"
                              className="mt-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                              disabled={checksRunning || !isOnline}
                              onClick={() => void runChecksInOrder()}
                            >
                              Skúsiť znova
                            </button>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : null}
          </>
        ) : null}
      </Screen>

      {/* Menu kontrol vpravo dole */}
      <div className="pointer-events-none fixed right-4 bottom-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))] z-50 flex flex-col items-end gap-2 lg:bottom-8">
        {menuOpen ? (
          <div className="pointer-events-auto w-64 rounded-2xl border border-border bg-card p-3 shadow-elevated">
            <div className="flex items-center justify-between pb-2">
              <p className="text-sm font-semibold">Kontroly AI</p>
              <button
                type="button"
                aria-label="Zavrieť menu kontrol"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            {!anyControlReady ? (
              <p className="pb-2 text-[11px] text-muted-foreground">
                {CASE_NOT_READY_MESSAGE}
                {missingUnion.length
                  ? ` Chýba: ${missingUnion.join(", ")}.`
                  : ""}
              </p>
            ) : (
              <ol className="space-y-1 text-[11px] text-muted-foreground">
                {CHECKS.map((check, index) => (
                  <li key={check.task}>
                    {index + 1}. {check.label}
                    {!controlReadiness[check.task]?.ready
                      ? " (nie je pripravená)"
                      : ""}
                  </li>
                ))}
              </ol>
            )}
            <Button
              type="button"
              className="mt-3 min-h-11 w-full"
              disabled={
                !hasCase ||
                analysing ||
                checksRunning ||
                !isOnline ||
                !anyControlReady
              }
              onClick={() => void runChecksInOrder()}
            >
              {isOnline
                ? anyControlReady
                  ? "Spustiť v poradí"
                  : "Najprv entity / Autopilot"
                : "AI vyžaduje internet"}
            </Button>
            {!anyControlReady && pending ? (
              <Button
                type="button"
                variant="outline"
                className="mt-2 min-h-11 w-full"
                disabled={busy || !isOnline}
                onClick={() => {
                  setMenuOpen(false);
                  startPendingAnalysis();
                }}
              >
                Preniesť entity do prípadu
              </Button>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Otvoriť kontroly AI"
          className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated active:scale-95 transition-transform"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Sparkles className="h-6 w-6" aria-hidden />
        </button>
      </div>

      <BottomNav />
      {consentDialog}
      <ProcessingOverlay
        active={busy}
        stage={processingStage}
        fileName={activeFileName}
        currentItem={currentItem}
        totalItems={pending?.fileCount ?? Math.max(files.length, 1)}
      />
    </PhoneFrame>
  );
}
