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

export type BankId = "tatra" | "slsp" | "vub" | "csob" | "fio";

export interface BankSignatureRule {
  field:
    | "date"
    | "amount"
    | "currency"
    | "description"
    | "counterparty"
    | "counterpartyName";
  name: string;
  isCore: boolean;
  matches: (cleanHeader: string) => boolean;
}

export interface BankProfile {
  id: BankId;
  name: string;
  country: "SK" | "CZ" | "SK/CZ";
  signatures: BankSignatureRule[];
  defaultDelimiter: Delimiter;
  defaultDecimalSeparator: DecimalSeparator;
  defaultDateFormat: DateFormat;
  defaultCurrency: string;
  uniqueDetector?: (cleaned: string[]) => boolean;
}

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
 * Zoznam profilov bánk s ich detekčnými pravidlami.
 */
export const BANK_PROFILES: BankProfile[] = [
  {
    id: "tatra",
    name: "Tatra banka / Raiffeisen",
    country: "SK",
    defaultDelimiter: ";",
    defaultDecimalSeparator: ",",
    defaultDateFormat: "DD.MM.YYYY",
    defaultCurrency: "EUR",
    signatures: [
      {
        field: "date",
        name: "Dátum zaúčtovania",
        isCore: true,
        matches: (h) =>
          h === "datum zauctovania" ||
          h === "datum zaustovania" ||
          h === "datum transakcie" ||
          h.includes("datum zauct"),
      },
      {
        field: "amount",
        name: "Suma",
        isCore: true,
        matches: (h) => h === "suma" || h === "ciastka",
      },
      {
        field: "currency",
        name: "Mena",
        isCore: true,
        matches: (h) => h === "mena",
      },
      {
        field: "counterparty",
        name: "Protiúčet/IBAN",
        isCore: true,
        matches: (h) =>
          h === "protiucet/iban" ||
          h === "protiucet / iban" ||
          h === "iban protiuctu" ||
          (h.includes("protiucet") && h.includes("iban")),
      },
      {
        field: "counterpartyName",
        name: "Názov protiúčtu",
        isCore: true,
        matches: (h) =>
          h === "nazov protiuctu" ||
          h === "nazov uctu" ||
          h === "nazov partnera",
      },
      {
        field: "description",
        name: "Informácia pre príjemcu",
        isCore: true,
        matches: (h) =>
          h === "informacia pre prijemcu" ||
          h === "informacie pre prijemcu" ||
          h.includes("informacia pre prijemcu") ||
          h.includes("informacie pre prijemcu"),
      },
    ],
    uniqueDetector: (cleaned) =>
      cleaned.some((h) => h.includes("protiucet/iban")) ||
      cleaned.some((h) => h.includes("informacia pre prijemcu")),
  },
  {
    id: "slsp",
    name: "Slovenská sporiteľňa (SLSP / George)",
    country: "SK",
    defaultDelimiter: ";",
    defaultDecimalSeparator: ",",
    defaultDateFormat: "DD.MM.YYYY",
    defaultCurrency: "EUR",
    signatures: [
      {
        field: "date",
        name: "Dátum",
        isCore: true,
        matches: (h) => h === "datum" || h === "datum zauctovania",
      },
      {
        field: "amount",
        name: "Zaúčtovaná suma",
        isCore: true,
        matches: (h) =>
          h === "zauctovana suma" ||
          (h.includes("zauctovan") && h.includes("suma")),
      },
      {
        field: "counterparty",
        name: "Číslo protiúčtu",
        isCore: true,
        matches: (h) =>
          h === "cislo protiuctu" ||
          h === "iban protiuctu" ||
          h.includes("cislo protiuct"),
      },
      {
        field: "description",
        name: "Správa pre príjemcu",
        isCore: true,
        matches: (h) =>
          h === "sprava pre prijemcu" || h.includes("sprava pre prijemcu"),
      },
      {
        field: "counterpartyName",
        name: "Názov protiúčtu",
        isCore: false,
        matches: (h) => h === "nazov protiuctu" || h === "meno partnera",
      },
      {
        field: "currency",
        name: "Mena",
        isCore: false,
        matches: (h) => h === "mena",
      },
    ],
    uniqueDetector: (cleaned) =>
      cleaned.some(
        (h) =>
          h === "zauctovana suma" ||
          h.includes("zauctovan") ||
          h === "cislo protiuctu",
      ),
  },
  {
    id: "vub",
    name: "VÚB banka",
    country: "SK",
    defaultDelimiter: ";",
    defaultDecimalSeparator: ",",
    defaultDateFormat: "DD.MM.YYYY",
    defaultCurrency: "EUR",
    signatures: [
      {
        field: "date",
        name: "Dátum valúty",
        isCore: true,
        matches: (h) =>
          h === "datum valuty" || h === "valuta" || h.includes("valut"),
      },
      {
        field: "amount",
        name: "Čiastka",
        isCore: true,
        matches: (h) => h === "ciastka" || h === "suma",
      },
      {
        field: "counterparty",
        name: "IBAN partnera",
        isCore: true,
        matches: (h) =>
          h === "iban partnera" ||
          h === "cislo uctu partnera" ||
          h.includes("iban partner"),
      },
      {
        field: "description",
        name: "Popis transakcie",
        isCore: true,
        matches: (h) =>
          h === "popis transakcie" ||
          h === "popis" ||
          h.includes("popis transakcie"),
      },
      {
        field: "counterpartyName",
        name: "Názov partnera",
        isCore: false,
        matches: (h) => h === "nazov partnera" || h === "meno partnera",
      },
      {
        field: "currency",
        name: "Mena",
        isCore: false,
        matches: (h) => h === "mena",
      },
    ],
    uniqueDetector: (cleaned) =>
      cleaned.some((h) => h.includes("valut")) ||
      cleaned.some((h) => h.includes("iban partner")),
  },
  {
    id: "csob",
    name: "ČSOB (SK & CZ)",
    country: "SK/CZ",
    defaultDelimiter: ";",
    defaultDecimalSeparator: ",",
    defaultDateFormat: "DD.MM.YYYY",
    defaultCurrency: "EUR",
    signatures: [
      {
        field: "date",
        name: "Dátum zaúčtovania",
        isCore: true,
        matches: (h) =>
          h === "datum zauctovania" ||
          h === "datum zauctovani" ||
          h.includes("datum zauct"),
      },
      {
        field: "amount",
        name: "Objem",
        isCore: true,
        matches: (h) => h === "objem" || h === "castka",
      },
      {
        field: "counterparty",
        name: "Protiúčet",
        isCore: true,
        matches: (h) =>
          h === "protiucet" ||
          h === "protiucet / kod banky" ||
          h === "cislo protiuctu",
      },
      {
        field: "description",
        name: "Poznámka",
        isCore: true,
        matches: (h) =>
          h === "poznamka" ||
          h === "zprava pro prijemce" ||
          h === "sprava pre prijemcu",
      },
      {
        field: "counterpartyName",
        name: "Názov protiúčtu",
        isCore: false,
        matches: (h) => h === "nazov protiuctu" || h === "nazev protiuctu",
      },
      {
        field: "currency",
        name: "Mena",
        isCore: false,
        matches: (h) => h === "mena",
      },
    ],
    uniqueDetector: (cleaned) =>
      cleaned.some((h) => h === "objem") &&
      cleaned.some((h) => h === "poznamka"),
  },
  {
    id: "fio",
    name: "Fio banka",
    country: "SK/CZ",
    defaultDelimiter: ";",
    defaultDecimalSeparator: ",",
    defaultDateFormat: "DD.MM.YYYY",
    defaultCurrency: "EUR",
    signatures: [
      {
        field: "date",
        name: "Dátum",
        isCore: true,
        matches: (h) => h === "datum" || h === "datum zauctovania",
      },
      {
        field: "amount",
        name: "Objem",
        isCore: true,
        matches: (h) => h === "objem" || h === "castka",
      },
      {
        field: "currency",
        name: "Mena",
        isCore: true,
        matches: (h) => h === "mena",
      },
      {
        field: "counterparty",
        name: "Protiúčet",
        isCore: true,
        matches: (h) =>
          h === "protiucet" || h === "cislo protiuctu" || h === "iban",
      },
      {
        field: "description",
        name: "Správa",
        isCore: true,
        matches: (h) =>
          h === "sprava" ||
          h === "zprava pro prijemce" ||
          h === "komentar" ||
          h === "popis",
      },
      {
        field: "counterpartyName",
        name: "Názov protiúčtu",
        isCore: false,
        matches: (h) => h === "nazov protiuctu" || h === "nazev protiuctu",
      },
    ],
    uniqueDetector: (cleaned) =>
      cleaned.some((h) => h === "objem") &&
      cleaned.some((h) => h === "sprava" || h === "komentar"),
  },
];

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

  const scores: ScoredBank[] = BANK_PROFILES.map((profile) => {
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

  for (let i = 1; i < rows.length; i++) {
    const raw = rows[i]!;
    const sourceRow = i + 1;
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
      errors.push({ sourceRow, reasons, raw });
      continue;
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

    transactions.push({
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
    });
  }

  return {
    detectedBank,
    transactions,
    errors,
    totalCount: rows.length - 1,
    validCount: transactions.length,
  };
}
