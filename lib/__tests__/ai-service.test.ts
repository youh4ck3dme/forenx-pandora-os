import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateCompletion, generateImage, readStream } from '../services/ai-service'

describe('ai-service', () => {
  const apiKey = 'test-api-key'

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generateCompletion', () => {
    it('should throw error if apiKey is missing', async () => {
      await expect(generateCompletion([], '')).rejects.toThrow('API kľúč chýba.')
    })

    it('should make correct api call', async () => {
      const mockResponse = {
        ok: true,
        body: 'stream'
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      await generateCompletion([{ role: 'user', content: 'Hi' }], apiKey)

      expect(fetch).toHaveBeenCalledWith('https://api.mistral.ai/v1/chat/completions', expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
            'Authorization': `Bearer ${apiKey}`
        }),
        body: expect.stringContaining('"model":"mistral-large-latest"')
      }))
    })

    it('should handle api error', async () => {
      const mockResponse = {
        ok: false,
        json: async () => ({ error: { message: 'Quota exceeded' } })
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      await expect(generateCompletion([{ role: 'user', content: 'Hi' }], apiKey)).rejects.toThrow('Quota exceeded')
    })
  })

  describe('generateImage', () => {
    it('should return image url on success', async () => {
      const mockResponse = {
        ok: true,
        json: async () => ({ data: [{ url: 'https://example.com/img.png' }] })
      }
      vi.mocked(fetch).mockResolvedValue(mockResponse as any)

      const url = await generateImage('cat', apiKey)
      expect(url).toBe('https://example.com/img.png')
    })

    it('should throw if api errors', async () => {
         const mockResponse = {
            ok: false,
            json: async () => ({ error: { message: 'Image gen failed' } })
          }
          vi.mocked(fetch).mockResolvedValue(mockResponse as any)

          await expect(generateImage('cat', apiKey)).rejects.toThrow('Image gen failed')
    })
  })

  describe('readStream', () => {
    it('should parse SSE chunks correctly', async () => {
      const chunks = [
        'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n',
        'data: {"choices": [{"delta": {"content": " World"}}]}\n\n'
      ]

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
          controller.close()
        }
      })

      const reader = stream.getReader()
      const onChunk = vi.fn()

      await readStream(reader, onChunk)

      expect(onChunk).toHaveBeenCalledTimes(2)
      expect(onChunk).toHaveBeenNthCalledWith(1, 'Hello')
      expect(onChunk).toHaveBeenNthCalledWith(2, ' World')
    })
  })
})
