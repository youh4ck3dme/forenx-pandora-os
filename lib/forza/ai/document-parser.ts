import { z } from "zod";
import type { ExtractedCaseEntity, ParsedCaseDocument } from "../types";

/** Strop nahrávania: 8 MB binárne ≈ 11 MB v Base64 + rezerva. */
export const UPLOAD_MAX_BASE64_CHARS = 12_000_000;
/** Strop pre priamo vložený text jedného dokumentu. */
export const UPLOAD_MAX_TEXT_CHARS = 2_000_000;
/** Maximálny počet súborov v jednej hromadnej požiadavke. */
export const UPLOAD_MAX_FILES = 20;

export const MIN_EXTRACT_CHARS = 30;

export const uploadFileSchema = z.object({
  fileName: z.string().min(1).max(512),
  fileBase64: z
    .string()
    .max(
      UPLOAD_MAX_BASE64_CHARS,
      `Súbor je príliš veľký (limit ${Math.round(UPLOAD_MAX_BASE64_CHARS / 1024 / 1024)} MB).`,
    )
    .optional(),
  textContent: z
    .string()
    .max(UPLOAD_MAX_TEXT_CHARS, "Text dokumentu je príliš dlhý.")
    .optional(),
});

// Bezpečnostné limity pre XLSX
const MAX_XLSX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_XLSX_SHEETS = 25;
const MAX_XLSX_ROWS_PER_SHEET = 20_000;
const MAX_XLSX_COLUMNS = 200;
const MAX_XLSX_CELLS = 200_000;
const MAX_XLSX_CELL_CHARS = 32_768;
const MAX_XLSX_ARCHIVE_ENTRIES = 2_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;

function rejectXlsx(message: string): never {
  throw new Error("XLSX: " + message);
}

export function validateXlsxArchive(buffer: Buffer): void {
  if (buffer.length > MAX_XLSX_INPUT_BYTES) rejectXlsx("Súbor XLSX je príliš veľký (maximálne 8 MiB).");
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) rejectXlsx("Súbor nemá platnú štruktúru XLSX.");
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd === -1) rejectXlsx("Súbor XLSX nemá platný centrálny adresár.");
  const entries = buffer.readUInt16LE(eocd + 10);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries !== entriesOnDisk || entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff || entries > MAX_XLSX_ARCHIVE_ENTRIES || directoryOffset + directorySize > eocd) rejectXlsx("Súbor XLSX prekračuje bezpečnostné limity archívu.");
  let offset = directoryOffset;
  let uncompressedBytes = 0;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > eocd || buffer.readUInt32LE(offset) !== 0x02014b50) rejectXlsx("Súbor XLSX má poškodený centrálny adresár.");
    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (nextOffset > eocd || (flags & 1) !== 0 || !name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === "." || part === ".." || part === "__proto__" || part === "prototype" || part === "constructor") || names.has(name)) rejectXlsx("Súbor XLSX obsahuje nebezpečnú položku.");
    if (localOffset + 30 > directoryOffset || buffer.readUInt32LE(localOffset) !== 0x04034b50) rejectXlsx("Súbor XLSX obsahuje neplatnú lokálnu položku.");
    names.add(name);
    uncompressedBytes += uncompressedSize;
    if (uncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES || compressedSize > buffer.length) rejectXlsx("Rozbalený obsah XLSX prekračuje bezpečnostný limit.");
    offset = nextOffset;
  }
  if (offset !== directoryOffset + directorySize) rejectXlsx("Súbor XLSX má nekonzistentný centrálny adresár.");
}

export function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

