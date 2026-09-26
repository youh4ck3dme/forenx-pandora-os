import crypto from 'crypto'

export interface CaseDocumentFile {
  name: string
  buffer: Buffer
  mimeType: string
  sha256: string
}

export interface CaseVaultItem {
  storageKey: string
  caseId: string
  fileName: string
  mimeType: string
  sha256: string
  sizeBytes: number
  uploadedAt: string
}

export interface S3Config {
  endpoint: string
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
}

// In-Memory Fallback Storage (active when S3_* credentials are not set)
interface StoredItem {
  caseId: string
  fileName: string
  buffer: Buffer
  mimeType: string
  sha256: string
  sizeBytes: number
  uploadedAt: string
}

const fallbackVaultStore = new Map<string, StoredItem>()

/**
 * Získa konfiguráciu S3 z premenných prostredia.
 * Vracia null, ak chýbajú kľúče (pre bezpečný fallback).
 */
export function getS3Config(): S3Config | null {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY
  const endpoint = process.env.S3_ENDPOINT || 'https://hel1.your-objectstorage.com'
  const bucket = process.env.S3_BUCKET || 'forenx-vault-sk'
  const region = process.env.S3_REGION || 'hel1'

  if (!accessKeyId || !secretAccessKey) {
    return null
  }

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
  }
}

/**
 * Overí, či je Hetzner S3 úložisko nakonfigurované.
 */
export function isS3Configured(): boolean {
  return getS3Config() !== null
}

/**
 * Vyčistí lokálnu in-memory vyrovnávaciu pamäť (určené pre unit testy).
 */
export function clearVaultFallback(): void {
  fallbackVaultStore.clear()
}

/**
 * Vráti počet položiek v lokálnej in-memory pamäti.
 */
export function getFallbackItemCount(): number {
  return fallbackVaultStore.size
}

