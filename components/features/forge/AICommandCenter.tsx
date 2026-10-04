"use client";

import React, { useState } from 'react';
import { Sparkles, MessageSquare, Loader2, Wand2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../../lib/store/editor-store';
import { cn } from '../../../lib/utils';

export function AICommandCenter({ onLog }: { onLog: (msg: string) => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const { setBlocks } = useEditorStore();

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        setIsGenerating(true);
        onLog(`> 🪄 AI: Initiating layout generation for: "${prompt.slice(0, 30)}..."`);

        try {
            const response = await fetch('/api/forge/ai-generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            const data = await response.json();

            if (data.success && data.blocks) {
                setBlocks(data.blocks);
                onLog(`> ✅ AI: Success! New layout generated.`);
                setIsOpen(false);
                setPrompt('');
            } else {
                onLog(`> ❌ AI Error: ${data.message || 'Generation failed'}`);
            }
        } catch (error) {
            onLog(`> ❌ AI Network Error: Could not reach Gemini.`);
            console.error(error);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div className={cn(
            "fixed z-50 flex flex-col items-end gap-4 transition-all duration-300 pointer-events-none",
            "bottom-6 right-6 lg:bottom-8 lg:right-8" // Positioning
        )}>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className={cn(
                            "bg-black/80 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden pointer-events-auto",
                            // Mobile Styles
                            "fixed inset-x-0 bottom-0 w-full rounded-t-3xl p-6 border-b-0",
                            // Desktop Styles
                            "lg:static lg:w-96 lg:rounded-2xl lg:border"
                        )}
                    >
                        {/* Shimmer Effect */}
                        <div className="absolute inset-0 bg-linear-to-tr from-blue-500/10 via-transparent to-purple-500/10 pointer-events-none" />

                        <div className="flex justify-between items-center mb-4 relative z-10">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-blue-400 animate-pulse" />
                                <h3 className="text-white font-bold tracking-tight">AI Command Center</h3>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                className="text-white/40 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="relative z-10">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="E.g., Create a modern SaaS hero section with a pricing table and high-tech aesthetics..."
                                className="w-full h-32 bg-white/5 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:outline-hidden focus:ring-1 focus:ring-blue-500/50 transition-all resize-none"
                            />

                            <button
                                onClick={handleGenerate}
                                disabled={isGenerating || !prompt.trim()}
                                className={cn(
                                    "w-full mt-4 py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition-all",
                                    isGenerating
                                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                                        : "bg-linear-to-r from-blue-600 to-indigo-600 text-white hover:shadow-lg hover:shadow-blue-500/20 active:scale-95"
                                )}
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                        Generating Magic...
                                    </>
                                ) : (
                                    <>
                                        <Wand2 className="w-5 h-5" />
                                        Cast Spell (Generate)
                                    </>
                                )}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-blue-500/20 transition-all relative overflow-hidden pointer-events-auto",
                    isOpen ? "bg-white text-black" : "bg-linear-to-tr from-blue-600 via-indigo-600 to-purple-600 text-white"
                )}
            >
                {isOpen ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}

                {!isOpen && (
                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                )}
            </motion.button>
        </div>
    );
}
