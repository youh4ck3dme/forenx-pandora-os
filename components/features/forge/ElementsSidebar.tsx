import React, { useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Type, Image, Box, Layout, MousePointer2, FormInput, Tag, Sparkles, Grid3X3, CreditCard, Send, Layers } from 'lucide-react';

const ElementItem = ({ type, label, icon: Icon }: { type: string, label: string, icon: any }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: `drift-${type}`,
        data: { type, isNew: true }
    });

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        boxShadow: '0 10px 20px rgba(0,0,0,0.2)',
        zIndex: 9999,
        cursor: 'grabbing'
    } : undefined;

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            style={style}
            className="flex items-center gap-3 p-3 mb-2 bg-[#1a1a24] hover:bg-[#2a2a35] border border-[#2a2a35] rounded-lg cursor-grab active:cursor-grabbing transition-colors text-gray-400 hover:text-white"
        >
            <Icon size={16} />
            <span className="text-sm font-medium">{label}</span>
        </div>
    );
};

export const ElementsSidebar = () => {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    return (
        <div className="flex flex-col h-full bg-[#0a0a0f] border-r border-[#1f1f2e]">
            <div className="p-4 border-b border-[#1f1f2e] flex items-center gap-2">
                <MousePointer2 className="text-blue-500" size={18} />
                <span className="font-bold tracking-wider text-white text-sm">ELEMENTS</span>
            </div>

            <div className="flex-1 overflow-y-auto p-4 scrollbar-hide">
                {mounted && (
                    <>
                        <div className="mb-6">
                            <div className="text-xs text-gray-500 font-bold mb-3 uppercase tracking-widest">Structure</div>
                            <ElementItem type="section" label="Section Block" icon={Layout} />
                            <ElementItem type="container" label="Container" icon={Box} />
                        </div>

                        <div className="mb-6">
                            <div className="text-xs text-gray-500 font-bold mb-3 uppercase tracking-widest">Basic</div>
                            <ElementItem type="text" label="Text Block" icon={Type} />
                            <ElementItem type="image" label="Image" icon={Image} />
                            <ElementItem type="button" label="Button" icon={MousePointer2} />
                        </div>

                        <div className="mb-6">
                            <div className="text-xs text-gray-500 font-bold mb-3 uppercase tracking-widest">Library</div>
                            <ElementItem type="hero-modern" label="Hero Modern" icon={Sparkles} />
                            <ElementItem type="feature-grid" label="Feature Grid" icon={Grid3X3} />
                            <ElementItem type="glass-card" label="Glass Card" icon={CreditCard} />
                            <ElementItem type="contact-form" label="Access Form" icon={Send} />
                        </div>

                        <div className="mb-6">
                            <div className="text-xs text-gray-500 font-bold mb-3 uppercase tracking-widest">Form & UI</div>
                            <ElementItem type="input" label="Input Field" icon={FormInput} />
                            <ElementItem type="badge" label="Badge" icon={Tag} />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
