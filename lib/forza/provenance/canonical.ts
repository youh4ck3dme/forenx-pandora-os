import { sha256Hex } from "./sha256";

/**
 * Kanonická JSON serializácia pre hashovanie manifestov a snapshotov.
 *
 * Pravidlá (verzia CANONICAL_VERSION):
 * - kľúče objektov sa rekurzívne zoradia podľa UTF-16 kódových jednotiek,
 * - poradie polí sa zachováva (poradie je významové),
 * - reťazce sa normalizujú do Unicode NFC, takže „é" zložené a predkomponované
 *   dáva rovnaký hash,
 * - čísla musia byť konečné; -0 sa zapíše ako 0; žiadne locale formátovanie,
 * - `undefined` vo vlastnosti objektu sa vynechá, v poli je chyba,
 * - Date sa zapíše ako ISO 8601 UTC,
 * - funkcie, symboly, bigint, NaN a Infinity sú chyba — hash nesmie potichu
 *   pokryť iné dáta, než volajúci myslí.
 */
export const CANONICAL_VERSION = "forenx-canonical-json-v1";

export class CanonicalizationError extends Error {
  constructor(path: string, reason: string) {
    super(`Nekanonizovateľná hodnota na ${path || "<root>"}: ${reason}`);
    this.name = "CanonicalizationError";
  }
}

function serialize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value.normalize("NFC"));
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(path, "číslo nie je konečné");
      }
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object":
      break;
    default:
      throw new CanonicalizationError(path, `nepodporovaný typ ${typeof value}`);
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new CanonicalizationError(path, "neplatný dátum");
    }
    return JSON.stringify(value.toISOString());
  }
  if (seen.has(value)) throw new CanonicalizationError(path, "cyklická referencia");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = value.map((item, index) => {
        if (item === undefined) {
          throw new CanonicalizationError(`${path}[${index}]`, "undefined v poli");
        }
        return serialize(item, `${path}[${index}]`, seen);
      });
      return `[${items.join(",")}]`;
    }
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key.normalize("NFC"), item] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < entries.length; i++) {
      if (entries[i]?.[0] === entries[i - 1]?.[0]) {
        throw new CanonicalizationError(path, "duplicitný kľúč po NFC normalizácii");
      }
    }
    const members = entries.map(
      ([key, item]) => `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`, seen)}`,
    );
    return `{${members.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "", new Set());
}

/** SHA-256 (hex) kanonickej serializácie. */
export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
