import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  lookupCompanyByIco,
  clearRegistryCache,
  getIcoAtlasConfig,
  mapIcoAtlasResponse,
} from '../services/registry-service'

const TEST_KEY = 'test-ico-atlas-key-0123456789-should-never-be-logged'
const BASE = 'https://api.whoiswho.at/atlas'

const atlasPayload = {
  ico: '35763469',
  legalName: 'Slovak Telekom, a.s.',
  country: 'SK',
  statutoryPersons: [{ name: 'Ján Testovací', role: 'predseda predstavenstva', validFrom: '2020-01-01' }],
  businessActivities: ['Poskytovanie elektronických komunikačných služieb', '  '],
  source: {
    source: 'rpo',
    sourceVersion: 'rpo-v1',
    sourceUrl: 'https://rpo.statistics.sk/example',
    capturedAt: '2026-10-12T20:00:00.000Z',
  },
  legalForm: 'Akciová spoločnosť',
  registeredAddress: 'Bajkalská 28, 817 62 Bratislava',
  status: 'active',
  incorporatedAt: '1999-12-30',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('ICO Atlas lookup (lookupCompanyByIco)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    clearRegistryCache()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('ICO_ATLAS_API_URL', `${BASE}/`)
    vi.stubEnv('ICO_ATLAS_API_KEY', TEST_KEY)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    clearRegistryCache()
  })

  function allLogOutput(): string {
    return [warnSpy, logSpy, errorSpy]
      .flatMap((spy) => spy.mock.calls.flat())
      .map((arg) => (arg instanceof Error ? `${arg.name} ${arg.message}` : String(arg)))
      .join('\n')
  }

  it('calls GET {ICO_ATLAS_API_URL}/api/v1/companies/sk/{ico} with Bearer key and maps 200 response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, atlasPayload))

    const profile = await lookupCompanyByIco('35763469')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/api/v1/companies/sk/35763469`)
    expect((init as RequestInit).method ?? 'GET').toBe('GET')
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` })

    expect(profile.ico).toBe('35763469')
    expect(profile.legalName).toBe('Slovak Telekom, a.s.')
    expect(profile.legalForm).toBe('Akciová spoločnosť')
    expect(profile.registeredAddress).toBe('Bajkalská 28, 817 62 Bratislava')
    expect(profile.status).toBe('active')
    expect(profile.incorporatedAt).toBe('1999-12-30')
    expect(profile.country).toBe('SK')
    expect(profile.statutoryPersons).toEqual([
      { name: 'Ján Testovací', role: 'predseda predstavenstva', validFrom: '2020-01-01', validTo: undefined },
    ])
    expect(profile.businessActivities).toEqual(['Poskytovanie elektronických komunikačných služieb'])
    expect(profile.source.source).toBe('ico-atlas')
    expect(profile.source.sourceVersion).toBe('rpo-v1')
    expect(profile.source.sourceUrl).toBe('https://rpo.statistics.sk/example')
    expect(profile.source.capturedAt).toBe('2026-10-12T20:00:00.000Z')
    // Žiadne vymyslené dáta z lokálneho parsera
    expect(profile.court).toBeUndefined()

    expect(allLogOutput()).not.toContain(TEST_KEY)
  })

  it('caches successful online result (second call does not fetch)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, atlasPayload))
    const first = await lookupCompanyByIco('35763469')
    const second = await lookupCompanyByIco('35763469')
    expect(first).toBe(second)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles 401 (rejected/missing key) without leaking key or Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' }))

    const profile = await lookupCompanyByIco('35763469')

    expect(profile.source.source).not.toBe('ico-atlas')
    const logs = allLogOutput()
    expect(logs).toContain('HTTP 401')
    expect(logs).not.toContain(TEST_KEY)
    expect(logs).not.toMatch(/authorization|bearer/i)
  })

  it('handles 404 with sanitized warning', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: 'not found' }))
    const profile = await lookupCompanyByIco('35763469')
    expect(profile.source.source).not.toBe('ico-atlas')
    expect(allLogOutput()).toContain('HTTP 404')
    expect(allLogOutput()).not.toContain(TEST_KEY)
  })

  it('sanitizes network errors (logs only error name, never message/key)', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`boom Bearer ${TEST_KEY}`))
    await lookupCompanyByIco('35763469')
    const logs = allLogOutput()
    expect(logs).toContain('zlyhal: Error')
    expect(logs).not.toContain(TEST_KEY)
    expect(logs).not.toMatch(/bearer/i)
  })

  it('fails closed without key: no network call', async () => {
    vi.stubEnv('ICO_ATLAS_API_KEY', '')
    expect(getIcoAtlasConfig()).toBeNull()
    await lookupCompanyByIco('35763469')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed without URL: no network call', async () => {
    vi.stubEnv('ICO_ATLAS_API_URL', '')
    expect(getIcoAtlasConfig()).toBeNull()
    await lookupCompanyByIco('35763469')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-HTTPS ICO_ATLAS_API_URL: no network call', async () => {
    vi.stubEnv('ICO_ATLAS_API_URL', 'http://api.whoiswho.at/atlas')
    expect(getIcoAtlasConfig()).toBeNull()
    vi.stubEnv('ICO_ATLAS_API_URL', 'not a url')
    expect(getIcoAtlasConfig()).toBeNull()
    await lookupCompanyByIco('35763469')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims trailing slashes from the HTTPS base URL', () => {
    vi.stubEnv('ICO_ATLAS_API_URL', `${BASE}///`)
    expect(getIcoAtlasConfig()).toEqual({ baseUrl: BASE, apiKey: TEST_KEY })
  })

  it('validates IČO format (6–8 digits) before any network call', async () => {
    await expect(lookupCompanyByIco('12345')).rejects.toThrow('6 až 8 číslic')
    await expect(lookupCompanyByIco('123456789')).rejects.toThrow('6 až 8 číslic')
    await expect(lookupCompanyByIco('12ab5678')).rejects.toThrow('6 až 8 číslic')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mapIcoAtlasResponse rejects payload without legalName', () => {
    expect(() => mapIcoAtlasResponse({ ico: '35763469' }, '35763469')).toThrow('legalName')
    expect(() => mapIcoAtlasResponse(null, '35763469')).toThrow('neplatná odpoveď')
  })
})