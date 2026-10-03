import { create } from 'zustand';
import { persist } from 'zustand/middleware'
import { Tab, HistoryItem, Bookmark } from '@/lib/storage'
import { config } from '@/lib/config'
import { electron, isElectron } from '@/lib/api'
import { getHistoryIDB, getBookmarksIDB, setHistoryIDB, setBookmarksIDB, addHistoryItemIDB, addBookmarkIDB, deleteHistoryItemIDB, deleteBookmarkIDB, initializeStorageIDB } from '@/lib/storage'

/**
 * Core state management for the PANDORA PWA Browser.
 * Handles tabs, navigation, sidebar state, and wallet integration.
 */
interface BrowserState {
  /** Active tabs in the current session */
  tabs: Tab[]
  /** ID of the currently focused tab */
  activeTabId: string
  /** Whether the right-side utility panel is visible */
  sidebarOpen: boolean
  /** Active view within the sidebar panel */
  sidebarView: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'wallet' | 'shield' | 'passwords'
  /** Toggle for the universal command palette (Cmd+K) */
  commandPaletteOpen: boolean
  /** Toggle for the AI Copilot overlay */
  copilotOpen: boolean
  /** Selected AI model for Copilot */
  copilotModel: 'gpt-4o' | 'gemini-pro' | 'mistral-large-latest' | 'mistral-small-latest'
  /** User provided Mistral API key */
  mistralApiKey: string | null
  /** User provided API key for AI services (backward compatibility) */
  openaiApiKey: string | null
  /** Current isolation space (Context) */
  activeSpace: 'default' | 'work' | 'dev'
  /** History of closed tabs for 'Restore' functionality */
  closedTabs: Tab[]

  // Actions
  setTabs: (tabs: Tab[]) => void
  addTab: (tab: Tab) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTab: (id: string, updates: Partial<Tab>, fromIpc?: boolean) => void
  toggleSidebar: () => void
  setSidebarView: (view: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'wallet' | 'shield' | 'passwords') => void
  openSidebarPanel: (view: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'wallet' | 'shield' | 'passwords') => void
  toggleCommandPalette: (open?: boolean) => void
  clearAllData: () => Promise<void>
  setActiveSpace: (space: 'default' | 'work' | 'dev') => void
  toggleCopilot: () => void
  setCopilotModel: (model: 'gpt-4o' | 'gemini-pro' | 'mistral-large-latest' | 'mistral-small-latest') => void
  setMistralApiKey: (key: string | null) => void
  setOpenaiApiKey: (key: string | null) => void

  // Phase 4
  duplicateTab: (id: string) => void
  togglePinTab: (id: string) => void
  closeOtherTabs: (id: string) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void
  reopenTab: () => void

  // Wallet
  wallets: string[]
  activeWallet: string | null
  walletBalances: Record<string, { eth: string; matic: string; ethUsd: string; maticUsd: string; totalUsd: string; lastUpdated: number }>
  addWallet: (address: string) => void
  removeWallet: (address: string) => void
  setActiveWallet: (address: string | null) => void
  updateWalletBalance: (address: string, balance: { eth: string; matic: string; ethUsd: string; maticUsd: string; totalUsd: string; lastUpdated: number }) => void

  // Extensions
  extensions: { id: string; name: string; version: string; description?: string }[]
  loadExtensions: () => Promise<void>
  installExtension: (path: string) => Promise<void>

  // Shield (Privacy)
  shieldEnabled: boolean
  blockedCount: number
  blockedAds: number
  blockedTrackers: number
  blockedScripts: number
  fingerprintProtection: boolean
  httpsEverywhere: boolean
  toggleShield: (enabled: boolean) => Promise<void>
  incrementBlockedCount: () => void
  updateBlockedStats: (category: 'ads' | 'trackers' | 'scripts') => void
  toggleFingerprintProtection: (enabled: boolean) => void
  toggleHttpsEverywhere: (enabled: boolean) => void

  // Downloads

  downloads: any[] // Using any to avoid circular dependency issues for now, or import DownloadItem
  addDownload: (item: any) => void
  updateDownload: (id: string, updates: any) => void

  // Passwords (metadata only — no plaintext; use revealPassword for single-entry decrypt)
  passwords: any[]
  loadPasswords: () => Promise<void>
  addPassword: (entry: any) => Promise<void>
  deletePassword: (id: string) => Promise<void>
  revealPassword: (id: string) => Promise<{ id: string; url: string; username: string; password: string; updatedAt: number } | null>

  // History (IDB-backed)
  history: HistoryItem[]
  historyLoaded: boolean
  loadHistory: () => Promise<void>
  addHistoryItem: (url: string, title: string, favicon?: string) => Promise<void>
  deleteHistoryItem: (id: string) => Promise<void>
  clearHistory: () => Promise<void>

