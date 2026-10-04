/**
 * storage-idb.ts - IndexedDB Storage Layer
 * High-performance async storage for history, bookmarks, and settings
 * Uses idb-keyval for simple key-value operations
 */

import { get, set, del, keys, createStore } from 'idb-keyval'
import type { HistoryItem, Bookmark, Settings, Tab } from './storage'
import { config } from '../config'

// Create dedicated stores for better performance isolation
const historyStore = createStore('pandora-history-db', 'history')
const bookmarksStore = createStore('pandora-bookmarks-db', 'bookmarks')
const settingsStore = createStore('pandora-settings-db', 'settings')
const tabsStore = createStore('pandora-tabs-db', 'tabs')

// =============================================================================
// HISTORY - Full IndexedDB persistence
// =============================================================================

export async function getHistoryIDB(): Promise<HistoryItem[]> {
  try {
    const history = await get<HistoryItem[]>('items', historyStore)
    return history || []
  } catch (error) {
    console.error('[IDB] Failed to get history:', error)
    return []
  }
}

export async function setHistoryIDB(history: HistoryItem[]): Promise<void> {
  try {
    // Enforce max limit
    const trimmed = history.slice(0, config.browser.maxHistoryItems)
    await set('items', trimmed, historyStore)
  } catch (error) {
    console.error('[IDB] Failed to set history:', error)
  }
}

export async function addHistoryItemIDB(
  url: string,
  title: string,
  favicon?: string
): Promise<void> {
  const history = await getHistoryIDB()
  const existingIndex = history.findIndex((h) => h.url === url)

  if (existingIndex >= 0) {
    // Update existing entry
    history[existingIndex].visitedAt = Date.now()
    history[existingIndex].visitCount++
    history[existingIndex].title = title
    if (favicon) history[existingIndex].favicon = favicon
    // Move to top
    const item = history.splice(existingIndex, 1)[0]
    history.unshift(item)
  } else {
    // Add new entry
    history.unshift({
      id: Date.now().toString(),
      title,
      url,
      favicon,
      visitedAt: Date.now(),
      visitCount: 1,
    })
  }

  await setHistoryIDB(history)
}

export async function deleteHistoryItemIDB(id: string): Promise<void> {
  const history = await getHistoryIDB()
  const filtered = history.filter((h) => h.id !== id)
  await setHistoryIDB(filtered)
}

export async function clearHistoryIDB(): Promise<void> {
  await del('items', historyStore)
}

/**
 * Optimized history search using in-memory filtering
 * For 1000+ items, this is still fast enough (<10ms)
 * If we need even faster, we can add FlexSearch index
 */
export async function searchHistoryIDB(
  query: string,
  limit = 10
): Promise<HistoryItem[]> {
  if (!query || query.length < 2) return []

  const history = await getHistoryIDB()
  const lowerQuery = query.toLowerCase()

  return history
    .filter(
      (h) =>
        h.title.toLowerCase().includes(lowerQuery) ||
        h.url.toLowerCase().includes(lowerQuery)
    )
    .slice(0, limit)
}

// =============================================================================
// BOOKMARKS - Full IndexedDB persistence
// =============================================================================

export async function getBookmarksIDB(): Promise<Bookmark[]> {
  try {
    const bookmarks = await get<Bookmark[]>('items', bookmarksStore)
    return bookmarks || []
  } catch (error) {
    console.error('[IDB] Failed to get bookmarks:', error)
    return []
  }
}

export async function setBookmarksIDB(bookmarks: Bookmark[]): Promise<void> {
  try {
    const trimmed = bookmarks.slice(0, config.browser.maxBookmarks)
    await set('items', trimmed, bookmarksStore)
  } catch (error) {
    console.error('[IDB] Failed to set bookmarks:', error)
  }
}

