import crypto from "crypto";
import { z } from "zod";

export interface CaseDocumentFile {
  name: string;
  buffer: Buffer;
  mimeType: string;
  sha256: string;
}

export interface CaseVaultItem {
  storageKey: string;
  caseId: string;
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

// In-Memory Fallback Storage (active when S3_* credentials are not set)
interface StoredItem {
  caseId: string;
  fileName: string;
  buffer: Buffer;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
  uploadedAt: string;
}

const fallbackVaultStore = new Map<string, StoredItem>();

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);
const caseIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const storageKeySchema = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^cases\/[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]+$/)
  .refine(
    (key) => !key.split("/").some((segment) => segment === "." || segment === ".."),
    "Storage key contains an unsafe path segment.",
  );
const expiresInSchema = z.number().int().min(1).max(604_800);
const mimeTypeSchema = z.string().trim().min(1).max(255).regex(/^[^\r\n]+$/);
const metadataSchema = z.record(
  z.string().regex(/^[a-z0-9-]+$/),
  z.string().min(1).max(1024).regex(/^[^\r\n]+$/),
);

function requireStorageKey(storageKey: string): string {
  const parsed = storageKeySchema.safeParse(storageKey);
  if (!parsed.success) {
    throw new Error("Neplatný alebo nebezpečný storageKey pre trezor.");
  }
  return parsed.data;
}

function requireExpiresIn(expiresIn: number): number {
  const parsed = expiresInSchema.safeParse(expiresIn);
  if (!parsed.success) {
    throw new Error("Platnosť predpodpísanej URL musí byť 1 až 604800 sekúnd.");
  }
  return parsed.data;
}

/**
 * Získa konfiguráciu S3 z premenných prostredia.
 * Vracia null, ak chýbajú kľúče (pre bezpečný fallback).
 */
export function getS3Config(): S3Config | null {
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const endpoint =
    process.env.S3_ENDPOINT || "https://hel1.your-objectstorage.com";
  const bucket = process.env.S3_BUCKET || "forenx-vault-sk";
  const region = process.env.S3_REGION || "hel1";

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
  };
}

/**
 * Overí, či je Hetzner S3 úložisko nakonfigurované.
 */
export function isS3Configured(): boolean {
  return getS3Config() !== null;
}

/**
 * Vyčistí lokálnu in-memory vyrovnávaciu pamäť (určené pre unit testy).
 */
export function clearVaultFallback(): void {
  fallbackVaultStore.clear();
}

/**
 * Vráti počet položiek v lokálnej in-memory pamäti.
 */
export function getFallbackItemCount(): number {
  return fallbackVaultStore.size;
}

// SigV4 kryptografické pomocné funkcie
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Fallback (bez S3) podpisy: HMAC-SHA256 s tajným kľúčom, nikdy hash bez kľúča.
// V produkcii je fallback zakázaný úplne — in-memory úložisko nie je trvalé
// ani zdieľané medzi inštanciami.
let ephemeralFallbackSecret: Buffer | null = null;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function fallbackSecret(): Buffer {
  if (isProduction()) {
    throw new Error(
      "S3 úložisko nie je nakonfigurované (S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY). In-memory fallback je v produkcii zakázaný.",
    );
  }
  const configured = process.env.VAULT_FALLBACK_SECRET;
  if (configured) {
    if (configured.length < 32) {
      throw new Error("VAULT_FALLBACK_SECRET musí mať aspoň 32 znakov.");
    }
    return Buffer.from(configured, "utf8");
  }
  // Vývoj/testy bez nastaveného kľúča: náhodný kľúč platný len pre tento proces.
  ephemeralFallbackSecret ??= crypto.randomBytes(32);
  return ephemeralFallbackSecret;
}

function fallbackSignature(
  purpose: "get" | "put",
  storageKey: string,
  expiresAt: number,
): string {
  return crypto
    .createHmac("sha256", fallbackSecret())
    .update(`forenx-vault-fallback-v1
${purpose}
${storageKey}
${expiresAt}`, "utf8")
    .digest("hex");
}

/**
 * Overí podpis fallback URL (konštantný čas, kontrola expirácie).
 */