export async function extractXlsxText(buffer: Buffer): Promise<string> {
  try {
    validateXlsxArchive(buffer);
    const parserBuffer = Buffer.from(new ArrayBuffer(buffer.length));
    buffer.copy(parserBuffer);
    const { default: readXlsxFile } = await import(
      /* webpackIgnore: true */ "read-excel-file/node"
    );
    const worksheets = await readXlsxFile(parserBuffer);
    if (worksheets.length > MAX_XLSX_SHEETS) rejectXlsx("Súbor XLSX obsahuje viac než " + MAX_XLSX_SHEETS + " hárkov.");
    const sheetTexts: string[] = [];
    let outputLength = 0;
    let totalCells = 0;
    for (const worksheet of worksheets) {
      if (worksheet.data.length > MAX_XLSX_ROWS_PER_SHEET) rejectXlsx("Hárok „" + worksheet.sheet + "“ prekračuje limit " + MAX_XLSX_ROWS_PER_SHEET + " riadkov.");
      const rows: string[] = [];
      for (const row of worksheet.data) {
        if (row.length > MAX_XLSX_COLUMNS) rejectXlsx("Hárok „" + worksheet.sheet + "“ prekračuje limit " + MAX_XLSX_COLUMNS + " stĺpcov.");
        totalCells += row.length;
        if (totalCells > MAX_XLSX_CELLS) rejectXlsx("Súbor XLSX prekračuje limit " + MAX_XLSX_CELLS + " buniek.");
        const values: string[] = [];
        for (const cell of row) {
          const value = cell === null ? "" : String(cell);
          if (value.length > MAX_XLSX_CELL_CHARS) rejectXlsx("Bunka v hárku „" + worksheet.sheet + "“ prekračuje limit " + MAX_XLSX_CELL_CHARS + " znakov.");
          values.push(escapeCsvCell(value));
        }
        const csvRow = values.join(",");
        if (csvRow.trim()) rows.push(csvRow);
      }
      const sheetText = rows.join("\n").trim();
      if (sheetText) {
        const marker = "--- HÁROK: " + worksheet.sheet + " ---\n";
        outputLength += marker.length + sheetText.length + (sheetTexts.length === 0 ? 0 : 2);
        if (outputLength > UPLOAD_MAX_TEXT_CHARS) rejectXlsx("Extrahovaný text XLSX prekračuje limit " + UPLOAD_MAX_TEXT_CHARS + " znakov.");
        sheetTexts.push(marker + sheetText);
      }
    }
    return sheetTexts.join("\n\n");
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("XLSX: ")) throw new Error(error.message.slice(6));
    throw new Error("Súbor XLSX je neplatný alebo poškodený.");
  }
}

/** PDF textová vrstva je príliš krátka alebo „garbage“ (sken bez reálneho textu). */
export function isLowQualityPdfText(text: string): boolean {
  const trimmed = text.replace(/\u0000/g, "").trim();
  if (trimmed.length < 50) return true;
  const alnum = (trimmed.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnum / trimmed.length < 0.25) return true;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
  return false;
}

export function classifyExtractResult(
  fileName: string,
  res: { text: string; charCount: number; usedOcr?: boolean },
): {
  fileName: string;
  success: boolean;
  text: string;
  charCount: number;
  usedOcr?: boolean | undefined;
  error?: string | undefined;
} {
  if (!res.text || res.text.trim().length < MIN_EXTRACT_CHARS) {
    return {
      fileName,
      success: false,
      text: "",
      charCount: res.charCount,
      ...(res.usedOcr ? { usedOcr: true } : {}),
      error: "Dokument je príliš krátky alebo prázdny (minimálne 30 znakov).",
    };
  }
  return {
    fileName,
    success: true,
    text: res.text,
    charCount: res.charCount,
    ...(res.usedOcr ? { usedOcr: true } : {}),
  };
}