// SigV4 kryptografické pomocné funkcie
function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function getSigningKey(secretKey: string, dateStamp: string, region: string, service = 's3'): Buffer {
  const kDate = hmac('AWS4' + secretKey, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  return hmac(kService, 'aws4_request')
}

/**
 * 1. Upload súdneho PDF alebo spisu (až do 150 MB+) do Hetzner S3 bucketu `forenx-vault-sk`.
 * Pri absencii S3 konfigurácie automaticky ukladá do in-memory úložiska.
 */
export async function uploadCaseDocument(
  caseId: string,
  file: { name: string; buffer: Buffer; mimeType: string; sha256: string }
): Promise<string> {
  if (!caseId || !caseId.trim()) {
    throw new Error('Case ID je povinný pre uloženie do trezoru.')
  }
  if (!file || !file.name || !file.buffer) {
    throw new Error('Neplatný súbor: chýba názov alebo binárny obsah.')
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const calculatedSha256 = file.sha256 || sha256Hex(file.buffer)
  const storageKey = `cases/${caseId}/documents/${calculatedSha256}-${sanitizedFileName}`
  const now = new Date().toISOString()

  const config = getS3Config()

  if (!config) {
    // In-memory fallback
    fallbackVaultStore.set(storageKey, {
      caseId,
      fileName: file.name,
      buffer: file.buffer,
      mimeType: file.mimeType || 'application/octet-stream',
      sha256: calculatedSha256,
      sizeBytes: file.buffer.length,
      uploadedAt: now,
    })
    return storageKey
  }

  // Live S3 Upload cez HTTP PUT s AWS SigV4 autorizáciou
  const dateObj = new Date()
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.substring(0, 8)
  const url = `${config.endpoint}/${config.bucket}/${storageKey}`
  const host = new URL(config.endpoint).host

  const payloadHash = calculatedSha256
  const canonicalUri = `/${config.bucket}/${storageKey}`
  const canonicalQuery = ''
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region)
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Host: host,
      'Content-Type': file.mimeType || 'application/octet-stream',
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorizationHeader,
    },
    body: file.buffer,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Zlyhal upload do S3 (${response.status}): ${errorText || response.statusText}`)
  }

  return storageKey
}

/**
 * 2. Vygeneruje predpodpísanú URL pre prístup k súdnemu spisu s obmedzenou platnosťou.
 */
export async function getPresignedDossierUrl(
  storageKey: string,
  expiresIn = 3600
): Promise<string> {
  if (!storageKey || !storageKey.trim()) {
    throw new Error('Chýba storageKey pre vygenerovanie predpodpísanej URL.')
  }

  const config = getS3Config()

  if (!config) {
    // In-memory / Mock Presigned URL
    const expiresAt = Date.now() + expiresIn * 1000
    const mockSig = sha256Hex(`fallback:${storageKey}:${expiresAt}`).substring(0, 32)
    return `https://hel1.your-objectstorage.com/forenx-vault-sk/${encodeURI(storageKey)}?vault_mode=fallback&expires=${expiresAt}&sig=${mockSig}`
  }

  // AWS SigV4 Presigned URL
  const dateObj = new Date()
  const amzDate = dateObj.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.substring(0, 8)
  const host = new URL(config.endpoint).host
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresIn.toString(),
    'X-Amz-SignedHeaders': 'host',
  })

  // Zoradenie query parametrov
  queryParams.sort()
  const canonicalQuery = queryParams.toString()
  const canonicalUri = `/${config.bucket}/${storageKey}`
  const canonicalHeaders = `host:${host}\n`
  const signedHeaders = 'host'

  const canonicalRequest = [
    'GET',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region)
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')

  return `${config.endpoint}/${config.bucket}/${storageKey}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/**
 * 3. Zmaže všetky dokumenty patriace danému spisu z trezoru.
 */
export async function deleteCaseVault(caseId: string): Promise<void> {
  if (!caseId || !caseId.trim()) {
    throw new Error('Case ID je povinný pre vymazanie trezoru.')
  }

  const prefix = `cases/${caseId}/`

  const config = getS3Config()

  if (!config) {
    // Vyčistenie in-memory fallback store
    for (const key of Array.from(fallbackVaultStore.keys())) {
      if (key.startsWith(prefix)) {
        fallbackVaultStore.delete(key)
      }
    }
    return
  }

  // Live S3 vymazanie cez REST API
  const listUrl = `${config.endpoint}/${config.bucket}?prefix=${encodeURIComponent(prefix)}`
  try {
    const res = await fetch(listUrl)
    if (res.ok) {
      const text = await res.text()
      const keyMatches = text.match(/<Key>(.*?)<\/Key>/g) || []
      const keys = keyMatches.map((m) => m.replace(/<\/?Key>/g, ''))

      await Promise.all(
        keys.map(async (key) => {
          await fetch(`${config.endpoint}/${config.bucket}/${key}`, {
            method: 'DELETE',
          })
        })
      )
    }
  } catch (err) {
    console.error(`[PΛND0RΛ S3 Vault] Chyba pri mazaní spisu ${caseId}:`, err)
  }
}

export interface DownloadedCaseDocument {
  buffer: Buffer
  mimeType: string
  name: string
  sizeBytes: number
}

/**
 * Získa dokument z trezoru (in-memory alebo cez S3 fetch).
 */
export async function downloadCaseDocument(
  storageKey: string
): Promise<DownloadedCaseDocument | null> {
  const fallback = fallbackVaultStore.get(storageKey)
  if (fallback) {
    return {
      buffer: fallback.buffer,
      mimeType: fallback.mimeType,
      name: fallback.fileName,
      sizeBytes: fallback.sizeBytes,
    }
  }

  const config = getS3Config()
  if (!config) return null

  try {
    const presignedUrl = await getPresignedDossierUrl(storageKey, 300)
    const res = await fetch(presignedUrl)
    if (!res.ok) return null
    const arrayBuf = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    return {
      buffer,
      mimeType: res.headers.get('content-type') || 'application/octet-stream',
      name: storageKey.split('/').pop() || 'document',
      sizeBytes: buffer.length,
    }
  } catch (err) {
    console.error(`[PΛND0RΛ S3 Vault] Chyba pri sťahovaní ${storageKey}:`, err)
    return null
  }
}

/**
 * Vráti zoznam uložených dokumentov pre daný spis z in-memory pamäte.
 */
export function listCaseDocumentsFallback(caseId: string): CaseVaultItem[] {
  const prefix = `cases/${caseId}/`
  const items: CaseVaultItem[] = []

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
      })
    }
  }

  return items
}