export async function addBookmarkIDB(bookmark: Bookmark): Promise<void> {
  const bookmarks = await getBookmarksIDB()
  const existingIndex = bookmarks.findIndex((b) => b.url === bookmark.url)

  if (existingIndex >= 0) {
    bookmarks[existingIndex] = bookmark
  } else {
    bookmarks.unshift(bookmark)
  }

  await setBookmarksIDB(bookmarks)
}

export async function deleteBookmarkIDB(id: string): Promise<void> {
  const bookmarks = await getBookmarksIDB()
  const filtered = bookmarks.filter((b) => b.id !== id)
  await setBookmarksIDB(filtered)
}

export async function isBookmarkedIDB(url: string): Promise<boolean> {
  const bookmarks = await getBookmarksIDB()
  return bookmarks.some((b) => b.url === url)
}

// =============================================================================
// SETTINGS - IndexedDB with localStorage fallback for SSR
// =============================================================================

export async function getSettingsIDB(): Promise<Settings> {
  try {
    const settings = await get<Settings>('config', settingsStore)
    return (
      settings || {
        theme: 'dark',
        sidebarOpen: false,
        searchEngine: config.browser.defaultSearchEngine,
        homePage: config.browser.defaultHomePage,
      }
    )
  } catch (error) {
    console.error('[IDB] Failed to get settings:', error)
    return {
      theme: 'dark',
      sidebarOpen: false,
      searchEngine: config.browser.defaultSearchEngine,
      homePage: config.browser.defaultHomePage,
    }
  }
}

export async function setSettingsIDB(settings: Partial<Settings>): Promise<void> {
  try {
    const current = await getSettingsIDB()
    await set('config', { ...current, ...settings }, settingsStore)
  } catch (error) {
    console.error('[IDB] Failed to set settings:', error)
  }
}

// =============================================================================
// TABS - Hybrid: localStorage for fast sync + IDB for persistence
// =============================================================================

export async function getTabsIDB(): Promise<Tab[]> {
  try {
    const tabs = await get<Tab[]>('items', tabsStore)
    return tabs || []
  } catch (error) {
    console.error('[IDB] Failed to get tabs:', error)
    return []
  }
}

export async function setTabsIDB(tabs: Tab[]): Promise<void> {
  try {
    await set('items', tabs, tabsStore)
  } catch (error) {
    console.error('[IDB] Failed to set tabs:', error)
  }
}

// =============================================================================
// INITIALIZATION & MIGRATION
// =============================================================================

/**
 * Initialize IDB storage and migrate from localStorage if needed
 * Should be called once on app startup
 */
export async function initializeStorageIDB(): Promise<void> {
  if (typeof window === 'undefined') return

  try {
    // Check if we need to migrate from localStorage
    const localHistory = localStorage.getItem(config.storage.keys.history)
    const idbHistory = await getHistoryIDB()

    if (localHistory && idbHistory.length === 0) {
      console.info('[IDB] Migrating history from localStorage...')
      const parsed = JSON.parse(localHistory) as HistoryItem[]
      await setHistoryIDB(parsed)
      // Keep localStorage for fast reads but mark as migrated
      localStorage.setItem('pandora_idb_migrated', 'true')
    }

    // Same for bookmarks
    const localBookmarks = localStorage.getItem(config.storage.keys.bookmarks)
    const idbBookmarks = await getBookmarksIDB()

    if (localBookmarks && idbBookmarks.length === 0) {
      console.info('[IDB] Migrating bookmarks from localStorage...')
      const parsed = JSON.parse(localBookmarks) as Bookmark[]
      await setBookmarksIDB(parsed)
    }

    console.info('[IDB] Storage initialized successfully')
  } catch (error) {
    console.error('[IDB] Initialization failed:', error)
  }
}

/**
 * Get storage stats for debugging
 */
export async function getStorageStats(): Promise<{
  historyCount: number
  bookmarksCount: number
}> {
  const history = await getHistoryIDB()
  const bookmarks = await getBookmarksIDB()
  return {
    historyCount: history.length,
    bookmarksCount: bookmarks.length,
  }
}