  // Bookmarks (IDB-backed)
  bookmarks: Bookmark[]
  bookmarksLoaded: boolean
  loadBookmarks: () => Promise<void>
  addBookmark: (bookmark: Bookmark) => Promise<void>
  deleteBookmark: (id: string) => Promise<void>
  exportBookmarks: () => Promise<string>
  importBookmarks: (json: string) => Promise<void>

  // Initialization
  hydrateFromIDB: () => Promise<void>
}

export const useBrowserStore = create<BrowserState>()(
  // @ts-ignore
  persist(
    (set, get): BrowserState => ({
      // Initial State
      tabs: [{ id: '1', title: 'New Tab', url: 'pandora://newtab', lastAccessed: Date.now(), spaceId: 'default' }],
      activeTabId: '1',
      sidebarOpen: true,
      sidebarView: 'bookmarks',
      commandPaletteOpen: false,
      copilotOpen: false,
      copilotModel: 'mistral-large-latest',
      mistralApiKey: typeof window !== 'undefined' ? (localStorage.getItem('pandora_mistral_key') || localStorage.getItem('pandora_openai_key')) : null,
      openaiApiKey: typeof window !== 'undefined' ? (localStorage.getItem('pandora_mistral_key') || localStorage.getItem('pandora_openai_key')) : null,
      activeSpace: 'default',
      closedTabs: [],
      wallets: [],
      activeWallet: null,
      walletBalances: {},
      extensions: [],
      shieldEnabled: true,
      blockedCount: 0,
      blockedAds: 0,
      blockedTrackers: 0,
      blockedScripts: 0,
      fingerprintProtection: true,
      httpsEverywhere: true,
      downloads: [],
      passwords: [],
      history: [],
      historyLoaded: false,
      bookmarks: [],
      bookmarksLoaded: false,

      // Actions
      setTabs: (tabs: Tab[]) => set({ tabs }),
      addTab: (tab: Tab) => set((state: BrowserState) => {
        if (state.tabs.length >= config.browser.maxTabs) return state
        const newTab = { ...tab, spaceId: state.activeSpace }
        if (isElectron()) electron.send('tab:create', { id: newTab.id, url: newTab.url })
        return { tabs: [...state.tabs, newTab], activeTabId: newTab.id }
      }),
      closeTab: (id: string) => set((state: BrowserState) => {
        if (isElectron()) electron.send('tab:close', { id })
        const tabToClose = state.tabs.find((t: Tab) => t.id === id)
        const newTabs = state.tabs.filter((t: Tab) => t.id !== id)
        const newClosedTabs = tabToClose ? [tabToClose, ...state.closedTabs].slice(0, 10) : state.closedTabs

        if (newTabs.length === 0) {
          const newTab = { id: Date.now().toString(), title: 'New Tab', url: 'pandora://newtab', lastAccessed: Date.now(), spaceId: state.activeSpace }
          return { tabs: [newTab], activeTabId: newTab.id, closedTabs: newClosedTabs }
        }

        let newActiveId = state.activeTabId
        if (id === state.activeTabId) {
          const sameSpaceTabs = newTabs.filter(t => (t.spaceId || 'default') === state.activeSpace)
          newActiveId = sameSpaceTabs.length > 0 ? sameSpaceTabs[sameSpaceTabs.length - 1].id : newTabs[newTabs.length - 1].id
        }
        return { tabs: newTabs, activeTabId: newActiveId, closedTabs: newClosedTabs }
      }),
      setActiveTab: (id: string) => {
        if (isElectron()) electron.send('tab:switch', { id })
        set({ activeTabId: id })
      },
      updateTab: (id: string, updates: Partial<Tab>, fromIpc = false) => set((state: BrowserState) => {
        if (updates.url && !fromIpc && isElectron()) electron.send('tab:update', { id, url: updates.url })
        return { tabs: state.tabs.map((t: Tab) => t.id === id ? { ...t, ...updates } : t) }
      }),
      toggleSidebar: () => set((state: BrowserState) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarView: (view: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'wallet' | 'shield' | 'passwords') => set({ sidebarView: view }),
      openSidebarPanel: (view: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'wallet' | 'shield' | 'passwords') => set({ sidebarOpen: true, sidebarView: view }),
      toggleCommandPalette: (open?: boolean) => set((state: BrowserState) => ({
        commandPaletteOpen: open !== undefined ? open : !state.commandPaletteOpen
      })),
      clearAllData: async () => {
        if (isElectron()) await electron.invoke('session:clear-data')
        await setHistoryIDB([])
        await setBookmarksIDB([])
        set({ history: [], bookmarks: [], wallets: [], tabs: [{ id: Date.now().toString(), title: 'New Tab', url: 'pandora://newtab', lastAccessed: Date.now(), spaceId: 'default' }], activeTabId: Date.now().toString(), closedTabs: [] })
        window.location.reload()
      },
      setActiveSpace: (space: 'default' | 'work' | 'dev') => set((state: BrowserState) => {
        const spaceTabs = state.tabs.filter(t => (t.spaceId || 'default') === space)
        if (spaceTabs.length > 0) {
          const sorted = [...spaceTabs].sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
          const nextTabId = sorted[0].id
          if (isElectron()) electron.send('tab:switch', { id: nextTabId })
          return { activeSpace: space, activeTabId: nextTabId }
        }
        const newTabId = Date.now().toString()
        const newTab = { id: newTabId, title: 'New Tab', url: 'pandora://newtab', lastAccessed: Date.now(), spaceId: space }
        if (isElectron()) {
          electron.send('tab:create', { id: newTab.id, url: newTab.url })
          electron.send('tab:switch', { id: newTabId })
        }
        return { activeSpace: space, tabs: [...state.tabs, newTab], activeTabId: newTabId }
      }),
      toggleCopilot: () => set((state: BrowserState) => ({ copilotOpen: !state.copilotOpen })),
      setCopilotModel: (model: any) => set({ copilotModel: model }),
      setMistralApiKey: (key: string | null) => {
        if (typeof window !== 'undefined') {
          if (key) {
            localStorage.setItem('pandora_mistral_key', key)
            localStorage.setItem('pandora_openai_key', key)
          } else {
            localStorage.removeItem('pandora_mistral_key')
            localStorage.removeItem('pandora_openai_key')
          }
        }
        set({ mistralApiKey: key, openaiApiKey: key })
      },
      setOpenaiApiKey: (key: string | null) => {
        if (typeof window !== 'undefined') {
          if (key) {
            localStorage.setItem('pandora_mistral_key', key)
            localStorage.setItem('pandora_openai_key', key)
          } else {
            localStorage.removeItem('pandora_mistral_key')
            localStorage.removeItem('pandora_openai_key')
          }
        }
        set({ mistralApiKey: key, openaiApiKey: key })
      },
      duplicateTab: (id: string) => set((state: BrowserState) => {
        const tab = state.tabs.find(t => t.id === id)
        if (!tab) return state
        const newTab = { ...tab, id: Date.now().toString(), active: false }
        const index = state.tabs.findIndex(t => t.id === id)
        const newTabs = [...state.tabs]; newTabs.splice(index + 1, 0, newTab)
        return { tabs: newTabs, activeTabId: newTab.id }
      }),
      togglePinTab: (id: string) => set((state: BrowserState) => ({ tabs: state.tabs.map(t => t.id === id ? { ...t, isPinned: !t.isPinned } : t) })),
      closeOtherTabs: (id: string) => set((state: BrowserState) => ({ tabs: state.tabs.filter(t => t.id === id || t.isPinned), activeTabId: id })),
      reorderTabs: (from: number, to: number) => set((state: BrowserState) => {
        const newTabs = [...state.tabs]; const [moved] = newTabs.splice(from, 1); newTabs.splice(to, 0, moved)
        return { tabs: newTabs }
      }),
      reopenTab: () => set((state: BrowserState) => {
        if (state.closedTabs.length === 0) return state
        const [tab, ...rest] = state.closedTabs
        const newTab = { ...tab, id: Date.now().toString() }
        return { tabs: [...state.tabs, newTab], activeTabId: newTab.id, closedTabs: rest }
      }),
      addWallet: (address: string) => set((state: BrowserState) => ({
        wallets: [...state.wallets, address],
        activeWallet: state.activeWallet || address // Set as active if none
      })),
      removeWallet: (address: string) => set((state: BrowserState) => {
        const newWallets = state.wallets.filter(w => w !== address)
        const newBalances = { ...state.walletBalances }
        delete newBalances[address]
        return {
          wallets: newWallets,
          walletBalances: newBalances,
          activeWallet: state.activeWallet === address ? (newWallets[0] || null) : state.activeWallet
        }
      }),
      setActiveWallet: (address: string | null) => set({ activeWallet: address }),
      updateWalletBalance: (address: string, balance: { eth: string; matic: string; ethUsd: string; maticUsd: string; totalUsd: string; lastUpdated: number }) =>
        set((state: BrowserState) => ({ walletBalances: { ...state.walletBalances, [address]: balance } })),
      loadExtensions: async () => { if (!isElectron()) return; const extensions = await electron.invoke('extension:list'); if (Array.isArray(extensions)) set({ extensions: extensions as BrowserState['extensions'] }) },
      installExtension: async (path: string) => { if (!isElectron()) throw new Error('Extension installation is available only in the desktop application.'); await electron.invoke('extension:load', path); const extensions = await electron.invoke('extension:list'); if (Array.isArray(extensions)) set({ extensions: extensions as BrowserState['extensions'] }) },
      toggleShield: async (enabled: boolean) => { if (isElectron()) await electron.invoke('shield:toggle', enabled); set({ shieldEnabled: enabled }) },
      incrementBlockedCount: () => set((state: BrowserState) => ({ blockedCount: state.blockedCount + 1 })),
      updateBlockedStats: (category: 'ads' | 'trackers' | 'scripts') => set((state: BrowserState) => {
        const updates: Partial<BrowserState> = { blockedCount: state.blockedCount + 1 }
        if (category === 'ads') updates.blockedAds = state.blockedAds + 1
        else if (category === 'trackers') updates.blockedTrackers = state.blockedTrackers + 1
        else if (category === 'scripts') updates.blockedScripts = state.blockedScripts + 1
        return updates
      }),
      toggleFingerprintProtection: (enabled: boolean) => set({ fingerprintProtection: enabled }),
      toggleHttpsEverywhere: (enabled: boolean) => set({ httpsEverywhere: enabled }),
      addDownload: (item: any) => set((state: BrowserState) => ({ downloads: [item, ...state.downloads] })),
      updateDownload: (id: string, updates: any) => set((state: BrowserState) => ({ downloads: state.downloads.map(d => d.id === id ? { ...d, ...updates } : d) })),
      loadPasswords: async () => { if (!isElectron()) return; const passwords = await electron.invoke('password:get'); if (Array.isArray(passwords)) set({ passwords }) },
      addPassword: async (entry: any) => { if (!isElectron()) throw new Error('Password storage is available only in the desktop application.'); await electron.invoke('password:save', entry); const passwords = await electron.invoke('password:get'); if (Array.isArray(passwords)) set({ passwords }) },
      deletePassword: async (id: string) => { if (!isElectron()) throw new Error('Password storage is available only in the desktop application.'); await electron.invoke('password:delete', id); const passwords = await electron.invoke('password:get'); if (Array.isArray(passwords)) set({ passwords }) },
      revealPassword: async (id: string) => { if (!isElectron()) return null; const result = await electron.invoke('password:reveal', id) as any; return (result?.ok && result.entry) ? result.entry : null },
      loadHistory: async () => { if (get().historyLoaded) return; try { const history = await getHistoryIDB(); set({ history, historyLoaded: true }) } catch (e) { console.error(e) } },
      addHistoryItem: async (url: string, title: string, fav?: string) => { await addHistoryItemIDB(url, title, fav); const history = await getHistoryIDB(); set({ history }) },
      deleteHistoryItem: async (id: string) => { await deleteHistoryItemIDB(id); set((state) => ({ history: state.history.filter(h => h.id !== id) })) },
      clearHistory: async () => { await setHistoryIDB([]); set({ history: [] }) },
      loadBookmarks: async () => { if (get().bookmarksLoaded) return; try { const bookmarks = await getBookmarksIDB(); set({ bookmarks, bookmarksLoaded: true }) } catch (e) { console.error(e) } },
      addBookmark: async (b: Bookmark) => { await addBookmarkIDB(b); const bookmarks = await getBookmarksIDB(); set({ bookmarks }) },
      deleteBookmark: async (id: string) => { await deleteBookmarkIDB(id); set((state) => ({ bookmarks: state.bookmarks.filter(b => b.id !== id) })) },
      exportBookmarks: async () => JSON.stringify(get().bookmarks, null, 2),
      importBookmarks: async (json: string) => {
        try {
          const imported = JSON.parse(json) as Bookmark[]
          if (!Array.isArray(imported)) throw new Error('Invalid format')
          // Basic validation and deduplication could happen here
          const current = await getBookmarksIDB()

          for (const b of imported) {
            if (!b.id || !b.url || !b.title) continue
            // Check if already exists by URL
            if (!current.some(c => c.url === b.url)) {
              await addBookmarkIDB(b)
            }
          }
          const bookmarks = await getBookmarksIDB()
          set({ bookmarks })
        } catch (e) {
          console.error('[Store] Import failed:', e)
          throw e
        }
      },
      hydrateFromIDB: async () => { await initializeStorageIDB(); await get().loadHistory(); await get().loadBookmarks(); }
    }),
    {
      name: 'browser-storage',
      partialize: (state: BrowserState) => ({
        tabs: state.tabs,
        sidebarOpen: state.sidebarOpen
      }) as any,
    }
  )
)
