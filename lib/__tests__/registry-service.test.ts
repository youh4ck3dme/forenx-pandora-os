import { describe, it, expect, beforeEach } from 'vitest'
import {
  lookupCompanyByIco,
  parseRpoExtract,
  clearRegistryCache,
  getRegistryOmniboxSuggestions,
  CANONICAL_13_ACTIVITIES,
} from '../services/registry-service'

describe('RPO ŠÚ SR & WhoIsWho Intelligence Service', () => {
  beforeEach(() => {
    clearRegistryCache()
  })

  describe('RPO Parser & Canonical Entity Extraction', () => {
    it('contains exactly 13 canonical business activities', () => {
      expect(CANONICAL_13_ACTIVITIES).toHaveLength(13)
      expect(CANONICAL_13_ACTIVITIES).toContain('Forenzná analýza dát a audit informačných systémov')
      expect(CANONICAL_13_ACTIVITIES).toContain('Bezpečnostné poradenstvo v oblasti IT a kybernetickej bezpečnosti')
    })

    it('parses structured RPO extract with all 13 activities, statutory Róbert Papcun, court and capital', () => {
      const profile = parseRpoExtract({
        ico: '54457000',
        legalName: 'PΛND0RΛ FORENSIC s. r. o.',
        court: 'Mestský súd Košice',
        section: 'Sro',
        insertNumber: '54457/V',
        capital: '5 000 €',
        statutoryPersons: [
          {
            name: 'Róbert Papcun',
            role: 'konateľ',
            validFrom: '2021-01-01',
          },
        ],
        businessActivities: CANONICAL_13_ACTIVITIES,
      })

      expect(profile.ico).toBe('54457000')
      expect(profile.legalName).toBe('PΛND0RΛ FORENSIC s. r. o.')
      expect(profile.court).toBe('Mestský súd Košice')
      expect(profile.section).toBe('Sro')
      expect(profile.insertNumber).toBe('54457/V')
      expect(profile.capital).toBe('5 000 €')
      expect(profile.statutoryPersons).toHaveLength(1)
      expect(profile.statutoryPersons[0].name).toBe('Róbert Papcun')
      expect(profile.statutoryPersons[0].role).toBe('konateľ')
      expect(profile.businessActivities).toHaveLength(13)
      expect(profile.source.source).toBe('orsr')
    })

    it('parses text / HTML extract from ORSR correctly', () => {
      const orsrText = `
        Výpis z Obchodného registra Okresného súdu Košice I
        Oddiel: Sro, Vložka číslo: 54457/V
        Obchodné meno: PΛND0RΛ FORENSIC s. r. o.
        Sídlo: Hlavná 42, 040 01 Košice
        IČO: 54 457 000
        Štatutárny orgán: konateľ: Róbert Papcun
        Výška vkladu každého spoločníka: Róbert Papcun, Vklad: 5 000 €
        Predmet činnosti:
        - Kúpa tovaru na účely jeho predaja konečnému spotrebiteľovi
        - Počítačové služby a služby súvisiace s počítačovým spracovaním údajov
        - Výskum a vývoj v oblasti prírodných a technických vied
        - Bezpečnostné poradenstvo v oblasti IT
        - Forenzná analýza dát a audit informačných systémov
      `

      const profile = parseRpoExtract(orsrText)
      expect(profile.ico).toBe('54457000')
      expect(profile.court).toContain('Košice')
      expect(profile.insertNumber).toBe('54457/V')
      expect(profile.capital).toContain('5 000 €')
      expect(profile.statutoryPersons[0].name).toBe('Róbert Papcun')
      expect(profile.businessActivities.length).toBeGreaterThanOrEqual(13)
    })
  })

  describe('lookupCompanyByIco & Local Cache', () => {
    it('successfully retrieves company profile by IČO with 13 activities and court details', async () => {
      const profile = await lookupCompanyByIco('54457000')

      expect(profile).toBeDefined()
      expect(profile.ico).toBe('54457000')
      expect(profile.court).toBe('Mestský súd Košice')
      expect(profile.insertNumber).toBe('54457/V')
      expect(profile.capital).toBe('5 000 €')
      expect(profile.statutoryPersons[0].name).toBe('Róbert Papcun')
      expect(profile.businessActivities).toHaveLength(13)
      expect(profile.businessActivities[12]).toBe('Forenzná analýza dát a audit informačných systémov')
    })

    it('normalizes padded or unpadded IČO input correctly', async () => {
      const profile = await lookupCompanyByIco('  54457000  ')
      expect(profile.ico).toBe('54457000')
    })

    it('utilizes local cache for subsequent requests with identical IČO', async () => {
      const first = await lookupCompanyByIco('54457000')
      const second = await lookupCompanyByIco('54457000')

      // Identický odkaz z pamäťovej cache
      expect(first).toBe(second)
      expect(second.statutoryPersons[0].name).toBe('Róbert Papcun')
    })

    it('re-fetches after cache is explicitly cleared', async () => {
      const first = await lookupCompanyByIco('54457000')
      clearRegistryCache()
      const second = await lookupCompanyByIco('54457000')

      expect(first).not.toBe(second) // nový objekt
      expect(first.ico).toBe(second.ico)
    })
  })

  describe('Omnibox Integration', () => {
    it('returns empty array for empty or whitespace query', async () => {
      const suggestions = await getRegistryOmniboxSuggestions('   ')
      expect(suggestions).toHaveLength(0)
    })

    it('returns rich registry suggestion when user queries by IČO in omnibox', async () => {
      const suggestions = await getRegistryOmniboxSuggestions('54457000')

      expect(suggestions).toHaveLength(1)
      const s = suggestions[0]
      expect(s.type).toBe('registry')
      expect(s.ico).toBe('54457000')
      expect(s.url).toBe('/registry/54457000')
      expect(s.courtInfo).toContain('Mestský súd Košice')
      expect(s.courtInfo).toContain('54457/V')
      expect(s.description).toContain('Róbert Papcun')
      expect(s.activitiesCount).toBe(13)
    })

    it('supports prefix ico: in omnibox search', async () => {
      const suggestions = await getRegistryOmniboxSuggestions('ico:54457000')

      expect(suggestions).toHaveLength(1)
      expect(suggestions[0].ico).toBe('54457000')
      expect(suggestions[0].activitiesCount).toBe(13)
    })
  })
})
