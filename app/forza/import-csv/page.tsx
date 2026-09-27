"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Zap,
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
import { useActiveCase } from "@/hooks/useActiveCase";
import { upsertEntity, upsertTransaction } from "@/lib/forza/case-data";
import {
  detectDelimiter,
  parseDelimited,
  type DateFormat,
  type DecimalSeparator,
  type Delimiter,
  type Encoding,
} from "@/lib/forza/csv/parse";
import {
  EMPTY_MAPPING,
  MAPPING_LABELS,
  type ColumnMapping,
} from "@/lib/forza/csv/mapping";
import {
  detectBankFormat,
  type BankDetectionResult,
  type BankParseResult,
} from "@/lib/forza/csv/bank-detector";
import { parseBankCsvOffThread } from "@/lib/forza/csv-worker-client";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/forza/import.functions";

export default function ImportCsvPage() {
  return <CsvImportScreen />;
}

type Step = "file" | "mapping";

function CsvImportScreen() {
  const { activeCase, hasCase, refresh } = useActiveCase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [encoding, setEncoding] = useState<Encoding>("utf-8");
  const [delimiter, setDelimiter] = useState<Delimiter>(";");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD.MM.YYYY");
  const [decimalSep, setDecimalSep] = useState<DecimalSeparator>(",");

  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);

  const [detectedBank, setDetectedBank] = useState<BankDetectionResult | null>(
    null,
  );
  const [bankParseResult, setBankParseResult] =
    useState<BankParseResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Large-Data: ťažké parsovanie beží mimo UI vlákna (worker/chunked).
  const processCsvText = async (
    text: string,
    forcedDelim?: Delimiter,
  ) => {
    setIsProcessing(true);
    const delim = forcedDelim || detectDelimiter(text).value || ";";
    setDelimiter(delim);

    const rows = parseDelimited(text, delim);
    if (rows.length < 2) {
      toast.error("Súbor neobsahuje dostatok riadkov.");
      return;
    }

    const headers = rows[0]!;
    const bodyRows = rows.slice(1, IMPORT_MAX_ROWS + 1);

    setRawHeaders(headers);
    setRawRows(bodyRows);

    // Detekcia bankového formátu
    const detected = detectBankFormat(headers, bodyRows.slice(0, 10));
    setDetectedBank(detected);

    if (detected) {
      setMapping(detected.mapping);
      setDateFormat(detected.dateFormat);
      setDecimalSep(detected.decimalSeparator);
    } else {
      setMapping(EMPTY_MAPPING);
    }

    // Parsovanie cez bank-detector
    const parsed = await parseBankCsvOffThread(text, {
      ownAccountName: activeCase?.name || "Vlastný účet",
    });
    setBankParseResult(parsed);

    setStep("mapping");
    setIsProcessing(false);
  };

  const handleFileSelect = async (f: File) => {
    if (f.size > IMPORT_MAX_BYTES) {
      toast.error(
        `Súbor je príliš veľký (max ${IMPORT_MAX_BYTES / (1024 * 1024)} MB).`,
      );
      return;
    }
    setFile(f);
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || "";
        setFileText(text);
        void processCsvText(text);
      };
      reader.readAsText(f, encoding);
    } catch {
      toast.error("Čítanie súboru zlyhalo.");
    }
  };

  const handleOneClickImport = async () => {
    if (!activeCase?.id) {
      toast.error("Vyberte aktívny prípad.");
      return;
    }

    const txsToImport = bankParseResult?.transactions ?? [];
    if (txsToImport.length === 0) {
      toast.error("Žiadne platné transakcie na import.");
      return;
    }

    setIsProcessing(true);
    try {
      const entityCache = new Map<string, string>();
      for (const ent of activeCase.entities || []) {
        entityCache.set(ent.name.trim().toLowerCase(), ent.id);
      }

      const getOrCreateEntity = async (name: string): Promise<string> => {
        const cleanName = name.trim();
        const key = cleanName.toLowerCase();
        if (entityCache.has(key)) {
          return entityCache.get(key)!;
        }
        const id = crypto.randomUUID();
        await upsertEntity({
          data: {
            id,
            caseId: activeCase.id,
            name: cleanName,
            kind: "company",
          },
        });
        entityCache.set(key, id);
        return id;
      };

      const ownEntityName = activeCase.name || "Hlavný účet";
      const ownEntityId = await getOrCreateEntity(ownEntityName);

      let importedCount = 0;
      for (const tx of txsToImport) {
        const partnerName =
          tx.counterpartyName || tx.counterparty || "Neznámy partner";
        const partnerEntityId = await getOrCreateEntity(partnerName);

        const fromId = tx.amount > 0 ? partnerEntityId : ownEntityId;
        const toId = tx.amount > 0 ? ownEntityId : partnerEntityId;

        await upsertTransaction({
          data: {
            id: crypto.randomUUID(),
            caseId: activeCase.id,
            date: tx.date,
            amount: Math.abs(tx.amount),
            currency: tx.currency || "EUR",
            method: tx.method || "transfer",
            fromId,
            toId,
            description: tx.description || "",
          },
        });
        importedCount++;
      }

      await refresh();
      toast.success(
        `Úspešne importovaných ${importedCount} transakcií na 1 klik do spisu.`,
      );
      resetImport();
    } catch (err) {
      console.error(err);
      toast.error("Import zlyhal. Skontrolujte dáta súboru.");
    } finally {
      setIsProcessing(false);
    }
  };

  const resetImport = () => {
    setStep("file");
    setFile(null);
    setFileText("");
    setDetectedBank(null);
    setBankParseResult(null);
    setRawHeaders([]);
    setRawRows([]);
    setMapping(EMPTY_MAPPING);
  };

  if (!hasCase) {
    return (
      <PhoneFrame>
        <AppHeader title="Import CSV" />
        <Screen>
          <EmptyState
            title="Najprv vyberte alebo vytvorte prípad"
            detail="Transakcie z CSV súboru sa priradia k aktívnemu prípadu."
          />
        </Screen>
        <BottomNav />
      </PhoneFrame>
    );
  }

  const validCount = bankParseResult?.validCount ?? rawRows.length;

  return (
    <PhoneFrame>
      <AppHeader title="Import bankového výpisu (CSV)" />
      <Screen>
        <Card className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FileUp className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Import výpisov z účtu
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Podporuje slovenský aj český formát CSV (Tatra banka, SLSP, VÚB,
                ČSOB, Fio).
              </p>
            </div>
          </div>

          {step === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void handleFileSelect(f);
              }}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.01]"
                  : "border-border hover:border-primary/50 bg-card/50"
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
                <FileUp className="h-6 w-6" />
              </div>
              <p className="text-xs font-semibold text-foreground mb-1">
                Sem presuňte bankový výpis (CSV) alebo kliknite
              </p>
              <p className="text-[11px] text-muted-foreground">
                Automatická 1-kliková detekcia formátov Tatra banka, George,
                VÚB, ČSOB a Fio
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFileSelect(f);
                }}
              />
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-4">
              {/* Odznak detekcie banky */}
              {detectedBank ? (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-semibold">
                      🟢 Detegovaný formát: {detectedBank.bankName} (
                      {detectedBank.confidence}% zhoda)
                    </span>
                  </div>
                  <span className="text-[10px] bg-emerald-500/20 px-2 py-0.5 rounded-md font-mono text-emerald-300">
                    1-Click Auto-Map
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs">
                  <span>
                    ⚠️ Neznámy formát banky. Skontrolujte manuálne mapovanie
                    nižšie.
                  </span>
                </div>
              )}

              {/* 1-Click Import tlačidlo */}
              {validCount > 0 && (
                <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-3 shadow-inner">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span>Pripravené na okamžitý import</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {validCount} transakcií
                    </span>
                  </div>

                  <Button
                    className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-md flex items-center justify-center gap-2 text-xs transition-all"
                    onClick={handleOneClickImport}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Zapisujem transakcie do spisu...
                      </>
                    ) : (
                      <>
                        <Zap className="h-4 w-4 fill-current" />
                        Importovať {validCount} transakcií do spisu na 1 klik
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Náhľad prvých transakcií */}
              {bankParseResult && bankParseResult.transactions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium">Náhľad rozpoznaných dát</span>
                    <span>
                      Zobrazené prvé {Math.min(3, bankParseResult.transactions.length)} z {bankParseResult.validCount}
                    </span>
                  </div>
                  <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-card/40 text-xs overflow-hidden">
                    {bankParseResult.transactions.slice(0, 3).map((tx, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-foreground truncate">
                            {tx.counterpartyName || tx.counterparty || "Partner"}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {tx.date} • {tx.description || "Bez popisu"}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span
                            className={`font-mono font-semibold ${
                              tx.amount < 0
                                ? "text-rose-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {tx.amount < 0 ? "" : "+"}
                            {tx.amount.toLocaleString("sk-SK", {
                              minimumFractionDigits: 2,
                            })}{" "}
                            {tx.currency}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Prepínače oddeľovača a kódovania */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">
                    Oddeľovač
                  </label>
                  <select
                    value={delimiter}
                    onChange={(e) => {
                      const d = e.target.value as Delimiter;
                      void processCsvText(fileText, d);
                    }}
                    className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs"
                  >
                    <option value=";">Bodkočiarka (;)</option>
                    <option value=",">Čiarka (,)</option>
                    <option value="\t">Tabulátor (TAB)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">
                    Kódovanie
                  </label>
                  <select
                    value={encoding}
                    onChange={(e) => {
                      const enc = e.target.value as Encoding;
                      setEncoding(enc);
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const txt = (ev.target?.result as string) || "";
                          setFileText(txt);
                          void processCsvText(txt);
                        };
                        reader.readAsText(file, enc);
                      }
                    }}
                    className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs"
                  >
                    <option value="utf-8">UTF-8</option>
                    <option value="windows-1250">Windows-1250</option>
                  </select>
                </div>
              </div>

              {/* Mapovanie stĺpcov */}
              <SectionTitle>Predvyplnené mapovanie stĺpcov</SectionTitle>

              <div className="space-y-2 text-xs">
                {Object.entries(MAPPING_LABELS).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-muted-foreground font-medium">
                      {label}:
                    </span>
                    <select
                      value={mapping[key as keyof ColumnMapping] ?? -1}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMapping((m) => ({
                          ...m,
                          [key]: val === "" ? -1 : Number(val),
                        }));
                      }}
                      className="h-8 rounded-lg border border-border bg-card px-2 text-xs min-w-44"
                    >
                      <option value="-1">-- Nepoužiť --</option>
                      {rawHeaders.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="w-1/3 text-xs flex items-center justify-center gap-1.5"
                  onClick={resetImport}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Iný súbor
                </Button>
                <Button
                  className="w-2/3 text-xs"
                  onClick={handleOneClickImport}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Potvrdiť import (${validCount} tx)`
                  )}
                </Button>
              </div>
            </div>
          )}
        </Card>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
