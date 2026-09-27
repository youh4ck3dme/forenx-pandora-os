/**
 * Smart 1-Click Bank CSV Auto-Mapping Engine (GAP 11)
 *
 * Automatická detekcia a mapovanie bankových výpisov slovenských a českých bánk:
 * - Tatra banka / Raiffeisen
 * - Slovenská sporiteľňa (SLSP / George)
 * - VÚB banka
 * - ČSOB (SK & CZ)
 * - Fio banka
 *
 * Normalizácia dátumov a čísel/súm do centov a ISO dátumu.
 */

import {
  parseDelimited,
  detectDelimiter,
  stripBom,
  type Delimiter,
  type DateFormat,
  type DecimalSeparator,
} from "./parse";
import { type ColumnMapping, EMPTY_MAPPING } from "./mapping";

import {
  type BankId,
  type BankSignatureRule,
  type BankProfile,
  BANK_PROFILES,
  getRegisteredBankProfiles,
  registerBankProfile,
  unregisterBankProfile,
  getBankProfile,
  bankRegistry,
} from "./banks";

export type { BankId, BankSignatureRule, BankProfile };
export {
  BANK_PROFILES,
  getRegisteredBankProfiles,
  registerBankProfile,
  unregisterBankProfile,
  getBankProfile,
  bankRegistry,
};


export interface BankDetectionResult {
  bankId: BankId;
  bankName: string;
  confidence: number; // 0 - 100
  mapping: ColumnMapping;
  delimiter: Delimiter;
  dateFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  defaultCurrency: string;
  matchedHeaders: Partial<
    Record<keyof ColumnMapping | "counterpartyName", string>
  >;
  matchedIndices: Partial<
    Record<keyof ColumnMapping | "counterpartyName", number>
  >;
}

export interface NormalizedBankTransaction {
  sourceRow: number;
  date: string; // ISO YYYY-MM-DD
  amount: number; // e.g. 1250.50
  amountCents: number; // e.g. 125050
  currency: string;
  from: string;
  to: string;
  counterparty: string;
  counterpartyName: string;
  description: string;
  method: "cash" | "transfer";
  raw: string[];
}

export interface BankParseResult {
  detectedBank: BankDetectionResult | null;
  transactions: NormalizedBankTransaction[];
  errors: { sourceRow: number; reasons: string[]; raw: string[] }[];
  totalCount: number;
  validCount: number;
}