export async function extractSingleBufferText(
  fileName: string,
  fileBase64?: string,
  textContent?: string,
): Promise<{
  success: boolean;
  text: string;
  charCount: number;
  fileName: string;
  usedOcr?: boolean;
}> {
  const lower = fileName.toLowerCase();

  if (textContent) {
    return {
      success: true,
      text: textContent,
      charCount: textContent.length,
      fileName,
    };
  }

  if (!fileBase64) {
    throw new Error("Nebol poskytnutý žiadny súbor ani text.");
  }

  const buffer = Buffer.from(fileBase64, "base64");

  // 1. Textové a dátové formáty
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json")
  ) {
    const text = buffer.toString("utf-8");
    return { success: true, text, charCount: text.length, fileName };
  }

  // 2. HTML / HTM súbory
  if (lower.endsWith(".html") || lower.endsWith(".htm")) {
    const rawHtml = buffer.toString("utf-8");
    const text = rawHtml
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    return { success: true, text, charCount: text.length, fileName };
  }

  // 3. Tabuľky Excel (iba XLSX)
  if (lower.endsWith(".xls")) {
    throw new Error("Formát .xls nie je podporovaný z bezpečnostných dôvodov. Uložte súbor ako .xlsx.");
  }
  if (lower.endsWith(".xlsx")) {
    const text = await extractXlsxText(buffer);
    return { success: true, text, charCount: text.length, fileName, usedOcr: false };
  }

  // 4. PDF dokumenty s automatickým OCR fallbackom
  if (lower.endsWith(".pdf")) {
    let localText = "";
    try {
      const pdfModule = (await import("pdf-parse")) as unknown as Record<
        string,
        unknown
      >;
      const pdfParse = (
        typeof pdfModule === "function"
          ? pdfModule
          : (pdfModule["default"] ?? pdfModule)
      ) as (b: Buffer) => Promise<{ text: string }>;
      const pdfData = await pdfParse(buffer);
      localText = (pdfData.text || "").trim();
    } catch (err) {
      console.warn(
        "Lokálne pdf-parse zlyhalo, skúšam Mistral OCR fallback:",
        err,
      );
    }

    if (!isLowQualityPdfText(localText)) {
      return {
        success: true,
        text: localText,
        charCount: localText.length,
        fileName,
        usedOcr: false,
      };
    }

    try {
      const { extractWithOcrFallback } = await import("./llm.server");
      const ocrText = await extractWithOcrFallback(buffer, fileName);
      return {
        success: true,
        text: ocrText,
        charCount: ocrText.length,
        fileName,
        usedOcr: true,
      };
    } catch (ocrErr: unknown) {
      const detail =
        ocrErr instanceof Error ? ocrErr.message : "neznáma chyba OCR";
      throw new Error(
        `PDF nemá textovú vrstvu (sken/fotka) a OCR zlyhalo: ${detail}. ` +
          "Skontrolujte MISTRAL_API_KEY / MISTRAL_API_KEY_ANALYSIS, alebo nahrajte stránky ako JPG / rozdeľte PDF.",
      );
    }
  }

  // 5. Obrázky (skeny, fotodokumentácia, zápisnice) cez OCR
  if (/\.(png|jpe?g|webp|tiff?|bmp)$/i.test(lower)) {
    try {
      const { extractWithOcrFallback } = await import("./llm.server");
      const ocrText = await extractWithOcrFallback(buffer, fileName);
      return {
        success: true,
        text: ocrText,
        charCount: ocrText.length,
        fileName,
        usedOcr: true,
      };
    } catch (ocrErr: unknown) {
      throw new Error(
        (ocrErr instanceof Error ? ocrErr.message : null) ||
          "OCR rozpoznávanie obrázku zlyhalo.",
      );
    }
  }

  // 6. Word DOCX dokumenty
  if (lower.endsWith(".docx")) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return {
        success: true,
        text: result.value,
        charCount: result.value.length,
        fileName,
        usedOcr: false,
      };
    } catch (err: unknown) {
      throw new Error(
        (err instanceof Error ? err.message : null) ||
          "Extrakcia DOCX zlyhala. Nainštalujte knižnicu mammoth.",
      );
    }
  }

  // 7. RTF dokumenty
  if (lower.endsWith(".rtf")) {
    const rawRtf = buffer.toString("utf-8");
    const text = rawRtf
      .replace(/\\par[d]?/g, "\n")
      .replace(/\\tab/g, "\t")
      .replace(/\\[a-z0-9-]+/gi, "")
      .replace(/[{}]/g, "")
      .trim();
    return { success: true, text, charCount: text.length, fileName };
  }

  throw new Error(
    `Nepodporovaný formát: ${fileName}. Podporované sú .pdf, .docx, .xlsx, .txt, .md, .csv, .json, .png, .jpg, .webp, .html, .rtf`,
  );
}

