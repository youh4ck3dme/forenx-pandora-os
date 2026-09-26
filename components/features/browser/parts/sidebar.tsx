'use client'

import { Bookmark, Clock, Download, Globe, Trash2, Settings, Moon, Sun, Search, Monitor, Key, ShieldCheck, Plus, Eye, EyeOff, LayoutTemplate, SidebarOpen, PanelRightClose, Square, Wallet, Scale, ArrowUpRight } from 'lucide-react'
import { useBrowserStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Panels
import { BookmarksPanel } from './panels/bookmarks-panel'
import { HistoryPanel } from './panels/history-panel'
import { DownloadsPanel } from './panels/downloads-panel'
import { SettingsPanel } from './panels/settings-panel'
import { WalletPanel } from './panels/wallet-panel'

import { ShieldPanel } from './panels/shield-panel'

export function Sidebar() {
    const { sidebarOpen, sidebarView, setSidebarView, toggleSidebar, activeSpace, setActiveSpace } = useBrowserStore()
    // const [activeSpace, setActiveSpace] = useState<'default' | 'work' | 'dev'>('default') // Removed local state

    if (!sidebarOpen) return null

    return (
        <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="bg-black/80 backdrop-blur-xl border-r border-white/5 flex flex-col h-full shrink-0 z-40 relative group"
        >
            {/* Header / Tabs */}
            <div className="flex items-center px-2 pt-2 pb-0">
                <div className="flex-1 flex bg-white/5 rounded-lg p-0.5 border border-white/5 overflow-x-auto no-scrollbar">
                    {[
                        { id: 'bookmarks', icon: Scale, label: 'Forendo' },
                        { id: 'history', icon: Clock, label: 'History' },
                        { id: 'downloads', icon: Download, label: 'Downloads' },
                        { id: 'shield', icon: ShieldCheck, label: 'Shield' },
                        { id: 'wallet', icon: Wallet, label: 'Wallet' },
                        { id: 'settings', icon: Settings, label: 'Settings' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setSidebarView(tab.id as any)}
                            className={cn(
                                "flex-1 py-1 px-1 min-w-8 flex items-center justify-center rounded-md transition-all text-[9px] font-bold uppercase tracking-tight relative",
                                sidebarView === tab.id
                                    ? "bg-white/10 text-white shadow-sm"
                                    : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                            )}
                            title={tab.label}
                        >
                            <tab.icon size={12} />
                            {sidebarView === tab.id && (
                                <motion.div
                                    layoutId="activeTab"
                                    className="absolute inset-0 border border-white/10 rounded-md pointer-events-none"
                                />
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative mt-2">
                <AnimatePresence mode="wait">
                    {sidebarView === 'bookmarks' && <BookmarksPanel key="bookmarks" />}
                    {sidebarView === 'history' && <HistoryPanel key="history" />}
                    {sidebarView === 'downloads' && <DownloadsPanel key="downloads" />}
                    {sidebarView === 'shield' && <ShieldPanel key="shield" />}
                    {sidebarView === 'settings' && <SettingsPanel key="settings" />}
                    {sidebarView === 'wallet' && <WalletPanel key="wallet" />}
                </AnimatePresence>
            </div>

            {/* Space Switcher (Footer) */}
            <div className="p-3 border-t border-white/5 bg-black/40">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest pl-1">Spaces</span>
                    <button
                        onClick={toggleSidebar}
                        className="text-gray-600 hover:text-white transition-colors"
                        title="Zavrieť panel"
                    >
                        <PanelRightClose size={14} />
                    </button>
                </div>
                <div className="flex gap-2">
                    {[
                        { id: 'pripady', label: 'Prípady', color: 'bg-blue-500', url: '/forza/pripady' },
                        { id: 'sandbox', label: 'Sandbox', color: 'bg-emerald-500', url: '/forza/sandbox' },
                        { id: 'autopilot', label: 'Autopilot', color: 'bg-purple-500', url: '/forza/asistent' },
                        { id: 'zistenia', label: 'Zistenia', color: 'bg-amber-500', url: '/forza/vztahy' },
                    ].map((space) => (
                        <button
                            key={space.id}
                            onClick={() => {
                                const { activeTabId, updateTab, addTab } = useBrowserStore.getState();
                                const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${space.url}` : space.url;
                                if (activeTabId) {
                                    updateTab(activeTabId, { url: fullUrl, title: space.label, isLoading: true });
                                } else {
                                    addTab({ id: Date.now().toString(), title: space.label, url: fullUrl, lastAccessed: Date.now(), spaceId: 'default' });
                                }
                            }}
                            className={cn(
                                "h-8 flex-1 rounded-lg border flex items-center justify-center transition-all relative overflow-hidden group",
                                "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                            )}
                            title={space.label}
                        >
                            <div className={cn("w-2 h-2 rounded-full group-hover:scale-125 transition-transform", space.color)} />
                        </button>
                    ))}

                    {/* Panic Button */}
                    <button
                        onClick={() => {
                            if (confirm("[CAUTION] This will WIPE all local data including history and active sessions. Proceed?")) {
                                useBrowserStore.getState().clearAllData();
                            }
                        }}
                        className="h-8 w-8 rounded-lg border border-red-500/20 bg-red-500/5 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm hover:shadow-[0_0_10px_rgba(239,68,68,0.3)]"
                        title="PANIC: Secure Wipe"
                    >
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            {/* Visual Resize Handle */}
            <div className="absolute right-0 top-0 bottom-0 w-px hover:w-1 bg-white/5 hover:bg-blue-500/50 cursor-col-resize transition-all z-50" />
        </motion.div>
    )
}
