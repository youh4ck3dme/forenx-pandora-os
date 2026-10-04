/**
 * Obsah pre autopilota odvodený PRIAMO z WORM ledgera — jediný spôsob, ako
 * môže byť záver z autopilota viazaný na dôkaz.
 *
 * Text od klienta nemá dokázateľný pôvod: model by k nemu vedel priradiť ID
 * ľubovoľného overeného dôkazu prípadu. Preto sa pri väzbe text NEPREBERÁ od
 * klienta, ale server:
 *   1. načíta záznam evidence_items (RLS: vlastník, daný prípad, stav verified),
 *   2. stiahne objekt z úložiska a overí SHA-256 bajtov voči ledgeru,
 *   3. extrahuje text sám a označí ho evidenceId dokumentu.
 */

/** SHA-256 cez Web Crypto — modul sa dostane aj do klientskeho bundlu (bez node:crypto). */
async function sha256Hex(buffer: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(buffer));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const MAX_LEDGER_DOCUMENTS = 10;
export const MAX_LEDGER_BYTES = 60 * 1024 * 1024;

export type LedgerRow = {
  id: string;
  file_name: string;
  file_size: number;
  sha256_hash: string;
  s3_object_key: string;
  hash_verification_status: string;
};

export type LedgerDocument = { evidenceId: string; fileName: string; text: string; sha256: string };

export type LedgerSourceDeps = {
  /** Záznamy pre dané ID (RLS klient používateľa). */
  fetchRows: (ids: string[]) => Promise<LedgerRow[]>;
  download: (storageKey: string) => Promise<Buffer | null>;
  extract: (fileName: string, buffer: Buffer) => Promise<string>;
};

export type LedgerLoadResult = {
  documents: LedgerDocument[];
  rejected: { evidenceId: string; reason: string }[];
};

/** Hlavička dokumentu v texte pre model; rovnaký vzor sa v obsahu zneškodní. */
export const EVIDENCE_HEADER = (evidenceId: string, fileName: string) =>
  `=== DÔKAZ evidenceId=${evidenceId} (${fileName.replace(/[\r\n=]/g, " ").slice(0, 120)}) ===`;

function neutralizeHeaders(text: string): string {
  return text.replace(/={2,}\s*DÔKAZ\s+evidenceId\s*=/giu, "[odstránená hlavička dôkazu]");
}

export async function loadLedgerDocuments(
  caseId: string,
  evidenceIds: readonly string[],
  deps: LedgerSourceDeps,
): Promise<LedgerLoadResult> {
  const unique = [...new Set(evidenceIds.map((id) => id.trim()).filter(Boolean))];
  const rejected: LedgerLoadResult["rejected"] = [];
  if (unique.length > MAX_LEDGER_DOCUMENTS) {
    throw new Error(`Naraz možno analyzovať najviac ${MAX_LEDGER_DOCUMENTS} dôkazov.`);
  }
  const rows = new Map((await deps.fetchRows(unique)).map((row) => [row.id, row]));
  const prefix = `cases/${caseId}/evidence/`;
  let totalBytes = 0;
  const documents: LedgerDocument[] = [];

  for (const id of unique) {
    const row = rows.get(id);
    if (!row) { rejected.push({ evidenceId: id, reason: "not_found" }); continue; }
    if (!row.s3_object_key.startsWith(prefix)) { rejected.push({ evidenceId: id, reason: "other_case" }); continue; }
    if (row.hash_verification_status !== "verified") { rejected.push({ evidenceId: id, reason: "not_verified" }); continue; }
    totalBytes += row.file_size;
    if (totalBytes > MAX_LEDGER_BYTES) { rejected.push({ evidenceId: id, reason: "size_limit" }); continue; }

    const buffer = await deps.download(row.s3_object_key);
    if (!buffer) { rejected.push({ evidenceId: id, reason: "object_missing" }); continue; }
    const sha = await sha256Hex(buffer);
    if (sha !== row.sha256_hash.toLowerCase() || buffer.byteLength !== row.file_size) {
      rejected.push({ evidenceId: id, reason: "hash_mismatch" });
      continue;
    }
    const text = neutralizeHeaders(await deps.extract(row.file_name, buffer));
    if (!text.trim()) { rejected.push({ evidenceId: id, reason: "empty_text" }); continue; }
    documents.push({ evidenceId: row.id, fileName: row.file_name, text, sha256: sha });
  }
  return { documents, rejected };
}

/** Text pre autopilota: každý dokument pod hlavičkou so svojím evidenceId. */
export function ledgerDocumentsText(documents: readonly LedgerDocument[]): string {
  return documents.map((d) => `${EVIDENCE_HEADER(d.evidenceId, d.fileName)}\n${d.text}`).join("\n\n");
}