/** Odstráni úvodzovky, orezanie, malé písmená a diakritiku. */
export function cleanHeader(header: string): string {
  return (header || "")
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalizuje dátumy rôznych formátov do ISO formátu YYYY-MM-DD:
 * - DD.MM.YYYY / D.M.YYYY
 * - YYYY-MM-DD
 * - DD/MM/YYYY / D/M/YYYY
 * - DD-MM-YYYY
 * - YYYY.MM.DD / YYYY/MM/DD
 */
export function normalizeDate(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();

  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD
  const mIso = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (mIso) {
    const year = Number(mIso[1]);
    const month = Number(mIso[2]);
    const day = Number(mIso[3]);
    return toValidIso(year, month, day);
  }

  // DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
  const mEu = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (mEu) {
    const day = Number(mEu[1]);
    const month = Number(mEu[2]);
    const year = Number(mEu[3]);
    return toValidIso(year, month, day);
  }

  return null;
}

function toValidIso(year: number, month: number, day: number): string | null {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900 ||
    year > 2100
  ) {
    return null;
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() + 1 !== month ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
}

/**
 * Normalizuje textovú sumu s rôznymi formátmi (medzery, bodky, čiarky, mena)
 * priamo na celé číslo centov (napr. "1 250,50 €" -> 125050 centov).
 */
export function normalizeAmountToCents(raw: string | number): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }
  if (!raw || typeof raw !== "string") return null;

  let s = raw.trim().replace(/\u00a0/g, " ");
  if (!s) return null;

  let negative = false;
  // Handle brackets e.g. (1 250,50)
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Handle leading sign e.g. -1250.50 or +1250.50
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  } else if (s.startsWith("+")) {
    s = s.slice(1).trim();
  }

  // Trailing minus e.g. "1250,50-"
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }

  // Strip currency symbols and letters e.g. €, EUR, CZK, Kč, USD, GBP
  s = s.replace(/[A-Za-z€$£Kč]/g, "").trim();
  if (!s) return null;

  // Remove whitespace
  const clean = s.replace(/\s+/g, "");

  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");

  let integerPart = clean;
  let fractionPart = "";

  if (lastDot !== -1 && lastComma !== -1) {
    if (lastComma > lastDot) {
      // e.g. "1.250,50" -> dot thousand, comma decimal
      integerPart = clean.slice(0, lastComma).replace(/\./g, "");
      fractionPart = clean.slice(lastComma + 1);
    } else {
      // e.g. "1,250.50" -> comma thousand, dot decimal
      integerPart = clean.slice(0, lastDot).replace(/,/g, "");
      fractionPart = clean.slice(lastDot + 1);
    }
  } else if (lastComma !== -1) {
    // Only comma
    const parts = clean.split(",");
    if (parts.length === 2 && parts[1]!.length <= 2) {
      integerPart = parts[0]!;
      fractionPart = parts[1]!;
    } else if (parts.length > 2) {
      // e.g. "1,250,000"
      integerPart = parts.join("");
    } else {
      if (
        parts[1] &&
        parts[1].length === 3 &&
        parts[0] &&
        parts[0].length <= 3
      ) {
        // Jediný oddeľovač s troma číslicami môže znamenať tisíce aj
        // OCR chybu/tri desatinné miesta; bez bankového formátu nehádame.
        return null;
      } else {
        integerPart = parts[0]!;
        fractionPart = parts[1] ?? "";
      }
    }
  } else if (lastDot !== -1) {
    // Only dot
    const parts = clean.split(".");
    if (parts.length === 2 && parts[1]!.length <= 2) {
      integerPart = parts[0]!;
      fractionPart = parts[1]!;
    } else if (parts.length > 2) {
      integerPart = parts.join("");
    } else {
      if (
        parts[1] &&
        parts[1].length === 3 &&
        parts[0] &&
        parts[0].length <= 3
      ) {
        return null;
      } else {
        integerPart = parts[0]!;
        fractionPart = parts[1] ?? "";
      }
    }
  }

  if (!/^\d+$/.test(integerPart)) return null;

  // Nikdy potichu nezaokrúhľuj ani neodrezávaj zlomky bankového výpisu.
  if (fractionPart.length > 2) return null;
  fractionPart = fractionPart.padEnd(2, "0");
  if (fractionPart && !/^\d+$/.test(fractionPart)) return null;

  const integerValue = Number(integerPart);
  if (!Number.isSafeInteger(integerValue)) return null;
  const totalCents =
    integerValue * 100 + (fractionPart ? Number(fractionPart) : 0);
  if (!Number.isSafeInteger(totalCents)) return null;
  return negative ? -totalCents : totalCents;
}

/**
 * Normalizuje sumu do štandardného float čísla (napr. "1 250,50 €" -> 1250.5).
 */
export function normalizeAmount(raw: string | number): number | null {
  const cents = normalizeAmountToCents(raw);
  if (cents === null) return null;
  return cents / 100;
}

/**
 * Extrahuje kód meny zo stringu ak je prítomný (napr. "EUR", "CZK", "USD").
 */
export function extractCurrency(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (s.includes("EUR") || s.includes("€")) return "EUR";
  if (s.includes("CZK") || s.includes("KČ")) return "CZK";
  if (s.includes("USD") || s.includes("$")) return "USD";
  if (s.includes("GBP") || s.includes("£")) return "GBP";
  return null;
}

