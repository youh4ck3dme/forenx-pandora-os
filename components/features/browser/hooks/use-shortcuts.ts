import { useEffect } from 'react'
import { useBrowserActions } from '@/lib/hooks'

export function useShortcuts() {
    const {
        addTab,
        closeCurrentTab,
        switchToNextTab,
        switchToPrevTab,
        reopenClosedTab,
        toggleSidebar,
        openSidebarPanel,
        reload,
    } = useBrowserActions()

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const isControl = e.metaKey || e.ctrlKey

            // Cmd+T: New Tab
            if (isControl && e.key === 't') {
                e.preventDefault()
                addTab()
            }

            // Cmd+W: Close Tab
            if (isControl && e.key === 'w') {
                e.preventDefault()
                closeCurrentTab()
            }

            // Cmd+Shift+T: Reopen Closed Tab
            if (isControl && e.shiftKey && e.key === 'T') {
                e.preventDefault()
                reopenClosedTab()
            }

            // Cmd+B: Toggle Sidebar
            if (isControl && e.key === 'b') {
                e.preventDefault()
                toggleSidebar()
            }

            // Cmd+L: Focus Omnibox
            if (isControl && e.key === 'l') {
                e.preventDefault()
                const omnibox = document.querySelector('input[type="text"]') as HTMLInputElement
                if (omnibox) {
                    omnibox.focus()
                    omnibox.select()
                }
            }

            // Cmd+R / F5: Reload
            if ((isControl && e.key === 'r') || e.key === 'F5') {
                e.preventDefault()
                reload(e.shiftKey)
            }

            // Ctrl+Tab: Next Tab / Ctrl+Shift+Tab: Prev Tab
            if (isControl && e.key === 'Tab') {
                e.preventDefault()
                if (e.shiftKey) {
                    switchToPrevTab()
                } else {
                    switchToNextTab()
                }
            }

            // Cmd+1-4: Sidebar Panels
            if (isControl && ['1', '2', '3', '4'].includes(e.key)) {
                e.preventDefault()
                const panels: Record<string, 'bookmarks' | 'history' | 'downloads' | 'settings'> = {
                    '1': 'bookmarks',
                    '2': 'history',
                    '3': 'downloads',
                    '4': 'settings'
                }
                openSidebarPanel(panels[e.key])
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [addTab, closeCurrentTab, switchToNextTab, switchToPrevTab, reopenClosedTab, toggleSidebar, openSidebarPanel, reload])
}
