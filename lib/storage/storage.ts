import { config } from "../config"

// Types
export interface Tab {
  id: string
  title: string
  url: string
  favicon?: string
  isLoading?: boolean
  isPinned?: boolean
  isMuted?: boolean
  lastAccessed?: number
  spaceId?: 'default' | 'work' | 'dev'
}

export interface Bookmark {
  id: string
  title: string
  url: string
  favicon?: string
  folderId?: string
  createdAt: number
}

export interface HistoryItem {
  id: string
  title: string
  url: string
  favicon?: string
  visitedAt: number
  visitCount: number
}

export interface Settings {
  theme: "dark" | "light" | "system"
  sidebarOpen: boolean
  searchEngine: string
  homePage: string
  proxy?: {
    type: "none" | "http" | "socks5"
    host: string
    port: string
    username?: string
    password?: string
  }
}

// Helper functions
function safeJSONParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function safeLocalStorage<T>(key: string, action: "get" | "set" | "remove", value?: T): T | null {
  if (typeof window === "undefined") return null

  try {
    if (action === "get") {
      return safeJSONParse(localStorage.getItem(key), null as T)
    }
    if (action === "set" && value !== undefined) {
      localStorage.setItem(key, JSON.stringify(value))
      return value
    }
    if (action === "remove") {
      localStorage.removeItem(key)
    }
    return null
  } catch (error) {
    console.error(`[Storage] Error ${action} ${key}:`, error)
    return null
  }
}

// Tabs
export function saveTabs(tabs: Tab[]): void {
  safeLocalStorage(config.storage.keys.tabs, "set", tabs)
}

export function getTabs(): Tab[] {
  return safeLocalStorage<Tab[]>(config.storage.keys.tabs, "get") || []
}

export function clearTabs(): void {
  safeLocalStorage(config.storage.keys.tabs, "remove")
}

// Closed Tabs (for Ctrl+Shift+T)
export function saveClosedTab(tab: Tab): void {
  const closedTabs = getClosedTabs()
  closedTabs.unshift(tab)
  // Keep only last 10 closed tabs
  safeLocalStorage(config.storage.keys.closedTabs, "set", closedTabs.slice(0, 10))
}

export function getClosedTabs(): Tab[] {
  return safeLocalStorage<Tab[]>(config.storage.keys.closedTabs, "get") || []
}

export function popClosedTab(): Tab | null {
  const closedTabs = getClosedTabs()
  if (closedTabs.length === 0) return null
  const tab = closedTabs.shift()!
  safeLocalStorage(config.storage.keys.closedTabs, "set", closedTabs)
  return tab
}

// Bookmarks
export function saveBookmark(bookmark: Bookmark): void {
  const bookmarks = getBookmarks()
  const existingIndex = bookmarks.findIndex((b) => b.url === bookmark.url)

  if (existingIndex >= 0) {
    bookmarks[existingIndex] = bookmark
  } else {
    if (bookmarks.length >= config.browser.maxBookmarks) {
      bookmarks.pop()
    }
    bookmarks.unshift(bookmark)
  }

  safeLocalStorage(config.storage.keys.bookmarks, "set", bookmarks)
}

export function getBookmarks(): Bookmark[] {
  return safeLocalStorage<Bookmark[]>(config.storage.keys.bookmarks, "get") || []
}

export function deleteBookmark(id: string): void {
  const bookmarks = getBookmarks().filter((b) => b.id !== id)
  safeLocalStorage(config.storage.keys.bookmarks, "set", bookmarks)
}

export function isBookmarked(url: string): boolean {
  return getBookmarks().some((b) => b.url === url)
}

// History
export function saveHistory(url: string, title: string, favicon?: string): void {
  const history = getHistory()
  const existingIndex = history.findIndex((h) => h.url === url)

  if (existingIndex >= 0) {
    history[existingIndex].visitedAt = Date.now()
    history[existingIndex].visitCount++
    history[existingIndex].title = title
    // Move to top
    const item = history.splice(existingIndex, 1)[0]
    history.unshift(item)
  } else {
    if (history.length >= config.browser.maxHistoryItems) {
      history.pop()
    }
    history.unshift({
      id: Date.now().toString(),
      title,
      url,
      favicon,
      visitedAt: Date.now(),
      visitCount: 1,
    })
  }

  safeLocalStorage(config.storage.keys.history, "set", history)
}

export function getHistory(): HistoryItem[] {
  return safeLocalStorage<HistoryItem[]>(config.storage.keys.history, "get") || []
}

export function clearHistory(): void {
  safeLocalStorage(config.storage.keys.history, "remove")
}

export function deleteHistoryItem(id: string): void {
  const history = getHistory().filter((h) => h.id !== id)
  safeLocalStorage(config.storage.keys.history, "set", history)
}

// Settings
export function saveSettings(settings: Partial<Settings>): void {
  const current = getSettings()
  safeLocalStorage(config.storage.keys.settings, "set", { ...current, ...settings })
}

export function getSettings(): Settings {
  return (
    safeLocalStorage<Settings>(config.storage.keys.settings, "get") || {
      theme: "dark",
      sidebarOpen: false,
      searchEngine: config.browser.defaultSearchEngine,
      homePage: config.browser.defaultHomePage,
    }
  )
}

// Search suggestions from history and bookmarks
export function getSearchSuggestions(
  query: string,
  limit = 8,
): Array<{ title: string; url: string; type: "bookmark" | "history" }> {
  if (!query || query.length < 2) return []

  const lowerQuery = query.toLowerCase()
  const results: Array<{ title: string; url: string; type: "bookmark" | "history"; score: number }> = []

  // Search bookmarks
  getBookmarks().forEach((b) => {
    if (b.title.toLowerCase().includes(lowerQuery) || b.url.toLowerCase().includes(lowerQuery)) {
      results.push({ title: b.title, url: b.url, type: "bookmark", score: 2 })
    }
  })

  // Search history
  getHistory().forEach((h) => {
    if (h.title.toLowerCase().includes(lowerQuery) || h.url.toLowerCase().includes(lowerQuery)) {
      // Avoid duplicates from bookmarks
      if (!results.some((r) => r.url === h.url)) {
        results.push({ title: h.title, url: h.url, type: "history", score: 1 })
      }
    }
  })

  // Sort by score (bookmarks first) and return limited results
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ title, url, type }) => ({ title, url, type }))
}

// Downloads
export interface DownloadItem {
  id: string
  fileName: string
  fileSize: string
  url: string
  status: 'completed' | 'failed' | 'in-progress' | 'paused' | 'cancelled'
  timestamp: number
  receivedBytes?: number
  totalBytes?: number
}

export function saveDownload(download: DownloadItem): void {
  const downloads = getDownloads()
  downloads.unshift(download)
  // Keep last 50
  if (downloads.length > 50) downloads.pop()
  safeLocalStorage(config.storage.keys.downloads, "set", downloads)
}

export function getDownloads(): DownloadItem[] {
  return safeLocalStorage<DownloadItem[]>(config.storage.keys.downloads, "get") || []
}

export function clearDownloads(): void {
  safeLocalStorage(config.storage.keys.downloads, "remove")
}
