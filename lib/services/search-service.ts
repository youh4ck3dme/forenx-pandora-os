import Fuse from 'fuse.js'
import { HistoryItem, Bookmark } from '@/lib/storage'
import { Settings, Command, X, History, Download, Smartphone } from 'lucide-react'
import { electron } from '@/lib/api'

export type SuggestionType = 'bookmark' | 'history' | 'history-ai' | 'command' | 'search'

export interface Suggestion {
  id: string
  title: string
  url: string
  type: SuggestionType
  description?: string
  icon?: any // Lucide icon component or string
  score?: number
}

// Pre-defined commands
const COMMANDS: Suggestion[] = [
  { id: 'cmd-new', title: 'New Tab', url: '/new', type: 'command', description: 'Open a new tab', icon: Command },
  { id: 'cmd-close', title: 'Close Tab', url: '/close', type: 'command', description: 'Close current tab', icon: X },
  { id: 'cmd-hist', title: 'Open History', url: '/history', type: 'command', description: 'View browsing history', icon: History },
  { id: 'cmd-dl', title: 'Open Downloads', url: '/downloads', type: 'command', description: 'View downloads', icon: Download },
  { id: 'cmd-sets', title: 'Settings', url: '/settings', type: 'command', description: 'Browser settings', icon: Settings },
  { id: 'cmd-mob', title: 'Send to Mobile', url: '/mobile', type: 'command', description: 'Share tab to device', icon: Smartphone },
]

export class SearchService {
  private historyFuse: Fuse<HistoryItem>
  private bookmarksFuse: Fuse<Bookmark>
  private commandsFuse: Fuse<Suggestion>

  /**
   * Initialize SearchService with history and bookmark data sources.
   * @param history - Array of history items
   * @param bookmarks - Array of bookmarks
   */
  constructor(history: HistoryItem[], bookmarks: Bookmark[]) {
    this.historyFuse = new Fuse(history, {
      keys: ['title', 'url'],
      threshold: 0.4,
      includeScore: true
    })
    this.bookmarksFuse = new Fuse(bookmarks, {
      keys: ['title', 'url'],
      threshold: 0.3,
      includeScore: true
    })
    this.commandsFuse = new Fuse(COMMANDS, {
      keys: ['title', 'description', 'url'],
      threshold: 0.3,
      includeScore: true
    })
  }

  public updateData(history: HistoryItem[], bookmarks: Bookmark[]) {
    this.historyFuse.setCollection(history)
    this.bookmarksFuse.setCollection(bookmarks)
  }

  /**
   * Get search suggestions based on query input.
   * Handles commands (/cmd), local search (history/bookmarks), and remote suggestions.
   * @param query - The search string
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    if (!query.trim()) return []

    const normalizedQuery = query.toLowerCase()
    const isCommand = normalizedQuery.startsWith('/')
    const effectiveQuery = isCommand ? normalizedQuery.slice(1) : normalizedQuery

    let suggestions: Suggestion[] = []

    // 1. COMMANDS
    if (isCommand) {
      const cmdResults = effectiveQuery
        ? this.commandsFuse.search(effectiveQuery).map(r => ({ ...r.item, score: r.score }))
        : COMMANDS.map(c => ({ ...c, score: 0 }))
      return cmdResults as Suggestion[]
    }

    // 2. PARALLEL SEARCHES (Local + Remote)
    const [localResults, remoteResults] = await Promise.all([
      this.searchLocal(effectiveQuery),
      this.searchRemote(effectiveQuery)
    ])

    // 3. MERGE & DEDUPLICATE
    suggestions = [...localResults]

    // Add remote results if they don't duplicate local URLs (unlikely for search check)
    // OR duplicate titles
    remoteResults.forEach(remote => {
      const exists = suggestions.some(local =>
        (local.title?.toLowerCase() || '') === (remote.title?.toLowerCase() || '') ||
        local.url === remote.url
      )
      if (!exists) {
        suggestions.push(remote)
      }
    })

    // Limit results
    return suggestions.slice(0, 8)
  }

  private searchLocal(query: string): Suggestion[] {
    const results: Suggestion[] = []

    // Bookmarks (Priority)
    const bResults = this.bookmarksFuse.search(query)
      .slice(0, 3)
      .map(r => ({
        id: r.item.id,
        title: r.item.title,
        url: r.item.url,
        type: 'bookmark' as SuggestionType,
        score: r.score,
        description: 'Bookmark'
      }))

    results.push(...bResults)

    // History
    const hResults = this.historyFuse.search(query)
      .slice(0, 5)
      .map(r => ({
        id: r.item.id,
        title: r.item.title,
        url: r.item.url,
        type: 'history' as SuggestionType,
        score: r.score,
        description: r.item.visitedAt ? new Date(r.item.visitedAt).toLocaleDateString() : 'History'
      }))

    // Deduplicate History against Bookmarks
    hResults.forEach(h => {
      if (!results.some(b => b.url === h.url)) {
        results.push(h)
      }
    })

    return results.sort((a, b) => (a.score || 1) - (b.score || 1))
  }

  /**
   * Fetch search suggestions from remote source (Electron IPC).
   * @param query - The search string
   */
  private async searchRemote(query: string): Promise<Suggestion[]> {
    // Skip for URLs / Localhost
    if (query.includes('://') || query.includes('localhost') || query.includes('.')) {
      return []
    }

    try {
      // Electron Mode
      if (typeof window !== 'undefined') {
        const result = await electron.invoke('search:suggestions', query)
        if (result) return result
      }

      // Web Mode: API routes are disabled for static export.
      // To enable web suggestions, a CORS proxy or backend service is needed.
      return []
    } catch (e) {
      console.error('Search suggestion error:', e)
      return []
    }
  }
}
