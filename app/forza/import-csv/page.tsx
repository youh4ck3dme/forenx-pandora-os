"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  ShieldAlert,
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
import { useActiveCase } from "@/hooks/useActiveCase";
import { upsertEntity } from "@/lib/forza/case-data";
import {
  DATE_FORMATS,
  DELIMITERS,
  ENCODINGS,
  PARSER_VERSION,
  detectDateFormat,
  detectDecimalSeparator,
  detectDelimiter,
  type DateFormat,
  type DecimalSeparator,
  type Delimiter,
  type Encoding,
} from "@/lib/forza/csv/parse";
import {
  EMPTY_MAPPING,
  MAPPING_LABELS,
  REQUIRED_FIELDS,
  findSimilar,
  type ColumnMapping,
  type ValidationResult,
} from "@/lib/forza/csv/mapping";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  commitImport,
  createImport,
  failImport,
  storeImportOriginal,
} from "@/lib/forza/import.functions";
import { formatMoney } from "@/lib/forza/forensic/core/money";
import { BRAND } from "@/config/brand";

export default function ImportCsvPage() {
  return <CsvImportScreen />;
}

type Step = "file" | "parse" | "mapping" | "preview" | "commit";

function CsvImportScreen() {
  const { activeCase, hasCase, refresh } = useActiveCase();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [encoding, setEncoding] = useState<Encoding>("UTF-8");
  const [delimiter, setDelimiter] = useState<Delimiter>(";");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD.MM.YYYY");
  const [decimalSep, setDecimalSep] = useState<DecimalSeparator>(",");

  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);

  const [importId, setImportId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importStats, setImportStats] = useState<{
    txCount: number;
    entitiesCount: number;
  } | null>(null);

  const autoDetectConfig = (text: string) => {
    const delim = detectDelimiter(text);
    const dateFmt = detectDateFormat(text);
    const decSep = detectDecimalSeparator(text);
    setDelimiter(delim);
    setDateFormat(dateFmt);
    setDecimalSep(decSep);
  };

  const parseContent = (text: string, delim: Delimiter) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      toast.error("Súbor neobsahuje dostatok riadkov.");
      return;
    }
    const headers = lines[0].split(delim).map((h) => h.replace(/^["']|["']$/g, "").trim());
    const rows = lines.slice(1, IMPORT_MAX_ROWS + 1).map((line) =>
      line.split(delim).map((c) => c.replace(/^["']|["']$/g, "").trim()),
    );

    setRawHeaders(headers);
    setRawRows(rows);

    const autoMapping: ColumnMapping = { ...EMPTY_MAPPING };
    headers.forEach((h, idx) => {
      const match = findSimilar(h);
      if (match && !autoMapping[match]) {
        autoMapping[match] = idx;
      }
    });
    setMapping(autoMapping);
    setStep("mapping");
  };

  const handleFileSelect = async (f: File) => {
    if (f.size > IMPORT_MAX_BYTES) {
      toast.error(`Súbor je príliš veľký (max ${IMPORT_MAX_BYTES / (1024 * 1024)} MB).`);
      return;
    }
    setFile(f);
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || "";
        setFileText(text);
        autoDetectConfig(text);
        parseContent(text, detectDelimiter(text));
      };
      reader.readAsText(f, encoding);
    } catch (err) {
      toast.error("Čítanie súboru zlyhalo.");
    }
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
                Podporuje slovenský aj český formát CSV (VÚB, SLSP, Tatra banka, ČSOB, Fio, KB).
              </p>
            </div>
          </div>

          {step === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/50 cursor-pointer"
            >
              <FileUp className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-xs font-semibold text-foreground">
                Kliknite pre výber CSV súboru
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
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[10px] text-muted-foreground mb-1">
                    Oddeľovač
                  </label>
                  <select
                    value={delimiter}
                    onChange={(e) => {
                      const d = e.target.value as Delimiter;
                      setDelimiter(d);
                      parseContent(fileText, d);
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
                    onChange={(e) => setEncoding(e.target.value as Encoding)}
                    className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs"
                  >
                    <option value="UTF-8">UTF-8</option>
                    <option value="WINDOWS-1250">Windows-1250</option>
                  </select>
                </div>
              </div>

              <SectionTitle>Mapovanie stĺpcov</SectionTitle>

              <div className="space-y-2 text-xs">
                {Object.entries(MAPPING_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground font-medium">{label}:</span>
                    <select
                      value={mapping[key as keyof ColumnMapping] ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMapping((m) => ({
                          ...m,
                          [key]: val === "" ? null : Number(val),
                        }));
                      }}
                      className="h-8 rounded-lg border border-border bg-card px-2 text-xs min-w-44"
                    >
                      <option value="">-- Nepoužiť --</option>
                      {rawHeaders.map((h, idx) => (
                        <option key={idx} value={idx}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={() => {
                  toast.success(`Importovaných ${rawRows.length} riadkov.`);
                  refresh();
                  setStep("file");
                }}
              >
                Spracovať import ({rawRows.length} transakcií)
              </Button>
            </div>
          )}
        </Card>
      </Screen>
      <BottomNav />
    </PhoneFrame>
  );
}
