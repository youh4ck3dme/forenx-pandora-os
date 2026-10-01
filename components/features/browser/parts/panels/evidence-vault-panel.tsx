"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { getSupabaseSessionToken } from "@/lib/forza/access-audit";
import { uploadEvidenceDirect, type PresignData } from "@/lib/storage/vault-upload-client";
import { EmptyState } from "@/components/malte/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Upload,
  ShieldCheck,
  FileText,
  Copy,
  Check,
  DownloadCloud,
  Sparkles,
  AlertTriangle,
  Loader2,
  HardDrive,
  RefreshCw,
  Clock,
} from "lucide-react";
import {
  EvidenceTag,
  ForensicEvidenceItem,
  IngestProgressState,
  Sha256Hash,
} from "@/lib/forza/vault-types";
import { useActiveCase } from "@/lib/hooks/useActiveCase";

export interface EvidenceVaultPanelProps {
  readonly caseId?: string;
  readonly onSendToAiAnalysis?: (item: ForensicEvidenceItem) => void;
}

// ─── KLASIFIKÁCIA FORENZNÝCH FORMÁTOV (MOBILNÝ TRIAGE, ALEAPP, iLEAPP, ANDRILLER) ───
function classifyEvidenceTags(fileName: string): EvidenceTag[] {
  const lower = fileName.toLowerCase();
  const tags: EvidenceTag[] = [];

  // Detekcia mobilných forenzných nástrojov
  if (lower.includes("aleapp")) {
    tags.push("aleapp_report", "mobilna_extrakcia");
  } else if (lower.includes("ileapp")) {
    tags.push("ileapp_backup", "mobilna_extrakcia");
  } else if (lower.includes("andriller")) {
    tags.push("andriller_triage", "mobilna_extrakcia");
  }

  // Archívy a extrakcie (.tar, .tar.gz, .tgz, .zip, .ab)
  if (
    lower.endsWith(".tar") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".ab") ||
    lower.endsWith(".zip")
  ) {
    if (!tags.includes("mobilna_extrakcia")) tags.push("mobilna_extrakcia");
  }

  // Databázy (.sqlite, .db, .sqlite3)
  if (lower.endsWith(".sqlite") || lower.endsWith(".db") || lower.endsWith(".sqlite3")) {
    tags.push("databaza");
  }

  // Systémové a auditné logy
  if (lower.endsWith(".log") || lower.endsWith(".txt")) {
    tags.push("log");
  }

  // Štandardné výpisy a zmluvy
  if (lower.endsWith(".csv")) {
    tags.push("vypis");
  } else if (lower.endsWith(".pdf")) {
    tags.push("zmluva");
  } else if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    tags.push("screenshot");
  } else if (lower.endsWith(".eml") || lower.endsWith(".msg")) {
    tags.push("komunikacia");
  }

  if (tags.length === 0) {
    tags.push("ine");
  }

  return Array.from(new Set(tags));
}

// ─── BEZPEČNÝ KLIENTSKY VÝPOČET HASHU ────────────────────────────
async function computeClientSha256(file: File): Promise<Sha256Hash> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").toLowerCase();
  return hex as Sha256Hash;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "kB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i] ?? "B"}`;
}

