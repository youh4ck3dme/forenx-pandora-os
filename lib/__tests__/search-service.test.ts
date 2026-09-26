import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SearchService } from '../services/search-service'
import { Bookmark, HistoryItem } from '@/lib/storage'
import { electron } from '@/lib/api'

// Mock Electron API
vi.mock('@/lib/api', () => ({
  electron: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn()
  },
  isElectron: () => true
}))

// Mock Config
vi.mock('@/lib/config', () => ({
  config: {
    browser: {
      defaultSearchEngine: 'https://google.com/search?q='
    }
  }
}))

describe('SearchService', () => {
  let searchService: SearchService
  const mockHistory: HistoryItem[] = [
    { id: '1', title: 'GitHub', url: 'https://github.com', visitedAt: Date.now(), visitCount: 10 },
    { id: '2', title: 'React Documentation', url: 'https://react.dev', visitedAt: Date.now(), visitCount: 5 }
  ]
  const mockBookmarks: Bookmark[] = [
    { id: 'b1', title: 'Localhost', url: 'http://localhost:3000', createdAt: Date.now() },
    { id: 'b2', title: 'Vercel', url: 'https://vercel.com', createdAt: Date.now() }
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    searchService = new SearchService(mockHistory, mockBookmarks)
  })

  it('should return command suggestions for /cmd', async () => {
    const results = await searchService.getSuggestions('/new')
    expect(results).toHaveLength(1)
    expect(results[0].type).toBe('command')
    expect(results[0].id).toBe('cmd-new')
  })

  it('should find local bookmarks', async () => {
    const results = await searchService.getSuggestions('vercel')
    const bookmark = results.find(r => r.type === 'bookmark')
    expect(bookmark).toBeDefined()
    expect(bookmark?.title).toBe('Vercel')
  })

  it('should find history items', async () => {
    const results = await searchService.getSuggestions('react')
    const hist = results.find(r => r.type === 'history')
    expect(hist).toBeDefined()
    expect(hist?.url).toBe('https://react.dev')
  })

  it('should call electron IPC for remote suggestions', async () => {
    // Mock IPC response
    const mockSuggestions = [
      { id: 'search-ddg-test', title: 'test query', url: '...', type: 'search' }
    ];
    (electron.invoke as any).mockResolvedValue(mockSuggestions)

    const results = await searchService.getSuggestions('test')

    expect(electron.invoke).toHaveBeenCalledWith('search:suggestions', 'test')
    expect(results).toContainEqual(mockSuggestions[0])
  })

  it('should handle electron IPC errors gracefully', async () => {
    (electron.invoke as any).mockRejectedValue(new Error('IPC Error'))
    const results = await searchService.getSuggestions('error')
    // Should still return local results or empty array, not crash
    expect(results).toBeInstanceOf(Array)
  })
})
