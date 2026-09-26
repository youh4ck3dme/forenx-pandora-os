import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'crypto'
import {
  uploadCaseDocument,
  getPresignedDossierUrl,
  deleteCaseVault,
  downloadCaseDocument,
  isS3Configured,
  clearVaultFallback,
  getFallbackItemCount,
  listCaseDocumentsFallback,
} from '../storage/s3-vault'

describe('Hetzner S3 Cloud Vault Client (forenx-vault-sk)', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    delete process.env.S3_ACCESS_KEY_ID
    delete process.env.S3_SECRET_ACCESS_KEY
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    clearVaultFallback()
  })

  afterEach(() => {
    process.env = originalEnv
    clearVaultFallback()
  })

  describe('In-Memory Fallback & Validation', () => {
    it('isS3Configured returns false when env variables are not present', () => {
      expect(isS3Configured()).toBe(false)
    })

    it('throws error when caseId is empty or whitespace', async () => {
      const buffer = Buffer.from('test court document')
      await expect(
        uploadCaseDocument('', {
          name: 'spis-001.pdf',
          buffer,
          mimeType: 'application/pdf',
          sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        })
      ).rejects.toThrow('Case ID je povinný')
    })

    it('throws error when file payload is missing or invalid', async () => {
      await expect(
        uploadCaseDocument('CASE-2026-001', null as any)
      ).rejects.toThrow('Neplatný súbor')
    })

    it('uploads case document to in-memory vault and returns storage key', async () => {
      const content = 'Oficiálny súdny spis a dôkazný materiál (PΛND0RΛ FORENSIC)'
      const buffer = Buffer.from(content)
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      const storageKey = await uploadCaseDocument('CASE-KS-2026', {
        name: 'Rozsudok_54457_V.pdf',
        buffer,
        mimeType: 'application/pdf',
        sha256,
      })

      expect(storageKey).toBe(`cases/CASE-KS-2026/documents/${sha256}-Rozsudok_54457_V.pdf`)
      expect(getFallbackItemCount()).toBe(1)

      const items = listCaseDocumentsFallback('CASE-KS-2026')
      expect(items).toHaveLength(1)
      expect(items[0].fileName).toBe('Rozsudok_54457_V.pdf')
      expect(items[0].sizeBytes).toBe(buffer.length)
      expect(items[0].sha256).toBe(sha256)
    })

    it('generates presigned dossier URL in fallback mode', async () => {
      const buffer = Buffer.from('Spis 150MB test')
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      const storageKey = await uploadCaseDocument('CASE-101', {
        name: 'dossier.pdf',
        buffer,
        mimeType: 'application/pdf',
        sha256,
      })

      const presignedUrl = await getPresignedDossierUrl(storageKey, 1800)
      expect(presignedUrl).toContain('forenx-vault-sk')
      expect(presignedUrl).toContain(encodeURI(storageKey))
      expect(presignedUrl).toContain('vault_mode=fallback')
      expect(presignedUrl).toContain('sig=')
    })

    it('downloads document correctly from fallback vault', async () => {
      const buffer = Buffer.from('Tajný znalecký posudok č. 89/2026')
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      const storageKey = await uploadCaseDocument('CASE-999', {
        name: 'znalecky_posudok.pdf',
        buffer,
        mimeType: 'application/pdf',
        sha256,
      })

      const downloaded = await downloadCaseDocument(storageKey)
      expect(downloaded).not.toBeNull()
      expect(downloaded?.buffer.toString()).toBe('Tajný znalecký posudok č. 89/2026')
      expect(downloaded?.mimeType).toBe('application/pdf')
      expect(downloaded?.name).toBe('znalecky_posudok.pdf')
    })

    it('handles simulated 150 MB+ large file without failing', async () => {
      // Alokujeme 10 MB reálny buffer na rýchly a stabilný test veľkých dát
      const chunkSize = 10 * 1024 * 1024
      const largeBuffer = Buffer.alloc(chunkSize, 'A')
      const sha256 = crypto.createHash('sha256').update(largeBuffer).digest('hex')

      const storageKey = await uploadCaseDocument('CASE-LARGE-150MB', {
        name: 'forensic_raw_evidence_150mb.bin',
        buffer: largeBuffer,
        mimeType: 'application/octet-stream',
        sha256,
      })

      expect(storageKey).toContain('CASE-LARGE-150MB')
      expect(storageKey).toContain(sha256)

      const downloaded = await downloadCaseDocument(storageKey)
      expect(downloaded?.sizeBytes).toBe(chunkSize)
      expect(downloaded?.buffer.length).toBe(chunkSize)
    })

    it('deletes case vault items for specific case only', async () => {
      const buf1 = Buffer.from('Dokument pre prípad A')
      const buf2 = Buffer.from('Dokument pre prípad B')

      await uploadCaseDocument('CASE-A', {
        name: 'A.pdf',
        buffer: buf1,
        mimeType: 'application/pdf',
        sha256: crypto.createHash('sha256').update(buf1).digest('hex'),
      })

      await uploadCaseDocument('CASE-B', {
        name: 'B.pdf',
        buffer: buf2,
        mimeType: 'application/pdf',
        sha256: crypto.createHash('sha256').update(buf2).digest('hex'),
      })

      expect(getFallbackItemCount()).toBe(2)

      // Zmaž spis A
      await deleteCaseVault('CASE-A')

      expect(getFallbackItemCount()).toBe(1)
      expect(listCaseDocumentsFallback('CASE-A')).toHaveLength(0)
      expect(listCaseDocumentsFallback('CASE-B')).toHaveLength(1)
    })
  })

  describe('Live S3 Configuration & SigV4 URL Generation', () => {
    beforeEach(() => {
      process.env.S3_ACCESS_KEY_ID = 'test-access-key-id'
      process.env.S3_SECRET_ACCESS_KEY = 'test-secret-access-key-very-long'
      process.env.S3_ENDPOINT = 'https://hel1.your-objectstorage.com'
      process.env.S3_BUCKET = 'forenx-vault-sk'
      process.env.S3_REGION = 'hel1'
    })

    it('recognizes configured S3 credentials', () => {
      expect(isS3Configured()).toBe(true)
    })

    it('generates compliant AWS SigV4 presigned URL', async () => {
      const storageKey = 'cases/CASE-2026/documents/abcdef-rozsudok.pdf'
      const url = await getPresignedDossierUrl(storageKey, 3600)

      expect(url).toContain('https://hel1.your-objectstorage.com/forenx-vault-sk/')
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256')
      expect(url).toContain('X-Amz-Credential=test-access-key-id')
      expect(url).toContain('X-Amz-Expires=3600')
      expect(url).toContain('X-Amz-Signature=')
      expect(url).toContain('X-Amz-SignedHeaders=host')
    })
  })
})
