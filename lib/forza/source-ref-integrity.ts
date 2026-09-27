/**
 * Invarianty štruktúrovaných odkazov na zdroj (SourceRef) v dossieri.
 *
 * SourceRef je polymorfný (vyskytuje sa v časovej osi, stopách, útokoch
 * obhajoby, dôkazoch …), preto validátor prechádza celý objekt a kontroluje
 * každý kľúč `sourceRef`:
 * - dokument musí existovať medzi dokumentmi analýzy,
 * - `page` je celé číslo >= 1 a <= page_count (ak je počet strán známy),
 * - odkaz bez známeho dokumentu je „dangling" a z dossieru sa odstráni
 *   (textové pole `source` ostáva ako neoverený popis).
 */

export type KnownDocument = { id: string; pageCount?: number | null };

export type SourceRefIssue = {
  path: string;
  reason: "unknown_document" | "invalid_page" | "page_out_of_range" | "malformed";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkRef(ref: unknown, docs: Map<string, KnownDocument>): SourceRefIssue["reason"] | null {
  if (!isRecord(ref) || typeof ref.documentId !== "string" || !ref.documentId.trim()) {
    return "malformed";
  }
  const doc = docs.get(ref.documentId);
  if (!doc) return "unknown_document";
  if (ref.page !== undefined && ref.page !== null) {
    if (typeof ref.page !== "number" || !Number.isInteger(ref.page) || ref.page < 1) {
      return "invalid_page";
    }
    if (doc.pageCount != null && ref.page > doc.pageCount) return "page_out_of_range";
  }
  return null;
}

export function validateSourceRefs(value: unknown, documents: KnownDocument[]): SourceRefIssue[] {
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  const issues: SourceRefIssue[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(node)) return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key === "sourceRef" && child !== undefined && child !== null) {
        const reason = checkRef(child, docs);
        if (reason) issues.push({ path: childPath, reason });
        continue;
      }
      walk(child, childPath);
    }
  };
  walk(value, "");
  return issues;
}

/** Vráti kópiu bez neplatných SourceRef a zoznam odstránených odkazov. */
export function enforceSourceRefIntegrity<T>(
  value: T,
  documents: KnownDocument[],
): { value: T; removed: SourceRefIssue[] } {
  const docs = new Map(documents.map((doc) => [doc.id, doc]));
  const removed: SourceRefIssue[] = [];
  const clone = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => clone(item, `${path}[${index}]`));
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key === "sourceRef" && child !== undefined && child !== null) {
        const reason = checkRef(child, docs);
        if (reason) {
          removed.push({ path: childPath, reason });
          continue;
        }
        out[key] = child;
        continue;
      }
      out[key] = clone(child, childPath);
    }
    return out;
  };
  return { value: clone(value, "") as T, removed };
}
