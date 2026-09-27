"use client";


import React from 'react';
import { useEditorStore, SectionBlock, TextElement, ImageElement, ButtonElement, InputElement, BadgeElement } from '../../../lib/store/editor-store';
import { useBrowserStore } from '../../../lib/store/browser-store';
import { Settings2, Type, Move, Palette, Trash2, Layout, Sliders, ChevronDown, Sparkles, Wand2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { useState } from 'react';
import { electron, isElectron } from '@/lib/api';

const InputGroup = ({ label, children, delay = 0 }: { label: string, children?: React.ReactNode, delay?: number }) => (
    <motion.div
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay }}
        className="mb-6"
    >
        <label className="block text-[10px] text-gray-400 mb-2 uppercase font-bold tracking-widest">{label}</label>
        <div className="relative group">
            {children}
        </div>
    </motion.div>
);

export const PropertyPanel = () => {
    const { selectedId, findElement, updateBlock, updateElement, removeBlock } = useEditorStore();
    const { openaiApiKey } = useBrowserStore();
    const selected = selectedId ? findElement(selectedId) : null;

    const [isGenerating, setIsGenerating] = useState(false);
    const [isRewriting, setIsRewriting] = useState(false);


    if (!selected) {
        return (
            <div className="flex flex-col h-full bg-[#0a0a0f]/80 backdrop-blur-xl border-l border-white/5 items-center justify-center text-gray-500 p-8 text-center">
                <div className="relative mb-6">
                    <div className="absolute inset-0 bg-blue-500/20 blur-2xl rounded-full animate-pulse" />
                    <Settings2 size={56} className="relative opacity-30 text-blue-400" />
                </div>
                <h3 className="text-white font-medium mb-2">No Selection</h3>
                <p className="text-xs leading-relaxed max-w-[150px]">Select an element on the canvas to customize its appearance.</p>
            </div>
        );
    }

    const handleChange = (key: string, value: string) => {
        if (selected.type === 'section') {
            updateBlock(selected.id, { [key]: value });
        } else {
            updateElement(selected.id, { [key]: value });
        }
    };

    const handleClassChange = (newClass: string) => {
        handleChange('className', newClass);
    };

    const handleAiImage = async () => {
        if (!selected || selected.type !== 'image' || !openaiApiKey) {
            alert("OpenAI API key required for AI generation. Go to Settings.");
            return;
        }

        const userPrompt = window.prompt("Vložte popis obrázka pre AI:") || "Futuristic abstract digital art placeholder";
        if (!userPrompt) return;

        setIsGenerating(true);
        try {
            if (isElectron()) {
                const url = await electron.invoke('ai:generate-image', { prompt: userPrompt, apiKey: openaiApiKey });
                if (typeof url === "string") {
                    updateElement(selected.id, { src: url });
                }
            }
        } catch (e: any) {
            console.error("AI Image Generation failed", e);
            alert("AI Failed: " + e.message);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleAiRewrite = async () => {
        if (!selected || !openaiApiKey || !('content' in selected)) {
             alert("OpenAI API key required for AI generation. Go to Settings.");
             return;
        }

        setIsRewriting(true);
        try {
            if (isElectron()) {
                // Fixed non-streaming helper for quick UI actions
                const messages = [
                    { role: 'system', content: 'Si profesionálny webový copywriter a marketingový špecialista. Prepíš text tak, aby bol prémiový, pútavý a profesionálny. Odpovedaj IBA upraveným textom bez komentára.' },
                    { role: 'user', content: `Prepíš tento text: "${(selected as any).content}"` }
                ];

                // Since we don't have a direct non-streaming IPC easily, we use a timeout or specialized logic
                // For now, using the streaming mechanism but collecting it
                let text = "";
                const onChunk = (data: unknown) => { text += (data as { chunk?: string }).chunk ?? ""; };

                // Register listeners BEFORE sending
                const completionPromise = new Promise((resolve) => {
                    const onDone = () => {
                        electron.off('ai:chunk', onChunk);
                        electron.off('ai:done', onDone);
                        resolve(text);
                    };
                    electron.on('ai:done', onDone);
                });

                electron.on('ai:chunk', onChunk);

                electron.send('ai:chat', { messages, apiKey: openaiApiKey, model: 'gpt-4o' });
                await completionPromise;

                if (text) {
                    updateElement(selected.id, { content: text.trim() } as any);
                }
            }
        } catch (e: any) {
            console.error("AI Rewrite failed", e);
        } finally {
            setIsRewriting(false);
        }
    };


    return (
        <div className="flex flex-col h-full bg-[#0a0a0f]/95 backdrop-blur-2xl border-l border-white/5 w-80 shadow-2xl relative overflow-hidden">

            {/* Header */}
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-blue-500/10 rounded-lg">
                        <Sliders className="text-blue-400" size={16} />
                    </div>
                    <span className="font-bold tracking-tighter text-white text-sm uppercase">Inspector</span>
                </div>
                <div className="text-[10px] font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded-full border border-blue-400/20">
                    {selected.type.toUpperCase()}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 scrollbar-hide">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={selected.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        {/* Status Info */}
                        <div className="mb-8 p-3 bg-white/5 rounded-xl border border-white/5">
                            <div className="flex items-center gap-2 mb-1">
                                <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                <span className="text-[10px] text-gray-400 font-medium">Element ID: {selected.id}</span>
                            </div>
                        </div>

                        {/* Common Props */}
                        <InputGroup label="Classes" delay={0.1}>
                           <textarea
                                value={selected.className}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleClassChange(e.target.value)}
                                placeholder="Add Tailwind classes..."
                                className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-blue-100 focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 outline-none font-mono h-24 transition-all resize-none shadow-inner"
                            />
                        </InputGroup>

                        {/* Section Name */}
                        {selected.type === 'section' && (
                            <InputGroup label="Section Name" delay={0.15}>
                                <input
                                    type="text"
                                    value={(selected as SectionBlock).name || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('name', e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                                />
                            </InputGroup>
                        )}

                        {/* Text Content / Badge Content */}
                        {(selected.type === 'text' || selected.type === 'button' || selected.type === 'badge') && (
                            <InputGroup label="Display Content" delay={0.2}>
                                <div className="space-y-2">
                                <textarea
                                    value={(selected as any).content}
                                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange('content', e.target.value)}
                                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white focus:border-blue-500/50 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all min-h-[80px] shadow-inner resize-none"
                                />
                                <button
                                    onClick={handleAiRewrite}
                                    disabled={isRewriting}
                                    className="w-full py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                                >
                                    {isRewriting ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                                    {isRewriting ? 'Analyzing...' : 'AI Rewrite Premium'}
                                </button>
                                </div>
                            </InputGroup>
                        )}

                        {/* Badge Variant */}
                        {selected.type === 'badge' && (
                            <InputGroup label="Badge Variant" delay={0.25}>
                                <div className="relative">
                                    <select
                                        value={(selected as BadgeElement).variant}
                                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('variant', e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white appearance-none focus:border-blue-500/50 outline-none transition-all cursor-pointer pr-10"
                                    >
                                        <option value="default">Default</option>
                                        <option value="outline">Outline</option>
                                        <option value="secondary">Secondary</option>
                                        <option value="destructive">Destructive</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                </div>
                            </InputGroup>
                        )}

                        {/* Image Props */}
                        {selected.type === 'image' && (
                            <>
                                <InputGroup label="Image Source (URL)" delay={0.2}>
                                    <div className="space-y-2">
                                        <input
                                            type="text"
                                            value={(selected as any).src}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('src', e.target.value)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-blue-300 focus:border-blue-500/50 outline-none font-mono"
                                        />
                                        <button
                                            onClick={handleAiImage}
                                            disabled={isGenerating}
                                            className="w-full py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/20 rounded-lg text-[9px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-all active:scale-95"
                                        >
                                            {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                            {isGenerating ? 'Generating...' : 'AI Generate Image (DALL-E 3)'}
                                        </button>
                                    </div>
                                </InputGroup>
                                <InputGroup label="Alt Text" delay={0.25}>
                                    <input
                                        type="text"
                                        value={(selected as any).alt}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('alt', e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:border-blue-500/50 outline-none"
                                    />
                                </InputGroup>
                            </>
                        )}

                        {/* Input Props */}
                        {selected.type === 'input' && (
                            <>
                                <InputGroup label="Placeholder" delay={0.2}>
                                    <input
                                        type="text"
                                        value={(selected as any).placeholder}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange('placeholder', e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:border-blue-500/50 outline-none"
                                    />
                                </InputGroup>
                                <InputGroup label="Input Type" delay={0.25}>
                                    <div className="relative">
                                        <select
                                            value={(selected as any).inputType}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('inputType', e.target.value)}
                                            className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white appearance-none focus:border-blue-500/50 outline-none transition-all cursor-pointer pr-10"
                                        >
                                            <option value="text">Text</option>
                                            <option value="email">Email</option>
                                            <option value="password">Password</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                    </div>
                                </InputGroup>
                            </>
                        )}

                         {/* Typography Helper */}
                         {selected.type === 'text' && (
                            <InputGroup label="Tag Type" delay={0.3}>
                                <div className="relative">
                                    <select
                                        value={(selected as any).tag}
                                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleChange('tag', e.target.value)}
                                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white appearance-none focus:border-blue-500/50 outline-none transition-all cursor-pointer pr-10"
                                    >
                                        <option value="h1">Heading 1</option>
                                        <option value="h2">Heading 2</option>
                                        <option value="h3">Heading 3</option>
                                        <option value="p">Body Text (P)</option>
                                        <option value="span">Inline (Span)</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                                </div>
                            </InputGroup>
                        )}

                        {/* Actions */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                            className="mt-12 pt-6 border-t border-white/5"
                        >
                             <button
                                onClick={() => {
                                    if (confirm('Permanently remove this element?')) {
                                        removeBlock(selected.id);
                                    }
                                }}
                                className="w-full flex items-center justify-center gap-2 p-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl transition-all text-xs font-bold uppercase tracking-wider group"
                            >
                                <Trash2 size={14} className="group-hover:scale-110 transition-transform" /> Delete Component
                            </button>
                        </motion.div>
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
};
