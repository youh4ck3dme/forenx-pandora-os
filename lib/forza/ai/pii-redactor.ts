/**
 * Redakcia osobných identifikátorov z voľného textu (OCR výstup, popisy)
 * pred odoslaním do LLM.
 *
 * Tolerancia OCR: medzery medzi číslicami, lomka/bez lomky, rozdelené skupiny
 * IBAN, medzery okolo „@" a bodiek v e-maile, fullwidth číslice (NFKC).
 *
 * Nikdy nelogovať vstupný text — funkcia vracia len počty nahradení.
 */

export type RedactionCategory =
  | "birth_number"
  | "iban"
  | "id_document"
  | "email"
  | "phone"
  | "masked_term";

export type RedactionOptions = {
  /** Mená, adresy či iné reťazce, ktoré sa majú maskovať (bez ohľadu na medzery a veľkosť písmen). */
  maskTerms?: string[];
};

export type RedactionResult = {
  text: string;
  counts: Record<RedactionCategory, number>;
};

const SEP = "[\\s./-]?";

/** Rodné číslo SK/CZ: RRMMDD/XXX(X), aj s medzerami z OCR. */
const BIRTH_NUMBER = new RegExp(
  `(?<![\\d])(\\d{2})\\s?(\\d{2})\\s?(\\d{2})\\s?([/\\\\])?\\s?(\\d{3,4})(?![\\d])`,
  "g",
);

const IBAN_COUNTRIES =
  "AT|BE|BG|CH|CY|CZ|DE|DK|EE|ES|FI|FR|GB|GR|HR|HU|IE|IT|LI|LT|LU|LV|MT|NL|NO|PL|PT|RO|SE|SI|SK";
const IBAN = new RegExp(
  `\\b(?:${IBAN_COUNTRIES})\\s?\\d{2}(?:\\s?[A-Z0-9]){11,30}\\b`,
  "gi",
);

/** OP (2 písmená + 6 číslic), pas (1–2 písmená + 7 číslic). */
const ID_DOCUMENT = /\b[A-Z]{1,2}\s?\d{3}\s?\d{3,4}\b/g;

const EMAIL =
  /[\p{L}\d._%+-]+\s?@\s?[\p{L}\d-]+(?:\s?\.\s?[\p{L}\d-]+)*\s?\.\s?[a-z]{2,}/giu;

const PHONE = new RegExp(
  [
    // medzinárodný formát +421 / 00421 / +420 …
    `(?:\\+|\\b00)\\s?\\d{1,3}(?:${SEP}\\d){6,12}\\b`,
    // SK/CZ mobil 09xx xxx xxx
    `\\b0\\s?9\\d(?:${SEP}\\d){7}\\b`,
  ].join("|"),
  "g",
);

function validBirthNumber(
  yy: string,
  mm: string,
  dd: string,
  slash: string | undefined,
  tail: string,
): boolean {
  let month = Number(mm);
  if (month > 70) month -= 70;
  else if (month > 50) month -= 50;
  else if (month > 20) month -= 20;
  const day = Number(dd);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (tail.length === 3) {
    // Pred rokom 1954 bez kontrolnej číslice — bez lomky príliš nejednoznačné.
    return Boolean(slash);
  }
  const digits = `${yy}${mm}${dd}${tail}`;
  const head = Number(digits.slice(0, 9));
  const check = Number(digits.slice(9));
  const mod = head % 11;
  return (mod === 10 ? 0 : mod) === check || Number(digits) % 11 === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term: string): RegExp | null {
  const parts = term.normalize("NFKC").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.join("").length < 3) return null;
  return new RegExp(parts.map(escapeRegExp).join("[\\s,.-]*"), "giu");
}

export function redactPii(input: string, options: RedactionOptions = {}): RedactionResult {
  const counts: Record<RedactionCategory, number> = {
    birth_number: 0,
    iban: 0,
    id_document: 0,
    email: 0,
    phone: 0,
    masked_term: 0,
  };
  let text = input.normalize("NFKC");

  for (const term of options.maskTerms ?? []) {
    const pattern = termPattern(term);
    if (!pattern) continue;
    text = text.replace(pattern, () => {
      counts.masked_term += 1;
      return "[SUBJEKT]";
    });
  }

  text = text.replace(EMAIL, () => {
    counts.email += 1;
    return "[EMAIL]";
  });
  text = text.replace(IBAN, (match) => {
    const compact = match.replace(/\s/g, "");
    if (compact.length < 15 || compact.length > 34) return match;
    counts.iban += 1;
    return "[IBAN]";
  });
  text = text.replace(BIRTH_NUMBER, (match, yy, mm, dd, slash, tail) => {
    if (!validBirthNumber(yy, mm, dd, slash, tail)) return match;
    counts.birth_number += 1;
    return "[RODNÉ_ČÍSLO]";
  });
  text = text.replace(PHONE, () => {
    counts.phone += 1;
    return "[TELEFÓN]";
  });
  text = text.replace(ID_DOCUMENT, () => {
    counts.id_document += 1;
    return "[DOKLAD]";
  });

  return { text, counts };
}
