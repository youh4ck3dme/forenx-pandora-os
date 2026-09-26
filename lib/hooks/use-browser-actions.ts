/**
 * use-browser-actions.ts - Centralized Browser Actions Hook
 * Single source of truth for all browser operations
 * Handles: Tab management, Navigation, History recording, Electron IPC
 */

'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useBrowserStore } from '@/lib/store'
import { addHistoryItemIDB, initializeStorageIDB } from '@/lib/storage'
import { electron, isElectron } from '@/lib/api'
import { config } from '@/lib/config'

// Generate unique tab IDs
const generateTabId = () => `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

export function useBrowserActions() {
    const store = useBrowserStore()
    const initRef = useRef(false)

    // Initialize storage on first mount
    useEffect(() => {
        if (initRef.current) return
        initRef.current = true
        initializeStorageIDB()
    }, [])

    // =========================================================================
    // TAB ACTIONS
    // =========================================================================

    const addTab = useCallback((url?: string, title?: string) => {
        const newTab = {
            id: generateTabId(),
            title: title || 'New Tab',
            url: url || 'pandora://newtab',
            lastAccessed: Date.now(),
            isLoading: !!url && url !== 'pandora://newtab',
        }
        store.addTab(newTab)
        return newTab.id
    }, [store])

    const closeTab = useCallback((id: string) => {
        store.closeTab(id)
    }, [store])

    const closeCurrentTab = useCallback(() => {
        store.closeTab(store.activeTabId)
    }, [store])

    const closeOtherTabs = useCallback((keepId?: string) => {
        const id = keepId || store.activeTabId
        store.closeOtherTabs(id)
    }, [store])

    const closeAllTabs = useCallback(() => {
        // Close all but create a new tab
        store.tabs.forEach(tab => {
            if (tab.id !== store.activeTabId) {
                store.closeTab(tab.id)
            }
        })
        store.closeTab(store.activeTabId)
    }, [store])

    const switchTab = useCallback((id: string) => {
        store.setActiveTab(id)
    }, [store])

    const switchToNextTab = useCallback(() => {
        const currentIndex = store.tabs.findIndex(t => t.id === store.activeTabId)
        const nextIndex = (currentIndex + 1) % store.tabs.length
        store.setActiveTab(store.tabs[nextIndex].id)
    }, [store])

    const switchToPrevTab = useCallback(() => {
        const currentIndex = store.tabs.findIndex(t => t.id === store.activeTabId)
        const prevIndex = currentIndex === 0 ? store.tabs.length - 1 : currentIndex - 1
        store.setActiveTab(store.tabs[prevIndex].id)
    }, [store])

    const duplicateTab = useCallback((id?: string) => {
        store.duplicateTab(id || store.activeTabId)
    }, [store])

    const pinTab = useCallback((id?: string) => {
        store.togglePinTab(id || store.activeTabId)
    }, [store])

    const reopenClosedTab = useCallback(() => {
        store.reopenTab()
    }, [store])

    const moveTab = useCallback((fromIndex: number, toIndex: number) => {
        store.reorderTabs(fromIndex, toIndex)
    }, [store])

    // =========================================================================
    // NAVIGATION ACTIONS
    // =========================================================================

    const navigateTo = useCallback(async (input: string) => {
        const activeTab = store.tabs.find(t => t.id === store.activeTabId)
        if (!activeTab) return

        // Determine if input is URL or search query
        let url: string
        const isUrl = input.includes('.') || input.startsWith('http') || input.startsWith('pandora://')

        if (isUrl) {
            url = input.startsWith('http') || input.startsWith('pandora://')
                ? input
                : `https://${input}`
        } else {
            url = `${config.browser.defaultSearchEngine}${encodeURIComponent(input)}`
        }

        // Update tab
        store.updateTab(store.activeTabId, {
            url,
            isLoading: true,
            title: 'Loading...',
        })

        // Record to history (async, non-blocking)
        if (!url.startsWith('pandora://')) {
            addHistoryItemIDB(url, activeTab.title || url).catch(console.error)
        }
    }, [store])

    const goBack = useCallback(() => {
        if (isElectron()) {
            electron.send('nav:back', { id: store.activeTabId })
        } else {
            // Web fallback - limited functionality
            window.history.back()
        }
    }, [store.activeTabId])

    const goForward = useCallback(() => {
        if (isElectron()) {
            electron.send('nav:forward', { id: store.activeTabId })
        } else {
            window.history.forward()
        }
    }, [store.activeTabId])

    const reload = useCallback((hard = false) => {
        const activeTab = store.tabs.find(t => t.id === store.activeTabId)
        if (!activeTab) return

        store.updateTab(store.activeTabId, { isLoading: true })

        if (isElectron()) {
            electron.send('nav:reload', { id: store.activeTabId, hard })
        } else {
            // Web fallback - just trigger re-render
            store.updateTab(store.activeTabId, {
                url: activeTab.url,
                isLoading: true
            })
        }
    }, [store])

    const goHome = useCallback(() => {
        navigateTo(config.browser.defaultHomePage)
    }, [navigateTo])

    const stop = useCallback(() => {
        store.updateTab(store.activeTabId, { isLoading: false })
        if (isElectron()) {
            electron.send('nav:stop', { id: store.activeTabId })
        }
    }, [store])

    // =========================================================================
    // UI ACTIONS
    // =========================================================================

    const toggleSidebar = useCallback(() => {
        store.toggleSidebar()
    }, [store])

    const openSidebarPanel = useCallback((panel: 'bookmarks' | 'history' | 'downloads' | 'settings' | 'passwords') => {
        store.setSidebarView(panel)
        if (!store.sidebarOpen) {
            store.toggleSidebar()
        }
    }, [store])

    const toggleCopilot = useCallback(() => {
        store.toggleCopilot()
    }, [store])

    // =========================================================================
    // GETTERS
    // =========================================================================

    const getCurrentTab = useCallback(() => {
        return store.tabs.find(t => t.id === store.activeTabId) || null
    }, [store.tabs, store.activeTabId])

    const getTabById = useCallback((id: string) => {
        return store.tabs.find(t => t.id === id) || null
    }, [store.tabs])

    return {
        // Tab Actions
        addTab,
        closeTab,
        closeCurrentTab,
        closeOtherTabs,
        closeAllTabs,
        switchTab,
        switchToNextTab,
        switchToPrevTab,
        duplicateTab,
        pinTab,
        reopenClosedTab,
        moveTab,

        // Navigation Actions
        navigateTo,
        goBack,
        goForward,
        reload,
        goHome,
        stop,

        // UI Actions
        toggleSidebar,
        openSidebarPanel,
        toggleCopilot,

        // Getters
        getCurrentTab,
        getTabById,

        // Direct store access for advanced use cases
        tabs: store.tabs,
        activeTabId: store.activeTabId,
        sidebarOpen: store.sidebarOpen,
        copilotOpen: store.copilotOpen,
    }
}
