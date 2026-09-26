"use client";

import React, { useState, useEffect } from 'react';
import { useEditorStore, EditorElement, SectionBlock } from '../../../lib/store/editor-store';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '../../../lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

const RenderElement = React.forwardRef(({ element, depth = 0 }: { element: EditorElement, depth?: number }, ref: React.ForwardedRef<any>) => {
    const { selectedId, selectElement } = useEditorStore();
    const isSelected = selectedId === element.id;

    const baseProps = {
        onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            selectElement(element.id);
        },
        className: cn(
            element.className,
            "transition-all duration-300 relative",
            isSelected ? "ring-2 ring-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] z-10 cursor-default" : "hover:ring-1 hover:ring-blue-500/30 cursor-pointer"
        )
    };

    if (element.type === 'text') {
        const Tag = element.tag as any;
        return (
            <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} ref={ref}>
                <Tag {...baseProps}>{element.content}</Tag>
            </motion.div>
        );
    }

    if (element.type === 'button') {
        return (
            <motion.button layout {...baseProps} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} ref={ref}>
                {element.content}
            </motion.button>
        );
    }

    if (element.type === 'image') {
        return <motion.img layout src={element.src} alt={element.alt} {...baseProps} initial={{ opacity: 0 }} animate={{ opacity: 1 }} ref={ref} />;
    }

    if (element.type === 'container') {
        return (
            <motion.div layout {...baseProps} ref={ref}>
                {element.children.map(child => (
                    <RenderElement key={child.id} element={child} depth={depth + 1} />
                ))}
            </motion.div>
        );
    }

    return null;
});

RenderElement.displayName = 'RenderElement';

const SectionRenderer = React.forwardRef(({ section }: { section: SectionBlock }, ref: React.ForwardedRef<HTMLElement>) => {
    const { selectedId, selectElement } = useEditorStore();
    const isSelected = selectedId === section.id;

    return (
        <motion.section
            ref={ref}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                selectElement(section.id);
            }}
            className={cn(
                section.className,
                "relative transition-all duration-500",
                isSelected ? "ring-2 ring-blue-600 shadow-[0_0_20px_rgba(37,99,235,0.2)] z-0" : "hover:ring-1 hover:ring-blue-500/20"
            )}
        >
            {/* Selection Label */}
            <AnimatePresence>
                {isSelected && (
                    <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 5 }}
                        className="absolute top-0 left-0 -translate-y-full bg-blue-600 text-white text-[10px] px-2 py-1 rounded-t font-bold tracking-wider"
                    >
                        {section.name.toUpperCase()}
                    </motion.div>
                )}
            </AnimatePresence>

            {section.children.map(child => (
                <RenderElement element={child} key={child.id} />
            ))}
        </motion.section>
    );
});

SectionRenderer.displayName = 'SectionRenderer';

export const VisualCanvas = () => {
    const { blocks, viewMode } = useEditorStore();
    const [mounted, setMounted] = useState(false);
    const { setNodeRef, isOver } = useDroppable({
        id: 'canvas-drop-zone',
    });

    useEffect(() => {
        setMounted(true);
    }, []);

    const widthClass = viewMode === 'mobile' ? 'max-w-[375px]' : viewMode === 'tablet' ? 'max-w-[768px]' : 'w-full';

    if (!mounted) return <div className="flex-1 bg-[#0a0a0f]" />;

    return (
        <div className="flex-1 bg-[#0a0a0f] overflow-auto flex justify-center p-8 relative scroll-smooth">

            {/* Background decorative elements */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-5%] left-[-5%] w-[30%] h-[30%] bg-blue-600/5 blur-[100px] rounded-full" />
                <div className="absolute bottom-[-5%] right-[-5%] w-[30%] h-[30%] bg-purple-600/5 blur-[100px] rounded-full" />
            </div>

            {/* Canvas Area */}
            <motion.div
                ref={setNodeRef}
                layout
                data-testid="canvas-drop-zone"
                className={cn(
                    "bg-white shadow-[0_20px_50px_rgba(0,0,0,0.3)] min-h-[850px] transition-all duration-500 origin-top overflow-hidden relative",
                    widthClass,
                    isOver ? "ring-4 ring-blue-500/50 scale-[1.01]" : ""
                )}
            >
                <AnimatePresence mode="popLayout">
                    {blocks.length === 0 ? (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="h-full flex flex-col items-center justify-center text-gray-300 p-12"
                        >
                            <div className="relative group">
                                <div className="absolute -inset-1 bg-linear-to-r from-blue-600 to-purple-600 rounded-2xl blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                                <div className="relative border border-gray-200/50 bg-white/50 backdrop-blur-xl rounded-2xl p-16 text-center shadow-xl">
                                    <div className="mb-6 inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 text-blue-600">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                                    </div>
                                    <h3 className="text-2xl font-bold text-gray-800 mb-2">Build Your Vision</h3>
                                    <p className="text-gray-500 max-w-[200px] mx-auto text-sm leading-relaxed">
                                        Drag elements from the sidebar to start creating.
                                    </p>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        blocks.map((block: SectionBlock) => (
                            <SectionRenderer section={block} key={block.id} />
                        ))
                    )}
                </AnimatePresence>
            </motion.div>

        </div>
    );
};