/**
 * Deteguje formát bankového výpisu na základe hlavičiek CSV súboru.
 * Vracia výsledok detekcie, percentuálnu zhodu (confidence) a predvyplnené mapovanie.
 */
export function detectBankFormat(
  headers: string[],
  sampleRows?: string[][],
): BankDetectionResult | null {
  if (!headers || headers.length === 0) return null;

  const cleaned = headers.map(cleanHeader);

  type ScoredBank = {
    profile: BankProfile;
    matchedCoreCount: number;
    totalCoreCount: number;
    confidence: number;
    matchedIndices: Partial<
      Record<keyof ColumnMapping | "counterpartyName" | "counterparty", number>
    >;
    matchedHeaders: Partial<
      Record<keyof ColumnMapping | "counterpartyName" | "counterparty", string>
    >;
    isUnique: boolean;
  };

  const profiles = getRegisteredBankProfiles();
  const scores: ScoredBank[] = profiles.map((profile) => {
    const matchedIndices: Partial<
      Record<keyof ColumnMapping | "counterpartyName" | "counterparty", number>
    > = {};
    const matchedHeaders: Partial<
      Record<keyof ColumnMapping | "counterpartyName" | "counterparty", string>
    > = {};

    const usedIndices = new Set<number>();
    let matchedCoreCount = 0;
    const coreSignatures = profile.signatures.filter((s) => s.isCore);
    const totalCoreCount = coreSignatures.length;

    // Najprv matchneme core signatures
    for (const sig of profile.signatures) {
      for (let i = 0; i < cleaned.length; i++) {
        if (usedIndices.has(i)) continue;
        if (sig.matches(cleaned[i]!)) {
          matchedIndices[sig.field] = i;
          matchedHeaders[sig.field] = headers[i];
          usedIndices.add(i);
          if (sig.isCore) {
            matchedCoreCount++;
          }
          break;
        }
      }
    }

    const isUnique = profile.uniqueDetector
      ? profile.uniqueDetector(cleaned)
      : false;
    let confidence = Math.round((matchedCoreCount / totalCoreCount) * 100);
    if (confidence > 100) confidence = 100;

    return {
      profile,
      matchedCoreCount,
      totalCoreCount,
      confidence,
      matchedIndices,
      matchedHeaders,
      isUnique,
    };
  });

  // Zoradíme: najprv 100% zhody s unikátnymi znakmi, potom podľa confidence
  scores.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence;
    }
    if (a.isUnique !== b.isUnique) {
      return a.isUnique ? -1 : 1;
    }
    return b.matchedCoreCount - a.matchedCoreCount;
  });

  const best = scores[0];
  if (!best || best.confidence < 70) {
    return null;
  }
  const equallyLikely = scores.filter(
    (score) =>
      score.confidence === best.confidence &&
      score.isUnique === best.isUnique &&
      score.matchedCoreCount === best.matchedCoreCount,
  );
  if (equallyLikely.length > 1) {
    return null;
  }

  // Zostavíme ColumnMapping
  const mapping: ColumnMapping = {
    ...EMPTY_MAPPING,
    date: best.matchedIndices.date ?? -1,
    amount: best.matchedIndices.amount ?? -1,
    currency: best.matchedIndices.currency ?? -1,
    description: best.matchedIndices.description ?? -1,
    counterpartyTo:
      best.matchedIndices.counterpartyName ??
      best.matchedIndices.counterparty ??
      -1,
    counterpartyFrom:
      best.matchedIndices.counterparty !== undefined &&
      best.matchedIndices.counterpartyName !== undefined
        ? best.matchedIndices.counterparty
        : -1,
    method: -1,
  };

  return {
    bankId: best.profile.id,
    bankName: best.profile.name,
    confidence: best.confidence,
    mapping,
    delimiter: best.profile.defaultDelimiter,
    dateFormat: best.profile.defaultDateFormat,
    decimalSeparator: best.profile.defaultDecimalSeparator,
    defaultCurrency: best.profile.defaultCurrency,
    matchedHeaders: best.matchedHeaders,
    matchedIndices: best.matchedIndices,
  };
}