/**
 * Deterministická extrakcia forenzných entít zo spisov a výsluchov ÚBOK.
 */
export function extractCaseEntities(text: string) {
  const caseIdMatch =
    text.match(/PPZ[ -]?[0-9]+\/UBOK-[A-Z0-9/-]+/i) ||
    text.match(/ČVS:[ \t]*([A-Z0-9/-]+)/i);
  const caseId = caseIdMatch
    ? (caseIdMatch[1] || caseIdMatch[0]).replace(/\s+/g, "")
    : undefined;

  let documentType = "Spisový materiál";
  if (/ZÁPISNICA\s+O\s+VÝSLUCHU/i.test(text))
    documentType = "Zápisnica o výsluchu";
  else if (/PROTOKOL\s+O\s+PREHLIADKE/i.test(text))
    documentType = "Protokol o prehliadke";
  else if (/UZNESENIE/i.test(text)) documentType = "Uznesenie";

  const dateMatch = text.match(
    /\b([0-3]?[0-9]\.[0-1]?[0-9]\.[12][09][0-9]{2})\b/,
  );
  const date = dateMatch ? dateMatch[1] : undefined;

  let location: string | undefined;
  for (const city of [
    "Košice",
    "Banská Bystrica",
    "Žilina",
    "Bratislava",
    "Prešov",
  ]) {
    if (text.toLowerCase().includes(city.toLowerCase())) {
      location = city;
      break;
    }
  }

  // Osoby
  const personsMap = new Map<string, ExtractedCaseEntity>();

  // Hlavný podozrivý / vypočúvaný
  const suspectMatch = text.match(
    /(?:meno[.:\s]+priezvisko[^\n]*|Osoba):\s*([A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+)(?:[,\s]+(?:nar\.\s*)?([0-3]?[0-9]\.[0-1]?[0-9]\.[12][09][0-9]{2}))?/i,
  );
  if (suspectMatch && suspectMatch[1]) {
    const name = suspectMatch[1].trim();
    personsMap.set(name, {
      name,
      role: "Podozrivý / Vypočúvaný",
      birthDate: suspectMatch[2]?.trim(),
    });
  }

  // Rodinní príslušníci a spoločníci
  const otecMatch = text.match(/O:\s*([A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+)/);
  if (otecMatch && otecMatch[1]) {
    personsMap.set(otecMatch[1], { name: otecMatch[1], role: "Otec" });
  }

  const mamaMatch = text.match(/M:\s*([A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+)/);
  if (mamaMatch && mamaMatch[1]) {
    personsMap.set(mamaMatch[1], { name: mamaMatch[1], role: "Matka" });
  }

  const druzkaMatch = text.match(
    /(?:družka|manželka)[^:\n)]*[:)]\s*([A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+)/i,
  );
  if (druzkaMatch && druzkaMatch[1]) {
    personsMap.set(druzkaMatch[1], {
      name: druzkaMatch[1],
      role: "Družka / Partnerka",
    });
  }

  const dceraMatch = text.match(
    /(?:dcéra|syn|dieťa)[^A-ZÁ-Ž\n]*([A-ZÁ-Ž][a-zá-ž]+ [A-ZÁ-Ž][a-zá-ž]+)/i,
  );
  if (dceraMatch && dceraMatch[1]) {
    personsMap.set(dceraMatch[1], { name: dceraMatch[1], role: "Dcéra" });
  }

  // Ďalšie osoby v spise
  for (const knownPerson of [
    "Denis Koval",
    "Dimitri Cohen",
    "Peter Novák",
    "Erik Babčan",
    "Marek Hruška",
    "Marek Plch",
    "Igor Malina",
    "Dmitrij Marjov",
    "Michal Ondruš",
    "Michal Žember",
    "Kada Dakaj",
    "Filip Flat",
    "Norbert Skyrčák",
    "Norbert Slezák",
    "Barbora Minarovicová",
  ]) {
    if (text.includes(knownPerson) && !personsMap.has(knownPerson)) {
      personsMap.set(knownPerson, {
        name: knownPerson,
        role: "Spoluobvinený / Svedok",
      });
    }
  }

  // Zbrane
  const weapons = new Set<string>();
  if (/glock\s*19/i.test(text)) weapons.add("Glock 19 Gen 5");
  if (/glock\s*17/i.test(text)) weapons.add("Glock 17");
  if (/glock\s*43x/i.test(text)) weapons.add("Glock 43x");
  if (/glock\s*45/i.test(text)) weapons.add("Glock 45");
  if (/GP\s*K100|Grand\s*Power/i.test(text)) weapons.add("Grand Power K100");
  if (/beretta/i.test(text)) weapons.add("Beretta");
  if (/CGDV051/i.test(text)) weapons.add("Zbraň v. č. CGDV051");
  if (/krátk[eé] paln[eé] zbran/i.test(text))
    weapons.add("Krátke palné zbrane (kal. 9x19 mm)");

  // Vozidlá
  const vehicles = new Set<string>();
  if (/BMW\s*X6/i.test(text)) vehicles.add("BMW X6");
  if (/BMW\s*X5/i.test(text)) vehicles.add("BMW X5");
  if (/BMW\s*(?:radu\s*7|7)/i.test(text)) vehicles.add("BMW radu 7");
  if (/Audi/i.test(text)) vehicles.add("Audi");

  // Spoločnosti
  const companies = new Set<string>();
  if (/TATRAGEN/i.test(text)) companies.add("TATRAGEN s.r.o.");
  if (/ARMIVEX/i.test(text)) companies.add("ARMIVEX s.r.o.");
  if (/PETRIS/i.test(text)) companies.add("PETRIS-SLOVAKIA s.r.o.");
  if (/Shadowarms/i.test(text)) companies.add("Shadowarms s.r.o.");
  if (/Bark\s*Factory/i.test(text))
    companies.add("Bark Factory Enterprise s.r.o.");
  if (/Tavira/i.test(text)) companies.add("Tavira s.r.o.");
  if (/Podtrubie/i.test(text)) companies.add("Podtrubie a.s.");
  if (/EB-EU/i.test(text)) companies.add("EB-EU s.r.o.");
  if (/VELTRA/i.test(text)) companies.add("VELTRA s.r.o.");

  // Právne paragrafy (podpora § aj OCR artefaktu $)
  const legalParagraphs = new Set<string>();
  const paraMatches = text.matchAll(
    /[§$]\s*[0-9]+[a-z]?(\s*ods\.\s*[0-9]+)?(\s*(?:TP|TZ|Trestn[ée]ho\s*(?:poriadku|zákona)))?/gi,
  );
  for (const match of paraMatches) {
    legalParagraphs.add(match[0].replace(/^\$/, "§").trim());
  }

  return {
    metadata: {
      caseId,
      documentType,
      date,
      location,
    },
    entities: {
      persons: Array.from(personsMap.values()),
      weapons: Array.from(weapons),
      vehicles: Array.from(vehicles),
      companies: Array.from(companies),
      legalParagraphs: Array.from(legalParagraphs),
    },
  };
}

export async function handleParseUploadedCaseDocument(
  fileName: string,
  fileBase64?: string,
  textContent?: string,
): Promise<ParsedCaseDocument> {
  const extraction = await extractSingleBufferText(
    fileName,
    fileBase64,
    textContent,
  );
  const { metadata, entities } = extractCaseEntities(extraction.text);

  return {
    success: extraction.success,
    fileName: extraction.fileName,
    charCount: extraction.charCount,
    usedOcr: extraction.usedOcr ?? false,
    rawText: extraction.text,
    metadata,
    entities,
  };
}
