"use client";

import React, { useState } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useSensor, useSensors, MouseSensor, TouchSensor } from '@dnd-kit/core';
import { ElementsSidebar } from './ElementsSidebar';
import { VisualCanvas } from './VisualCanvas';
import { PropertyPanel } from './PropertyPanel';
import { useEditorStore } from '../../../lib/store/editor-store';
import { generateReactCode } from '../../../lib/forge';
import { Editor } from '@monaco-editor/react';
import { Eye, Code, Smartphone, Monitor, ExternalLink, Tablet, Loader2, Zap, Copy, Check, Trash2, Plus, Move, ChevronRight, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../../lib/utils';
import { ExportBuildButton } from './ExportBuildButton';
import { AICommandCenter } from './AICommandCenter';
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { PlusSquare, Settings2 } from 'lucide-react';
import { FORGE_COMPONENTS } from '../../../lib/forge';

const regenerateIds = (element: any): any => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newEl = { ...element, id: newId };
    if (newEl.children) {
        newEl.children = newEl.children.map((child: any) => regenerateIds(child));
    }
    return newEl;
};

export default function ForgeStudio() {
    const { viewMode, setViewMode, blocks, addBlock } = useEditorStore();
    const [showCode, setShowCode] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [lastPublishedUrl, setLastPublishedUrl] = useState<string | null>(null);
    const [activeDragType, setActiveDragType] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [mounted, setMounted] = useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    const addLog = (msg: string) => setLogs((prev: string[]) => [...prev.slice(-9), msg]);

    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
        useSensor(TouchSensor)
    );

    if (!mounted) return <div className="h-screen w-full bg-[#050508]" />;


    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragType(event.active.data.current?.type);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        setActiveDragType(null);
        const { over, active } = event;

        if (over && over.id === 'canvas-drop-zone') {
            const type = active.data.current?.type;

            if (type === 'section') {
                addBlock({
                    type: 'section',
                    name: 'New Section',
                    className: 'w-full py-20 px-8 bg-gray-50 flex flex-col items-center',
                    children: [
                         { id: Math.random().toString(36), type: 'text', tag: 'h2', content: 'New Section', className: 'text-3xl font-bold mb-4' }
                    ]
                });
            } else if (FORGE_COMPONENTS[type]) {
                const template = FORGE_COMPONENTS[type];
                if (template.type === 'section') {
                    // Deep clone and regenerate IDs
                    const newBlock = regenerateIds(template);
                    addBlock({
                        type: 'section',
                        name: newBlock.name,
                        className: newBlock.className,
                        children: newBlock.children
                    });
                }
            } else if (type === 'input') {
                const activeSection = blocks[0];
                if (activeSection) {
                    addBlock({
                        type: 'section',
                        name: 'Form Section',
                        className: 'w-full py-10 px-6 flex justify-center',
                        children: [{ id: Math.random().toString(36), type: 'input', placeholder: 'Enter text...', inputType: 'text', className: 'w-full max-w-sm px-4 py-2 rounded border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-hidden' }]
                    });
                }
            }
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        addLog('> Initiating Publish sequence...');
        try {
            const response = await fetch('/api/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug: 'home', blocks })
            });
            const data = await response.json();
            if (data.success) {
                setLastPublishedUrl(data.url);
                addLog(`> ✅ SUCCESS: Published to ${data.url}`);
            } else {
                addLog(`> ❌ ERROR: ${data.message || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('[Forge] Publish failed:', error);
            addLog('> ❌ NETWORK ERROR: Could not reach server.');
        } finally {
            setIsPublishing(false);
        }
    };

    const generatedCode = showCode ? generateReactCode(blocks) : '';

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex flex-col h-screen bg-[#050508] text-white overflow-hidden selection:bg-blue-500/30">
                {/* Header / Toolbar */}
                <header className="h-16 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between px-6 z-50">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-linear-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.4)]">
                                <span className="font-black text-xs">F</span>
                            </div>
                            <h1 className="font-black tracking-tighter text-xl bg-clip-text text-transparent bg-linear-to-r from-white to-gray-400">
                                FORGE <span className="text-blue-500 text-sm italic font-medium ml-1">Studio</span>
                            </h1>
                        </div>
                        <div className="h-6 w-px bg-white/10 mx-2" />
                        <div className="hidden lg:flex bg-white/5 p-1 rounded-xl border border-white/5">
                            {[
                                { id: 'desktop', icon: Monitor, label: 'Desktop' },
                                { id: 'tablet', icon: Tablet, label: 'Tablet' },
                                { id: 'mobile', icon: Smartphone, label: 'Mobile' }
                            ].map((mode) => (
                                <button
                                    key={mode.id}
                                    onClick={() => setViewMode(mode.id as any)}
                                    className={cn(
                                        "p-2 rounded-lg transition-all duration-300 flex items-center gap-2 px-3 text-xs font-bold uppercase tracking-widest",
                                        viewMode === mode.id
                                            ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                                            : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                                    )}
                                >
                                    <mode.icon size={14} />
                                    <span className="hidden lg:inline">{mode.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setShowCode(!showCode)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest rounded-xl transition-all border",
                                showCode
                                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                    : "bg-white/5 border-white/5 text-gray-400 hover:text-white hover:bg-white/10"
                            )}
                        >
                            {showCode ? <Eye size={12}/> : <Code size={12}/>}
                            {showCode ? 'Canvas' : 'Code'}
                        </button>

                        <AnimatePresence>
                            {lastPublishedUrl && (
                                <motion.a
                                    initial={{ opacity: 0, scale: 0.9, x: 20 }}
                                    animate={{ opacity: 1, scale: 1, x: 0 }}
                                    href={lastPublishedUrl}
                                    target="_blank"
                                    className="flex items-center gap-2 text-[8px] font-bold text-blue-400 hover:text-blue-300 transition-colors bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 relative group overflow-hidden"
                                >
                                    <motion.span
                                        animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
                                        transition={{ repeat: Infinity, duration: 2 }}
                                        className="w-1 h-1 bg-blue-400 rounded-full"
                                    />
                                    LIVE
                                    <ExternalLink size={9} />
                                </motion.a>
                            )}
                        </AnimatePresence>

                        <ExportBuildButton addLog={addLog} />

                        <button
                            onClick={handlePublish}
                            disabled={isPublishing}
                            className="relative group bg-blue-600 hover:bg-blue-500 text-white px-6 py-1.5 rounded-xl font-bold text-[9px] uppercase tracking-widest transition-all disabled:opacity-50 overflow-hidden shadow-[0_0_20px_rgba(37,99,235,0.3)]"
                        >
                            <div className="flex items-center gap-2 relative z-10">
                                {isPublishing ? (
                                    <Loader2 className="animate-spin" size={12} />
                                ) : (
                                    <Zap size={12} className="fill-current" />
                                )}
                                {isPublishing ? 'PUBLISHING...' : 'PUBLISH'}
                            </div>
                            <div className="absolute inset-0 bg-linear-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:animate-shimmer" />
                        </button>
                    </div>
                </header>

                {/* Main Content */}
                <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
                    {/* Left Sidebar - Elements (Desktop) */}
                    <aside className="hidden lg:flex w-72 bg-[#0a0a0f]/80 backdrop-blur-2xl border-r border-white/5 flex-col z-40">
                        <ElementsSidebar />
                    </aside>

                    {/* Canvas Area or Code View */}
                    <div className="flex-1 overflow-hidden flex flex-col relative bg-[#1a1a24]">
                        <AnimatePresence mode="wait">
                            {showCode ? (
                                <motion.div
                                    key="code"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="h-full flex flex-col bg-[#050508]"
                                >
                                    <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-black/40 backdrop-blur-md">
                                        <div className="flex items-center gap-2">
                                            <div className="flex gap-1.5">
                                                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40" />
                                                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40" />
                                                <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/40" />
                                            </div>
                                            <span className="text-[10px] font-mono text-gray-500 ml-2 tracking-widest uppercase">App.tsx — Forge Output</span>
                                        </div>
                                        <button
                                            onClick={() => {
                                                navigator.clipboard.writeText(generatedCode);
                                                addLog("Source code copied to clipboard");
                                            }}
                                            className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all flex items-center gap-2 group"
                                        >
                                            <Copy size={14} className="group-hover:scale-110 transition-transform" />
                                            <span className="text-[10px] font-bold uppercase tracking-wider pr-1">Copy Code</span>
                                        </button>
                                    </div>
                                    <div className="flex-1 relative overflow-hidden">
                                        <Editor
                                            height="100%"
                                            defaultLanguage="typescript"
                                            theme="vs-dark"
                                            value={generatedCode}
                                            options={{
                                                readOnly: true,
                                                minimap: { enabled: false },
                                                fontSize: 12,
                                                fontFamily: 'var(--font-mono)',
                                                scrollBeyondLastLine: false,
                                                automaticLayout: true,
                                                padding: { top: 20 }
                                            }}
                                            loading={<div className="h-full w-full bg-[#050508] flex items-center justify-center text-xs text-blue-500/50 animate-pulse">Initializing Virtual IDE...</div>}
                                        />
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="canvas"
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                    className="h-full w-full"
                                >
                                    <VisualCanvas />
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Log Overlay */}
                        <div className="absolute bottom-20 lg:bottom-6 left-6 pointer-events-none z-50">
                            <div className="bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl min-w-[300px] max-w-[calc(100vw-3rem)]">
                                <div className="flex items-center gap-2 mb-3 text-[10px] font-bold text-gray-500 uppercase tracking-widest border-b border-white/5 pb-2">
                                    <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                                    Forge Terminal
                                </div>
                                <div className="space-y-1 max-h-40 overflow-hidden">
                                    {logs.length === 0 && <div className="text-[10px] text-gray-600 italic">No output... awaiting action</div>}
                                    <AnimatePresence initial={false}>
                                        {logs.map((log: string, i: number) => (
                                            <motion.div
                                                initial={{ opacity: 0, x: -5 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                key={`${log}-${i}`}
                                                className="text-[10px] font-mono text-blue-100/60 leading-tight truncate"
                                            >
                                                {log}
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Sidebar - Properties (Desktop) */}
                    <div className="hidden lg:block w-80 shrink-0 z-40 border-l border-white/5 bg-[#0a0a0f]">
                        <PropertyPanel />
                    </div>
                </main>

                {/* Drag Overlay */}
                <DragOverlay dropAnimation={null}>
                    {activeDragType ? (
                        <div className="px-5 py-3 bg-blue-600 text-white rounded-xl shadow-2xl font-bold text-xs uppercase tracking-widest ring-4 ring-blue-500/30 cursor-grabbing animate-pulse">
                            {activeDragType}
                        </div>
                    ) : null}
                </DragOverlay>
            </div>

            <AICommandCenter onLog={addLog} />

            {/* Mobile Bottom Navigation */}
            <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#0a0a0f] border-t border-white/10 flex items-center justify-around z-50 px-4">
                <Sheet>
                    <SheetTrigger asChild>
                        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                            <PlusSquare size={20} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Add</span>
                        </button>
                    </SheetTrigger>
                    <SheetContent side="left" className="bg-[#0a0a0f] border-white/10 p-0 w-[85vw]">
                        <ElementsSidebar />
                    </SheetContent>
                </Sheet>

                <div className="w-px h-8 bg-white/10" />

                <Sheet>
                    <SheetTrigger asChild>
                        <button className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors">
                            <Settings2 size={20} />
                            <span className="text-[10px] font-bold uppercase tracking-wider">Props</span>
                        </button>
                    </SheetTrigger>
                    <SheetContent side="right" className="bg-[#0a0a0f] border-white/10 p-0 w-[85vw]">
                        <PropertyPanel />
                    </SheetContent>
                </Sheet>
            </div>
        </DndContext>
    );
}

