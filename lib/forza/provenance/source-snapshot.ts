import { sha256HexBytes } from "./sha256";

/**
 * Nemenný záznam o jednej odpovedi externého zdroja (register, API).
 * `raw_sha256` sa počíta z pôvodných bajtov odpovede, nie z parsovaného
 * výsledku — parser sa môže zmeniť, bajty nie.
 */
export type SourceSnapshot = {
  source: string;
  source_url: string;
  http_status: number;
  retrieved_at: string;
  content_type: string | null;
  parser_version: string;
  raw_sha256: string;
  byte_size: number;
  storage_ref: string | null;
  etag: string | null;
  last_modified: string | null;
};

export type CapturedResponse = {
  snapshot: SourceSnapshot;
  /** Pôvodné bajty — parsujú sa až po zaznamenaní hashu. */
  bytes: Uint8Array;
};

/**
 * Prečíta telo odpovede ako bajty a vytvorí snapshot. Telo sa dá prečítať len
 * raz, preto volajúci parsuje `bytes`, nie `response`.
 */
export async function captureResponse(
  response: Response,
  meta: {
    source: string;
    parserVersion: string;
    storageRef?: string | null;
    now?: () => Date;
  },
): Promise<CapturedResponse> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const now = meta.now ?? (() => new Date());
  return {
    bytes,
    snapshot: {
      source: meta.source,
      source_url: response.url,
      http_status: response.status,
      retrieved_at: now().toISOString(),
      content_type: response.headers.get("content-type"),
      parser_version: meta.parserVersion,
      raw_sha256: sha256HexBytes(bytes),
      byte_size: bytes.byteLength,
      storage_ref: meta.storageRef ?? null,
      etag: response.headers.get("etag"),
      last_modified: response.headers.get("last-modified"),
    },
  };
}
