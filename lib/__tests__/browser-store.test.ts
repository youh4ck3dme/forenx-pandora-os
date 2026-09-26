import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { act } from 'react'

// Mock dependencies
vi.mock('@/lib/api', () => ({
  electron: {
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn()
  },
  isElectron: () => true
}))

vi.mock('@/lib/storage', () => ({
  initializeStorageIDB: vi.fn(),
  getHistoryIDB: vi.fn().mockResolvedValue([]),
  getBookmarksIDB: vi.fn().mockResolvedValue([]),
  setHistoryIDB: vi.fn(),
  setBookmarksIDB: vi.fn(),
  addHistoryItemIDB: vi.fn(),
  addBookmarkIDB: vi.fn(),
  deleteHistoryItemIDB: vi.fn(),
  deleteBookmarkIDB: vi.fn(),
  saveTabs: vi.fn(),
  getTabs: vi.fn().mockReturnValue([]),
  clearTabs: vi.fn(),
  saveClosedTab: vi.fn(),
  getClosedTabs: vi.fn().mockReturnValue([]),
  popClosedTab: vi.fn().mockReturnValue(null)
}))

vi.mock('@/lib/config', () => ({
  config: {
    browser: {
      maxTabs: 10,
      defaultSearchEngine: 'google'
    }
  }
}))

// Mock LocalStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()
vi.stubGlobal('localStorage', localStorageMock)

describe('BrowserStore', () => {
  let useBrowserStore: any
  let electron: any
  let initialStoreState: any

  beforeAll(async () => {
    // Dynamic import to ensure mocks are applied first
    const electronModule = await import('@/lib/api')
    electron = electronModule.electron

    // Import store dynamically
    const storeModule = await import('@/lib/store')
    useBrowserStore = storeModule.useBrowserStore

    // Capture the initial state INCLUDING actions
    initialStoreState = useBrowserStore.getState()
  })

  beforeEach(() => {
    // Restore the full initial state
    useBrowserStore.setState(initialStoreState, true)

    // Clear mocks
    vi.clearAllMocks()
    localStorageMock.clear()
  })

  it('should initialize with one new tab', () => {
    const { tabs, activeTabId } = useBrowserStore.getState()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].url).toBe('pandora://newtab')
    expect(activeTabId).toBe(tabs[0].id)
  })

  it('should add a new tab', () => {
    const { addTab } = useBrowserStore.getState()

    act(() => {
      addTab({ id: '2', title: 'Google', url: 'https://google.com', lastAccessed: Date.now() })
    })

    const { tabs, activeTabId } = useBrowserStore.getState()
    expect(tabs).toHaveLength(2)
    expect(activeTabId).toBe('2')
    expect(electron.send).toHaveBeenCalledWith('tab:create', expect.objectContaining({ url: 'https://google.com' }))
  })

  it('should close a tab', () => {
    const { addTab, closeTab } = useBrowserStore.getState()

    act(() => {
      addTab({ id: '2', title: 'Google', url: 'https://google.com', lastAccessed: Date.now() })
      closeTab('2')
    })

    const { tabs, activeTabId } = useBrowserStore.getState()
    expect(tabs).toHaveLength(1)
    expect(electron.send).toHaveBeenCalledWith('tab:close', { id: '2' })
  })

  it('should update tab details', () => {
    const { updateTab, tabs } = useBrowserStore.getState()
    const initialId = tabs[0].id

    act(() => {
      updateTab(initialId, { title: 'Updated Title' })
    })

    expect(useBrowserStore.getState().tabs[0].title).toBe('Updated Title')
  })
})