export type BankParseOptions = {
  ownAccountName?: string;
  defaultCurrency?: string;
};

/**
 * Rozparsuje bankový CSV výpis, automaticky deteguje banku a vráti normalizované transakcie.
 */
/**
 * Kontext spracovania riadka — zdieľa ho synchrónna aj chunked (async) verzia.
 */
export type BankRowContext = {
  mapping: ColumnMapping;
  detectedBank: BankDetectionResult | null;
  ownAccount: string;
  defaultCurrency: string;
};

/**
 * Spracuje jeden riadok bankového výpisu; vracia transakciu alebo chybu.
 */
export function processBankRow(
  raw: string[],
  sourceRow: number,
  ctx: BankRowContext,
): {
  transaction: NormalizedBankTransaction | null;
  error: { sourceRow: number; reasons: string[]; raw: string[] } | null;
} {
  const { mapping, detectedBank, ownAccount, defaultCurrency } = ctx;
  const reasons: string[] = [];

// Dátum
const rawDate = mapping.date >= 0 ? (raw[mapping.date] ?? "").trim() : "";
const date = normalizeDate(rawDate);
if (!date) {
  reasons.push(`Neplatný formát dátumu: "${rawDate || "—"}"`);
}

// Suma
const rawAmount =
  mapping.amount >= 0 ? (raw[mapping.amount] ?? "").trim() : "";
const amountCents = normalizeAmountToCents(rawAmount);
const amount = amountCents !== null ? amountCents / 100 : null;
if (amountCents === null || amount === null) {
  reasons.push(`Suma sa nedá prečítať: "${rawAmount || "—"}"`);
} else if (amountCents === 0) {
  reasons.push("Suma transakcie je nula.");
}

// Mena
let currency = defaultCurrency;
if (mapping.currency >= 0) {
  const parsedCurr = extractCurrency(raw[mapping.currency] ?? "");
  if (parsedCurr) currency = parsedCurr;
} else if (rawAmount) {
  const extracted = extractCurrency(rawAmount);
  if (extracted) currency = extracted;
}

// Protiúčet a názov
const counterparty =
  mapping.counterpartyFrom >= 0
    ? (raw[mapping.counterpartyFrom] ?? "").trim()
    : mapping.counterpartyTo >= 0
      ? (raw[mapping.counterpartyTo] ?? "").trim()
      : "";

const counterpartyName =
  detectedBank?.matchedIndices.counterpartyName !== undefined &&
  detectedBank.matchedIndices.counterpartyName >= 0
    ? (raw[detectedBank.matchedIndices.counterpartyName] ?? "").trim()
    : counterparty;

const description =
  mapping.description >= 0
    ? (raw[mapping.description] ?? "").trim()
    : "";

if (reasons.length > 0 || !date || amount === null || amountCents === null) {
  return { transaction: null, error: { sourceRow, reasons, raw } };
}

// Určenie smeru platby (od koho -> komu)
const partner = counterpartyName || counterparty || "Neznámy partner";
let from = ownAccount;
let to = partner;

if (amount > 0) {
  // Prichádzajúca platba
  from = partner;
  to = ownAccount;
} else {
  // Odchádzajúca platba
  from = ownAccount;
  to = partner;
}

  const transaction: NormalizedBankTransaction = {
    sourceRow,
    date,
    amount,
    amountCents,
    currency,
    from,
    to,
    counterparty,
    counterpartyName,
    description,
    method: "transfer",
    raw,
  };
  return { transaction, error: null };
}