export function verifyFallbackSignature(
  purpose: "get" | "put",
  storageKey: string,
  expiresAt: number,
  signature: string,
  now = Date.now(),
): boolean {
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false;
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = Buffer.from(fallbackSignature(purpose, storageKey, expiresAt), "hex");
  return crypto.timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service = "s3",
): Buffer {
  const kDate = hmac("AWS4" + secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * 1. Upload súdneho PDF alebo spisu (až do 150 MB+) do Hetzner S3 bucketu `forenx-vault-sk`.
 * Pri absencii S3 konfigurácie automaticky ukladá do in-memory úložiska.
 */
export async function uploadCaseDocument(
  caseId: string,
  file: { name: string; buffer: Buffer; mimeType: string; sha256: string },
): Promise<string> {
  const parsedCaseId = caseIdSchema.safeParse(caseId);
  if (!parsedCaseId.success) {
    throw new Error("Case ID je povinný pre uloženie do trezoru.");
  }
  if (!file || !file.name || !file.buffer) {
    throw new Error("Neplatný súbor: chýba názov alebo binárny obsah.");
  }
  const suppliedHash = sha256Schema.safeParse(file.sha256);
  if (!suppliedHash.success) {
    throw new Error("Neplatný SHA-256 odtlačok súboru.");
  }
  if (!mimeTypeSchema.safeParse(file.mimeType).success) {
    throw new Error("Neplatný MIME typ súboru.");
  }
  const calculatedSha256 = sha256Hex(file.buffer);
  if (calculatedSha256 !== suppliedHash.data.toLowerCase()) {
    throw new Error("SHA-256 odtlačok súboru nezodpovedá jeho binárnemu obsahu.");
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageKey = `cases/${parsedCaseId.data}/documents/${calculatedSha256}-${sanitizedFileName}`;
  const now = new Date().toISOString();

  const config = getS3Config();

  if (!config) {
    // In-memory fallback (v produkcii fallbackSecret() hodí chybu).
    fallbackSecret();
    fallbackVaultStore.set(storageKey, {
      caseId: parsedCaseId.data,
      fileName: file.name,
      buffer: file.buffer,
      mimeType: file.mimeType || "application/octet-stream",
      sha256: calculatedSha256,
      sizeBytes: file.buffer.length,
      uploadedAt: now,
    });
    return storageKey;
  }

  // Live S3 Upload cez HTTP PUT s AWS SigV4 autorizáciou
  const dateObj = new Date();
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const url = `${config.endpoint}/${config.bucket}/${storageKey}`;
  const host = new URL(config.endpoint).host;

  const payloadHash = calculatedSha256;
  const canonicalUri = `/${config.bucket}/${storageKey}`;
  const canonicalQuery = "";
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      "Content-Type": file.mimeType || "application/octet-stream",
      "x-amz-date": amzDate,
      "x-amz-content-sha256": payloadHash,
      Authorization: authorizationHeader,
    },
    body: new Uint8Array(file.buffer),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Zlyhal upload do S3 (${response.status}): ${errorText || response.statusText}`,
    );
  }

  return storageKey;
}

/**
 * 2. Vygeneruje predpodpísanú URL pre prístup k súdnemu spisu s obmedzenou platnosťou.
 */
export async function getPresignedDossierUrl(
  storageKey: string,
  expiresIn = 3600,
): Promise<string> {
  const validatedStorageKey = requireStorageKey(storageKey);
  const validatedExpiresIn = requireExpiresIn(expiresIn);

  const config = getS3Config();

  if (!config) {
    // In-memory fallback (mimo produkcie): HMAC podpis s tajným kľúčom.
    const expiresAt = Date.now() + validatedExpiresIn * 1000;
    const sig = fallbackSignature("get", validatedStorageKey, expiresAt);
    return `https://hel1.your-objectstorage.com/forenx-vault-sk/${encodeURI(validatedStorageKey)}?vault_mode=fallback&expires=${expiresAt}&sig=${sig}`;
  }

  // AWS SigV4 Presigned URL
  const dateObj = new Date();
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const host = new URL(config.endpoint).host;
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": validatedExpiresIn.toString(),
    "X-Amz-SignedHeaders": "host",
  });

  // Zoradenie query parametrov
  queryParams.sort();
  const canonicalQuery = queryParams.toString();
  const canonicalUri = `/${config.bucket}/${validatedStorageKey}`;
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${config.endpoint}/${config.bucket}/${validatedStorageKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * 3. Zmaže všetky dokumenty patriace danému spisu z trezoru.
 */
export async function deleteCaseVault(caseId: string): Promise<void> {
  if (!caseId || !caseId.trim()) {
    throw new Error("Case ID je povinný pre vymazanie trezoru.");
  }

  const prefix = `cases/${caseId}/`;

  const config = getS3Config();

  if (!config) {
    // Vyčistenie in-memory fallback store
    for (const key of Array.from(fallbackVaultStore.keys())) {
      if (key.startsWith(prefix)) {
        fallbackVaultStore.delete(key);
      }
    }
    return;
  }

  // Live S3 vymazanie cez REST API
  const listUrl = `${config.endpoint}/${config.bucket}?prefix=${encodeURIComponent(prefix)}`;
  try {
    const res = await fetch(listUrl);
    if (res.ok) {
      const text = await res.text();
      const keyMatches = text.match(/<Key>(.*?)<\/Key>/g) || [];
      const keys = keyMatches.map((m) => m.replace(/<\/?Key>/g, ""));

      await Promise.all(
        keys.map(async (key) => {
          await fetch(`${config.endpoint}/${config.bucket}/${key}`, {
            method: "DELETE",
          });
        }),
      );
    }
  } catch (err) {
    console.error(`[PΛND0RΛ S3 Vault] Chyba pri mazaní spisu ${caseId}:`, err);
  }
}

export interface DownloadedCaseDocument {
  buffer: Buffer;
  mimeType: string;
  name: string;
  sizeBytes: number;
}

/**
 * Získa dokument z trezoru (in-memory alebo cez S3 fetch).
 */
export async function downloadCaseDocument(
  storageKey: string,
): Promise<DownloadedCaseDocument | null> {
  const fallback = fallbackVaultStore.get(storageKey);
  if (fallback) {
    return {
      buffer: fallback.buffer,
      mimeType: fallback.mimeType,
      name: fallback.fileName,
      sizeBytes: fallback.sizeBytes,
    };
  }

  const config = getS3Config();
  if (!config) return null;

  try {
    const presignedUrl = await getPresignedDossierUrl(storageKey, 300);
    const res = await fetch(presignedUrl);
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    return {
      buffer,
      mimeType: res.headers.get("content-type") || "application/octet-stream",
      name: storageKey.split("/").pop() || "document",
      sizeBytes: buffer.length,
    };
  } catch (err) {
    console.error(`[PΛND0RΛ S3 Vault] Chyba pri sťahovaní ${storageKey}:`, err);
    return null;
  }
}

/**
 * Vráti zoznam uložených dokumentov pre daný spis z in-memory pamäte.
 */
export function listCaseDocumentsFallback(caseId: string): CaseVaultItem[] {
  const prefix = `cases/${caseId}/`;
  const items: CaseVaultItem[] = [];

  for (const [key, item] of fallbackVaultStore.entries()) {
    if (key.startsWith(prefix)) {
      items.push({
        storageKey: key,
        caseId: item.caseId,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sha256: item.sha256,
        sizeBytes: item.sizeBytes,
        uploadedAt: item.uploadedAt,
      });
    }
  }

  return items;
}

/**
 * 5. Vygeneruje predpodpísanú URL pre priamy upload (HTTP PUT) z prehliadača do Hetzner/AWS S3.
 * Obchádza 4.5 MB serverless limit Vercelu a podporuje súbory až do 250 MB.
 */
export async function getPresignedUploadUrl(
  storageKey: string,
  options: {
    mimeType?: string;
    sha256?: string;
    expiresIn?: number;
    metadata?: Record<string, string>;
  } = {},
): Promise<string> {
  const validatedStorageKey = requireStorageKey(storageKey);
  const expiresIn = requireExpiresIn(options.expiresIn ?? 300);
  const mimeType = mimeTypeSchema.parse(options.mimeType ?? "application/octet-stream");
  const sha256 = sha256Schema.parse(options.sha256 ?? "");
  const metadata = metadataSchema.parse(options.metadata ?? {});
  const requiredHeaders = {
    "content-type": mimeType,
    "x-amz-content-sha256": sha256.toLowerCase(),
    ...Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value]),
    ),
  };

  const config = getS3Config();

  if (!config) {
    // In-memory fallback PUT URL (mimo produkcie): HMAC podpis s tajným kľúčom.
    const expiresAt = Date.now() + expiresIn * 1000;
    const sig = fallbackSignature("put", validatedStorageKey, expiresAt);
    return `https://hel1.your-objectstorage.com/forenx-vault-sk/${encodeURI(validatedStorageKey)}?vault_mode=fallback_put&expires=${expiresAt}&sig=${sig}`;
  }

  // AWS SigV4 Presigned PUT URL
  const dateObj = new Date();
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);
  const host = new URL(config.endpoint).host;
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const queryParams = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": expiresIn.toString(),
    "X-Amz-SignedHeaders": ["host", ...Object.keys(requiredHeaders)].sort().join(";"),
  });

  queryParams.sort();
  const canonicalQuery = queryParams.toString();
  const canonicalUri = `/${config.bucket}/${validatedStorageKey}`;
  const signedHeaderEntries = Object.entries(requiredHeaders)
    .map(([name, value]) => [name, value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const canonicalHeaders = [
    `host:${host}`,
    ...signedHeaderEntries.map(([name, value]) => `${name}:${value}`),
  ].join("\n") + "\n";
  const signedHeaders = ["host", ...signedHeaderEntries.map(([name]) => name)].join(";");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256.toLowerCase(),
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSigningKey(
    config.secretAccessKey,
    dateStamp,
    config.region,
  );
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return `${config.endpoint}/${config.bucket}/${validatedStorageKey}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
