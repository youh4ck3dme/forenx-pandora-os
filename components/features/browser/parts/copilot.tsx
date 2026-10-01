import { useState, useRef, useEffect } from 'react'
import { Sparkles, Send, X, Bot, User, Brain, Settings, Key, Eraser, Trash2 } from 'lucide-react'
import { useBrowserStore } from '@/lib/store'
import { useCopilotChat } from '../hooks/use-copilot-chat'
import { cn } from '@/lib/utils'

export function Copilot() {
    const { copilotOpen, toggleCopilot, mistralApiKey, openaiApiKey, setMistralApiKey } = useBrowserStore()
    const { messages, sendMessage, summarizePage, isLoading, clearChat } = useCopilotChat()

    const [input, setInput] = useState('')
    const [showSettings, setShowSettings] = useState(false)
    const [apiKeyInput, setApiKeyInput] = useState(mistralApiKey || openaiApiKey || '')
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
        }
    }, [messages, isLoading])

    if (!copilotOpen) return null

    const handleSend = () => {
        if (!input.trim() || isLoading) return
        sendMessage(input.trim())
        setInput('')
    }

    const saveApiKey = () => {
        setMistralApiKey(apiKeyInput.trim() || null)
        setShowSettings(false)
    }

    return (
        <div className="w-80 bg-black/80 backdrop-blur-2xl border-l border-white/10 flex flex-col h-full shrink-0 shadow-2xl animate-in slide-in-from-right duration-300 z-50">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-linear-to-r from-primary/10 to-blue-500/10">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/20 animate-pulse">
                        <Sparkles className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                        <h3 className="text-xs font-bold text-foreground">PANDORA Copilot pre Forendo</h3>
                        <p className="text-[9px] text-foreground/40 uppercase tracking-widest font-black">Powered by Mistral AI</p>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={summarizePage}
                        disabled={isLoading}
                        className="p-1.5 hover:bg-primary/10 rounded-lg transition-colors text-primary flex items-center gap-1.5 px-2 active:scale-95 disabled:opacity-50"
                        title="Zhrnúť aktuálnu stránku"
                    >
                        <Brain className="w-4 h-4" />
                        <span className="text-[10px] font-bold uppercase tracking-tighter">Scan</span>
                    </button>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={cn("p-1.5 hover:bg-white/5 rounded-lg transition-colors", showSettings && "text-primary bg-primary/10")}
                        title="AI Nastavenia"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                    <button
                        onClick={clearChat}
                        className="p-1.5 hover:bg-white/5 rounded-lg transition-colors text-foreground/40 hover:text-red-400"
                        title="Vymazať pamäť"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                        onClick={toggleCopilot}
                        className="p-1.5 hover:bg-white/5 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4 text-foreground/40" />
                    </button>
                </div>
            </div>

            {/* Settings Overlay */}
            {showSettings && (
                <div className="p-4 bg-zinc-900/90 border-b border-white/10 space-y-3 animate-in fade-in slide-in-from-top-2">
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-foreground/40 uppercase flex items-center gap-1">
                            <Key className="w-3 h-3 text-amber-400" /> Mistral API Key
                        </label>
                        <div className="flex gap-2">
                            <input
                                id="copilot-api-key"
                                name="mistralApiKey"
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                placeholder="Vlož Mistral API kľúč..."
                                className="flex-1 bg-black border border-white/10 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary/50"
                            />
                            <button
                                onClick={saveApiKey}
                                className="px-3 bg-primary text-primary-foreground rounded-lg text-xs font-bold hover:opacity-90"
                            >
                                Uložiť
                            </button>
                        </div>
                    </div>
                    <p className="text-[10px] text-foreground/30 italic">Kľúč je uložený iba lokálne v tvojom prehliadači.</p>
                </div>
            )}

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4 no-scrollbar">
                {messages.map((msg, i) => (
                    <div key={i} className={cn(
                        "flex gap-3",
                        msg.role === 'user' ? "flex-row-reverse" : ""
                    )}>
                        <div className={cn(
                            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/5",
                            msg.role === 'assistant' ? "bg-primary/20 shadow-[0_0_15px_rgba(var(--primary-rgb),0.2)]" : "bg-white/10"
                        )}>
                            {msg.role === 'assistant' ? <Brain className="w-4 h-4 text-primary" /> : <User className="w-4 h-4 text-foreground/60" />}
                        </div>
                        <div className={cn(
                            "p-3 rounded-2xl text-sm leading-relaxed max-w-[85%]",
                            msg.role === 'assistant'
                                ? "bg-white/5 border border-white/5 text-foreground/90 rounded-tl-none prose prose-invert prose-sm"
                                : "bg-primary/80 text-primary-foreground rounded-tr-none shadow-lg"
                        )}>
                            <div className="whitespace-pre-wrap wrap-break-word">
                                {msg.content}
                            </div>

                            {msg.imageUrl && (
                                <div className="mt-3 rounded-lg overflow-hidden border border-white/10 shadow-xl group cursor-pointer relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={msg.imageUrl} alt="AI Generated" width={512} height={512} className="w-full aspect-square object-cover" />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/60 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <p className="text-[10px] text-white truncate px-1">AI Generated Image</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Brain className="w-4 h-4 text-primary opacity-50" />
                        </div>
                        <div className="p-3 bg-white/5 border border-white/5 rounded-2xl rounded-tl-none flex gap-1 items-center">
                            <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" />
                            <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                            <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce [animation-delay:0.4s]" />
                        </div>
                    </div>
                )}
            </div>

            {/* Suggested Actions for Forendo */}
            <div className="px-4 py-2 border-t border-white/5 bg-black/20 flex flex-wrap gap-1.5 shrink-0">
                {[
                    { label: '📁 Nahrať spisy', url: '/forza/sandbox?upload=1' },
                    { label: '⚡ Spustiť Autopilot', url: '/forza/asistent' },
                    { label: '🔍 Zobraziť zistenia', url: '/forza/vztahy' },
                    { label: '🧪 Otvoriť Sandbox', url: '/forza/sandbox' },
                ].map((action) => (
                    <button
                        key={action.label}
                        onClick={() => {
                            const { activeTabId, updateTab, addTab } = useBrowserStore.getState();
                            const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}${action.url}` : action.url;
                            const title = action.label.slice(2).trim();
                            if (activeTabId) {
                                updateTab(activeTabId, { url: fullUrl, title, isLoading: true });
                            } else {
                                addTab({ id: Date.now().toString(), title, url: fullUrl, lastAccessed: Date.now(), spaceId: 'default' });
                            }
                            sendMessage(`Otvoril som ${title}. Ako môžem s týmto prípadom pomôcť?`);
                        }}
                        className="px-2 py-1 rounded-md bg-white/5 hover:bg-amber-500/20 border border-white/10 hover:border-amber-500/30 text-[10px] font-medium text-gray-300 hover:text-amber-300 transition-all text-left"
                    >
                        {action.label}
                    </button>
                ))}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-white/10 bg-black/40">
                <div className="relative group">
                    <div className="absolute -inset-0.5 bg-linear-to-r from-primary/50 to-blue-500/50 rounded-xl opacity-0 group-focus-within:opacity-100 transition duration-500 blur-sm whitespace-pre-wrap" />
                    <div className="relative flex items-center bg-zinc-900 border border-white/10 rounded-xl overflow-hidden px-3">
                        <input
                            id="copilot-chat-input"
                            name="copilotPrompt"
                            type="text"
                            placeholder={(mistralApiKey || openaiApiKey) ? "Spýtaj sa Copilota na čokoľvek v spise..." : "Zadaj Mistral API kľúč pre aktiváciu AI..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            className="bg-transparent border-none text-xs text-foreground placeholder:text-foreground/30 w-full py-4 focus:outline-none"
                        />
                        <button
                            onClick={handleSend}
                            disabled={!input.trim() || isLoading}
                            className="p-1.5 hover:bg-primary/20 rounded-lg transition-colors text-primary disabled:opacity-20 cursor-pointer"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                <div className="mt-2 text-center">
                    <p className="text-[9px] text-foreground/30 uppercase tracking-wider font-semibold">Mistral AI Copilot · Forenzná inteligencia</p>
                </div>
            </div>
        </div>
    )
}