export function parseBankCsv(
  csvText: string,
  options?: BankParseOptions,
): BankParseResult {
  const text = stripBom(csvText || "");
  const delim = detectDelimiter(text).value ?? ";";
  const rows = parseDelimited(text, delim);

  if (rows.length < 2) {
    return {
      detectedBank: null,
      transactions: [],
      errors: [
        {
          sourceRow: 1,
          reasons: ["Súbor neobsahuje dostatok riadkov."],
          raw: [],
        },
      ],
      totalCount: 0,
      validCount: 0,
    };
  }

  const headers = rows[0]!;
  const detectedBank = detectBankFormat(headers, rows.slice(1, 10));
  const mapping = detectedBank ? detectedBank.mapping : { ...EMPTY_MAPPING };

  const ownAccount = options?.ownAccountName || "Vlastný účet";
  const defaultCurrency =
    options?.defaultCurrency || detectedBank?.defaultCurrency || "EUR";

  const transactions: NormalizedBankTransaction[] = [];
  const errors: { sourceRow: number; reasons: string[]; raw: string[] }[] = [];

  const ctx: BankRowContext = { mapping, detectedBank, ownAccount, defaultCurrency };

  for (let i = 1; i < rows.length; i++) {
    const { transaction, error } = processBankRow(rows[i]!, i + 1, ctx);
    if (transaction) transactions.push(transaction);
    if (error) errors.push(error);
  }

  return {
    detectedBank,
    transactions,
    errors,
    totalCount: rows.length - 1,
    validCount: transactions.length,
  };
}

/**
 * P0-03/Large-Data: chunked asynchrónne spracovanie bankového CSV.
 *
 * Medzi chunkmi (default 1 000 riadkov) sa vráti riadenie event loopu,
 * takže UI vlákno pri veľkých súboroch (10 000+ riadkov) nezamrzne.
 * Výsledok je identický so synchrónnym parseBankCsv (rovnaký
 * processBankRow), čo zaručuje parity test.
 */
export type BankParseAsyncOptions = BankParseOptions & {
  /** Počet riadkov spracovaných medzi dvoma yieldmi (default 1 000). */
  chunkSize?: number;
  /** Injektovateľné vrátenie riadenia (testy); default setTimeout(0). */
  yieldControl?: () => Promise<void>;
};

async function yieldToEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function parseBankCsvAsync(
  csvText: string,
  options?: BankParseAsyncOptions,
): Promise<BankParseResult> {
  const text = stripBom(csvText || "");
  const delim = detectDelimiter(text).value ?? ";";
  const rows = parseDelimited(text, delim);

  if (rows.length < 2) {
    return {
      detectedBank: null,
      transactions: [],
      errors: [
        {
          sourceRow: 1,
          reasons: ["Súbor neobsahuje dostatok riadkov."],
          raw: [],
        },
      ],
      totalCount: 0,
      validCount: 0,
    };
  }

  const headers = rows[0]!;
  const detectedBank = detectBankFormat(headers, rows.slice(1, 10));
  const mapping = detectedBank ? detectedBank.mapping : { ...EMPTY_MAPPING };
  const ctx: BankRowContext = {
    mapping,
    detectedBank,
    ownAccount: options?.ownAccountName || "Vlastný účet",
    defaultCurrency:
      options?.defaultCurrency || detectedBank?.defaultCurrency || "EUR",
  };

  const chunkSize = Math.max(1, options?.chunkSize ?? 1_000);
  const yieldControl = options?.yieldControl ?? yieldToEventLoop;
  const transactions: NormalizedBankTransaction[] = [];
  const errors: { sourceRow: number; reasons: string[]; raw: string[] }[] = [];

  for (let i = 1; i < rows.length; ) {
    const end = Math.min(rows.length, i + chunkSize);
    for (; i < end; i += 1) {
      const { transaction, error } = processBankRow(rows[i]!, i + 1, ctx);
      if (transaction) transactions.push(transaction);
      if (error) errors.push(error);
    }
    // Medzi chunkmi vraciame riadenie — UI vlákno dýcha.
    if (i < rows.length) await yieldControl();
  }

  return {
    detectedBank,
    transactions,
    errors,
    totalCount: rows.length - 1,
    validCount: transactions.length,
  };
}
