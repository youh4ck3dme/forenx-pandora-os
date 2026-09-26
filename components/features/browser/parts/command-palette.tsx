'use client'

import React, { useEffect } from 'react'
import { Command } from 'cmdk'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Search,
    Globe,
    Clock,
    Bookmark,
    Download,
    Wallet,
    Shield,
    Settings,
    Layout,
    Scale,
    Command as CommandIcon
} from 'lucide-react'
import { useBrowserStore } from '@/lib/store'
import { cn } from '@/lib/utils'

export function CommandPalette() {
    const {
        commandPaletteOpen,
        toggleCommandPalette,
        tabs,
        setActiveTab,
        activeSpace,
        setActiveSpace,
        openSidebarPanel
    } = useBrowserStore()

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                toggleCommandPalette()
            }
        }

        document.addEventListener('keydown', down)
        return () => document.removeEventListener('keydown', down)
    }, [toggleCommandPalette])

    if (!commandPaletteOpen) return null

    return (
        <AnimatePresence>
            {commandPaletteOpen && (
                <div className="fixed inset-0 z-100 flex items-start justify-center pt-[20vh] px-4 bg-black/40 backdrop-blur-sm">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        className="w-full max-w-160 bg-[#0f0f16]/90 border border-white/10 rounded-2xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] overflow-hidden backdrop-blur-2xl"
                    >
                        <Command
                            className="relative flex flex-col h-full"
                            onKeyDown={(e) => {
                                if (e.key === 'Escape') toggleCommandPalette(false)
                            }}
                        >
                            <div className="flex items-center border-b border-white/5 px-4 h-14">
                                <Search className="mr-3 h-5 w-5 text-gray-500" />
                                <Command.Input
                                    autoFocus
                                    placeholder="Ask anything or type a command..."
                                    className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-gray-600 text-base"
                                />
                                <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 border border-white/5 text-[10px] text-gray-500 font-bold">
                                    <span className="text-[12px]">⌘</span> K
                                </div>
                            </div>

                            <Command.List className="max-h-100 overflow-y-auto p-2 no-scrollbar">
                                <Command.Empty className="py-12 text-center text-sm text-gray-500">
                                    No results found for your search.
                                </Command.Empty>

                                {/* TABS GROUP */}
                                {tabs.length > 0 && (
                                    <Command.Group heading={<span className="px-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Active Tabs</span>}>
                                        {tabs.map((tab) => (
                                            <CommandItem
                                                key={tab.id}
                                                onSelect={() => {
                                                    setActiveTab(tab.id)
                                                    toggleCommandPalette(false)
                                                }}
                                            >
                                                <Globe className="mr-3 h-4 w-4 text-blue-500" />
                                                <span className="flex-1 truncate">{tab.title}</span>
                                                <span className="text-[10px] text-gray-600 truncate max-w-37.5">{tab.url}</span>
                                            </CommandItem>
                                        ))}
                                    </Command.Group>
                                )}

                                {/* SPACES GROUP */}
                                <Command.Group heading={<span className="px-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-4">Switch Space</span>}>
                                    {[
                                        { id: 'default', label: 'Personal Space', color: 'text-blue-500' },
                                        { id: 'work', label: 'Work Space', color: 'text-orange-500' },
                                        { id: 'dev', label: 'Developer Space', color: 'text-purple-500' },
                                    ].map((space) => (
                                        <CommandItem
                                            key={space.id}
                                            onSelect={() => {
                                                setActiveSpace(space.id as any)
                                                toggleCommandPalette(false)
                                            }}
                                        >
                                            <Layout className={cn("mr-3 h-4 w-4", space.color)} />
                                            <span>{space.label}</span>
                                            {activeSpace === space.id && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />}
                                        </CommandItem>
                                    ))}
                                </Command.Group>

                                {/* TOOLS GROUP */}
                                <Command.Group heading={<span className="px-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-4">Tools & Views</span>}>
                                    {[
                                        { id: 'forza', label: 'Forenzný mód (Forza Spisy & Autopilot)', icon: Scale, color: 'text-amber-400', href: '/forza/prehlad' },
                                        { id: 'shield', label: 'Privacy Shield', icon: Shield, color: 'text-green-500' },
                                        { id: 'wallet', label: 'Crypto Wallet', icon: Wallet, color: 'text-yellow-500' },
                                        { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark, color: 'text-pink-500' },
                                        { id: 'history', label: 'History', icon: Clock, color: 'text-blue-400' },
                                        { id: 'downloads', label: 'Downloads', icon: Download, color: 'text-purple-400' },
                                        { id: 'settings', label: 'Settings', icon: Settings, color: 'text-gray-400' },
                                    ].map((tool) => (
                                        <CommandItem
                                            key={tool.id}
                                            onSelect={() => {
                                                if ('href' in tool && tool.href) {
                                                    window.location.href = tool.href;
                                                } else {
                                                    openSidebarPanel(tool.id as any)
                                                }
                                                toggleCommandPalette(false)
                                            }}
                                        >
                                            <tool.icon className={cn("mr-3 h-4 w-4", tool.color)} />
                                            <span>{tool.label}</span>
                                        </CommandItem>
                                    ))}
                                </Command.Group>

                                <div className="h-2" />
                            </Command.List>

                            <div className="flex items-center gap-4 px-4 h-10 border-t border-white/5 bg-black/20 text-[10px] text-gray-500">
                                <div className="flex items-center gap-1.5">
                                    <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-sans">↑↓</kbd>
                                    <span>Navigate</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-sans">Enter</kbd>
                                    <span>Select</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-sans">Esc</kbd>
                                    <span>Close</span>
                                </div>
                            </div>
                        </Command>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    )
}

function CommandItem({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) {
    return (
        <Command.Item
            onSelect={onSelect}
            className="flex items-center px-3 py-2.5 rounded-xl cursor-default text-sm text-gray-300 aria-selected:bg-blue-500/10 aria-selected:text-blue-400 aria-selected:shadow-inner transition-all group"
        >
            {children}
        </Command.Item>
    )
}