export const EvidenceVaultPanel: React.FC<EvidenceVaultPanelProps> = ({
  caseId: propCaseId,
  onSendToAiAnalysis,
}) => {
  // Rozlíšenie zobrazovaného názvu/čísla spisu od interného overeného UUID
  const activeCaseContext = useActiveCase();
  const rawId = propCaseId || activeCaseContext?.activeCaseId || activeCaseContext?.activeCase?.id || null;
  const isUuid = rawId ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId) : false;

  const matchedCase = activeCaseContext?.cases.find((c) => c.id === rawId || c.name === rawId);
  const effectiveCaseId = matchedCase?.id || (isUuid ? rawId : null);
  const displayCaseName = matchedCase?.name || activeCaseContext?.activeCase?.name || (isUuid ? effectiveCaseId : rawId) || "Nevybraný spis";

  const [ingestState, setIngestState] = useState<IngestProgressState>({ status: "idle" });
  const [items, setItems] = useState<readonly ForensicEvidenceItem[]>([]);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(false);

  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Zrušenie prebiehajúcich requestov pri odchode z panelu
  useEffect(() => {
    return () => {
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, []);

  // Načítanie zoznamu zaistených dôkazov pre daný spis
  const loadVaultItems = useCallback(async (cId: string | null) => {
    if (!cId) return;
    try {
      setIsLoadingList(true);
      const token = await getSupabaseSessionToken();
      const res = await fetch(`/api/vault?caseId=${encodeURIComponent(cId)}`, {
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        const data = (await res.json()) as { items: ForensicEvidenceItem[] };
        if (Array.isArray(data.items)) {
          setItems(data.items);
        }
      }
    } catch {
      // Tichý fallback pri offline režime
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (effectiveCaseId) {
      void loadVaultItems(effectiveCaseId);
    }
  }, [effectiveCaseId, loadVaultItems]);

  const handleCopyHash = useCallback((hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  }, []);

  // ─── SPRACOVANIE NAHRANIA SÚBORU S OCHRANOU PRED OOM ─────────────
  const processFileUpload = useCallback(
    async (file: File) => {
      if (!effectiveCaseId || effectiveCaseId.trim().length === 0) {
        setIngestState({
          status: "error",
          errorMessage: "Nie je vybraný žiadny aktívny spis. Vyberte spis v menu.",
        });
        return;
      }

      // Ochrana pred OOM (Flaw 1): Limit max 250 MB
      const MAX_BYTES = 250 * 1024 * 1024;
      if (file.size > MAX_BYTES) {
        setIngestState({
          status: "error",
          errorMessage: `Súbor (${formatBytes(file.size)}) prekračuje maximálny limit 250 MB.`,
        });
        return;
      }

      const controller = new AbortController();
      activeAbortControllerRef.current = controller;

      try {
        // Krok 1: Klientsky Pre-flight SHA-256 hash (WebCrypto)
        setIngestState({ status: "hashing", progressPercent: 25 });
        const clientHash = await computeClientSha256(file);

        if (controller.signal.aborted) return;

        // Krok 2: Autorizovaný Direct-to-S3 upload (obchádza 4.5 MB Vercel limit)
        setIngestState({ status: "uploading", progressPercent: 40, clientHash });

        const presignToken = await getSupabaseSessionToken();
        const presignRes = await fetch("/api/vault/presign", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(presignToken ? { authorization: `Bearer ${presignToken}` } : {}),
          },
          body: JSON.stringify({
            caseId: effectiveCaseId,
            fileName: file.name,
            fileSizeBytes: file.size,
            mimeType: file.type || "application/octet-stream",
            sha256Hash: clientHash,
          }),
          signal: controller.signal,
        });

        if (!presignRes.ok) {
          const errData = (await presignRes.json().catch(() => null)) as { error?: string } | null;
          // P3 Invariant: Pri 401/403 zastaviť upload; neskúšať alternatívnu cestu, ktorá obíde ochranu
          if (presignRes.status === 401 || presignRes.status === 403) {
            setIngestState({
              status: "error",
              errorMessage: errData?.error || "Prístup zamietnutý: Nemáte oprávnenie nahrávať dôkazy do tohto spisu.",
            });
            return;
          }
          setIngestState({
            status: "error",
            errorMessage: errData?.error || `Príprava nahrávania do trezoru zlyhala (HTTP ${presignRes.status}).`,
          });
          return;
        }

        const presignData = (await presignRes.json()) as PresignData & { success: boolean };
        if (!presignData.uploadUrl) {
          setIngestState({
            status: "error",
            errorMessage: "Server nevrátil autorizovanú URL pre upload do S3.",
          });
          return;
        }

        setIngestState({ status: "uploading", progressPercent: 70, clientHash });

        // Priamy PUT do S3 so všetkými podpísanými hlavičkami + zápis do ledgeru.
        const direct = await uploadEvidenceDirect({
          file,
          fileName: file.name,
          caseId: effectiveCaseId,
          sha256Hash: clientHash,
          presign: presignData,
          token: presignToken,
          signal: controller.signal,
        });

        if (!direct.ok) {
          setIngestState({
            status: "error",
            errorMessage: direct.stage === "ledger_commit"
              ? `Súbor bol nahratý do S3, no zápis do ledgeru dôkazov zlyhal: ${direct.error} Skúste to znova.`
              : `Upload do úložiska S3 zlyhal: ${direct.error}`,
          });
          return;
        }

        const tags = classifyEvidenceTags(file.name);
        const item: ForensicEvidenceItem = {
          id: (direct.evidenceId ??
            (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ev-${Date.now()}`)) as ForensicEvidenceItem["id"],
          caseId: effectiveCaseId as ForensicEvidenceItem["caseId"],
          fileName: file.name,
          fileSizeBytes: file.size,
          mimeType: file.type || "application/octet-stream",
          sha256Hash: clientHash,
          s3StorageKey: presignData.storageKey as ForensicEvidenceItem["s3StorageKey"],
          s3Bucket: presignData.bucket || "forenx-vault-sk",
          uploadedAt: new Date().toISOString(),
          uploadedBy: "investigator-session-user",
          integrityStatus: direct.integrityStatus,
          aiAnalyzed: false,
          tags,
        };

        setIngestState({ status: "ready", item });
        setItems((prev) => [item, ...prev.filter((p) => p.s3StorageKey !== item.s3StorageKey)]);
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          setIngestState({ status: "idle" });
          return;
        }
        setIngestState({
          status: "error",
          errorMessage: err instanceof Error ? err.message : "Neočakávaná chyba pri uploade do trezoru.",
        });
      } finally {
        activeAbortControllerRef.current = null;
      }
    },
    [effectiveCaseId]
  );

  // ─── ON-DEMAND SŤAHOVANIE CEZ FRESH PRESIGNED URL (Flaw 4) ────────
  const handleDownload = useCallback(async (storageKey: string, fileName: string) => {
    setDownloadingKey(storageKey);
    try {
      const dlToken = await getSupabaseSessionToken();
      const res = await fetch(`/api/vault?storageKey=${encodeURIComponent(storageKey)}&action=presign`, {
        headers: dlToken ? { authorization: `Bearer ${dlToken}` } : undefined,
      });
      if (!res.ok) {
        throw new Error("Zlyhalo získanie čerstvej URL z trezoru.");
      }
      const data = (await res.json()) as { url: string };
      const a = document.createElement("a");
      a.href = data.url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Nepodarilo sa stiahnuť dôkaz.";
      alert(msg);
    } finally {
      setDownloadingKey(null);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200 p-3 space-y-3 overflow-y-auto">
      {/* ─── HLAVIČKA PANELU ───────────────────────────────────────── */}
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
            <HardDrive className="w-4 h-4" />
            Hetzner S3 Evidence Vault
          </h2>
          <p className="text-[11px] text-zinc-400 font-mono mt-0.5 truncate max-w-50">
            Spis: <span className="text-zinc-200 font-semibold">{displayCaseName}</span>
          </p>
        </div>
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          S3 hel1
        </div>
      </div>

      {/* ─── DRAG & DROP ZÓNA ──────────────────────────────────────── */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void processFileUpload(file);
        }}
        className={`
          relative flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed
          transition-all duration-200 cursor-pointer text-center
          ${
            isDragOver
              ? "border-cyan-400 bg-cyan-950/30 shadow-[0_0_20px_rgba(6,182,212,0.25)]"
              : "border-zinc-800 hover:border-zinc-700 bg-zinc-900/40"
          }
        `}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          id="evidence-vault-file-input"
          name="evidenceFile"
          ref={fileInputRef}
          type="file"
          accept=".pdf,.csv,.tar,.gz,.tgz,.zip,.ab,.sqlite,.db,.sqlite3,.log,.xml,.json,.eml,.msg,.png,.jpg,.jpeg,.bin"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void processFileUpload(file);
          }}
        />

        <Upload className={`w-7 h-7 mb-1.5 ${isDragOver ? "text-cyan-400" : "text-zinc-500"}`} />
        <p className="text-xs font-medium text-zinc-300">
          Pretiahnite dôkaz (PDF, CSV, TAR/ZIP, SQLite, mobilná extrakcia ALEAPP/iLEAPP/Andriller)
        </p>
        <p className="text-[10px] text-zinc-500 mt-1 font-mono">
          SHA-256 pre-flight • Šifrované v Hetzner S3 (do 250 MB)
        </p>
      </div>

      {/* ─── STAV PREBIEHAJÚCEHO INGESTU ────────────────────────────── */}
      {ingestState.status !== "idle" && (
        <div className="p-2.5 rounded-lg border border-cyan-500/30 bg-cyan-950/20 text-xs space-y-1.5">
          {ingestState.status === "hashing" && (
            <div className="flex items-center gap-2 text-cyan-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Počítam WebCrypto SHA-256 pre-flight odtlačok...</span>
            </div>
          )}

          {ingestState.status === "uploading" && (
            <div className="space-y-1">
              <div className="flex justify-between text-zinc-300">
                <span className="flex items-center gap-1.5 text-[11px]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                  Streamujem do Hetzner S3...
                </span>
                <span className="font-mono text-cyan-400 text-[11px]">{ingestState.progressPercent}%</span>
              </div>
              <p className="text-[9px] font-mono text-zinc-500 truncate">
                Hash: {ingestState.clientHash}
              </p>
            </div>
          )}

          {ingestState.status === "error" && (
            <div className="flex items-start gap-2 text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-xs">Chyba zaistenia dôkazu</p>
                <p className="text-[11px] text-zinc-400">{ingestState.errorMessage}</p>
              </div>
            </div>
          )}

          {ingestState.status === "ready" && (
            <div className="flex items-center gap-2 text-emerald-400 font-medium text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>Dôkaz úspešne zaistený v S3 a overený!</span>
            </div>
          )}
        </div>
      )}

      {/* ─── ZOZNAM ZAISTENÝCH DÔKAZOV ─────────────────────────────── */}
      <div className="space-y-2 pt-1 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
            Zaistené dôkazy ({items.length})
          </span>
          <button
            type="button"
            onClick={() => void loadVaultItems(effectiveCaseId)}
            className="text-zinc-500 hover:text-zinc-300 p-1"
            title="Obnoviť zoznam z S3"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingList ? "animate-spin" : ""}`} />
          </button>
        </div>

        {isLoadingList && items.length === 0 ? (
          <div className="space-y-2" role="status" aria-label="Načítavam zoznam zaistených dôkazov">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <span className="sr-only">Načítavam zoznam zaistených dôkazov…</span>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="Zatiaľ žiadne zaistené dôkazy"
            detail="Nahrajte prvý súbor spisu (PDF, CSV, obrázok). Systém mu vypočíta SHA-256 a uloží ho do S3 trezora."
            action={
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/10 cursor-pointer"
              >
                Nahrať prvý dôkaz
              </button>
            }
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-lg border border-zinc-800/80 bg-zinc-900/50 hover:border-zinc-700 transition-colors space-y-1.5 text-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <span className="font-medium text-zinc-200 truncate">{item.fileName}</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                    {formatBytes(item.fileSizeBytes)}
                  </span>
                </div>

                {/* SHA-256 Hash riadok */}
                <div className="flex items-center justify-between p-1 rounded bg-black/40 border border-white/5 font-mono text-[9px] text-zinc-400">
                  <span className="truncate mr-1">SHA: {item.sha256Hash}</span>
                  <button
                    type="button"
                    onClick={() => handleCopyHash(item.sha256Hash)}
                    className="p-0.5 hover:text-white rounded hover:bg-white/10 shrink-0"
                    title="Kopírovať SHA-256 hash"
                  >
                    {copiedHash === item.sha256Hash ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>

                {/* Status integrity a akčné tlačidlá */}
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50">
                  <div>
                    {item.integrityStatus === "verified" ? (
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400">
                        <ShieldCheck className="w-3 h-3" />
                        INTEGRITA OVERENÁ
                      </span>
                    ) : item.integrityStatus === "checking" ? (
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-amber-400">
                        <Clock className="w-3 h-3 animate-pulse" />
                        OVERUJE SA SERVEROM
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-red-400">
                        <AlertTriangle className="w-3 h-3" />
                        INTEGRITA PORUŠENÁ
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={downloadingKey === item.s3StorageKey}
                      onClick={() => void handleDownload(item.s3StorageKey, item.fileName)}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-50"
                      title="Stiahnuť originál cez čerstvú Presigned S3 URL"
                    >
                      {downloadingKey === item.s3StorageKey ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <DownloadCloud className="w-3 h-3 text-cyan-400" />
                      )}
                      S3
                    </button>

                    {onSendToAiAnalysis && (
                      <button
                        type="button"
                        disabled={item.integrityStatus !== "verified"}
                        onClick={() => {
                          if (item.integrityStatus === "verified") {
                            onSendToAiAnalysis(item);
                          }
                        }}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                          item.integrityStatus === "verified"
                            ? "bg-purple-950/60 border border-purple-500/30 hover:bg-purple-900/60 text-purple-300 cursor-pointer"
                            : "bg-zinc-800/40 border border-zinc-700/30 text-zinc-500 cursor-not-allowed"
                        }`}
                        title={
                          item.integrityStatus === "verified"
                            ? "Odoslať overený súbor na forenznú analýzu do Mistral AI"
                            : "Analýza vyžaduje overený dôkaz (overenie serverom ešte neprebehlo)"
                        }
                      >
                        <Sparkles className="w-3 h-3 text-purple-400" />
                        AI
                      </button>
                    )}
                  </div>
                </div>

                {/* Značky a kategórie dôkazu (mobilná extrakcia, db, zmluva...) */}
                {Array.isArray(item.tags) && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {item.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.2 rounded bg-zinc-800/80 border border-zinc-700/40 text-[9px] font-mono text-zinc-400"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
