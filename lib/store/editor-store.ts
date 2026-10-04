import { create } from 'zustand';
// import { v4 as uuidv4 } from 'uuid';

const uuidv4 = () => Math.random().toString(36).substr(2, 9);

export type TextElement = {
    id: string;
    type: 'text';
    content: string;
    tag: 'h1' | 'h2' | 'h3' | 'p' | 'span';
    className: string;
};

export type ImageElement = {
    id: string;
    type: 'image';
    src: string;
    alt: string;
    className: string;
};

export type ButtonElement = {
    id: string;
    type: 'button';
    content: string;
    className: string;
};

export type InputElement = {
    id: string;
    type: 'input';
    placeholder: string;
    inputType: 'text' | 'email' | 'password';
    className: string;
};

export type BadgeElement = {
    id: string;
    type: 'badge';
    content: string;
    variant: 'default' | 'outline' | 'secondary' | 'destructive';
    className: string;
};

export type ContainerElement = {
    id: string;
    type: 'container';
    className: string;
    children: EditorElement[];
};

export type EditorElement = TextElement | ImageElement | ButtonElement | ContainerElement | InputElement | BadgeElement;

export type SectionBlock = {
    id: string;
    type: 'section';
    name: string;
    className: string;
    children: EditorElement[];
};

interface EditorState {
    blocks: SectionBlock[];
    selectedId: string | null;
    viewMode: 'desktop' | 'tablet' | 'mobile';

    // Actions
    addBlock: (block: Omit<SectionBlock, 'id'>) => void;
    updateBlock: (id: string, updates: Partial<SectionBlock>) => void;
    removeBlock: (id: string) => void;

    updateElement: (id: string, updates: Partial<EditorElement>) => void;
    selectElement: (id: string | null) => void;
    setViewMode: (mode: 'desktop' | 'tablet' | 'mobile') => void;
    setBlocks: (blocks: SectionBlock[]) => void;

    // Utilities
    findElement: (id: string, blocks?: SectionBlock[]) => EditorElement | SectionBlock | null;
}

// Helper to recursively find and update
const updateElementInBlocks = (blocks: SectionBlock[], id: string, updates: any): SectionBlock[] => {
    return blocks.map(block => {
        if (block.id === id) return { ...block, ...updates };

        // Recursive update for children in section
        const updateChildren = (elements: EditorElement[]): EditorElement[] => {
            return elements.map(el => {
                if (el.id === id) return { ...el, ...updates };
                if (el.type === 'container') {
                    return { ...el, children: updateChildren(el.children) };
                }
                return el;
            });
        };

        return { ...block, children: updateChildren(block.children) };
    });
};

export const useEditorStore = create<EditorState>((set: any, get: any) => ({
    blocks: [
        {
            id: 'header-1',
            type: 'section',
            name: 'Header',
            className: 'w-full py-6 px-8 bg-white border-b border-gray-100 flex justify-between items-center',
            children: [
                {
                    id: 'logo-1',
                    type: 'text',
                    tag: 'h1',
                    content: 'Logo',
                    className: 'text-2xl font-bold text-gray-900'
                },
                {
                    id: 'nav-1',
                    type: 'container',
                    className: 'flex gap-6',
                    children: [
                        { id: 'lnk-1', type: 'text', tag: 'span', content: 'Home', className: 'text-gray-600 hover:text-blue-600 cursor-pointer' },
                        { id: 'lnk-2', type: 'text', tag: 'span', content: 'About', className: 'text-gray-600 hover:text-blue-600 cursor-pointer' },
                        { id: 'lnk-3', type: 'text', tag: 'span', content: 'Contact', className: 'text-gray-600 hover:text-blue-600 cursor-pointer' },
                    ]
                }
            ]
        },
        {
            id: 'hero-1',
            type: 'section',
            name: 'Hero Section',
            className: 'w-full py-24 px-6 flex flex-col items-center justify-center text-center bg-gray-50',
            children: [
                {
                    id: 'hero-title',
                    type: 'text',
                    tag: 'h1',
                    content: 'Welcome to the Future',
                    className: 'text-5xl font-extrabold text-gray-900 mb-6 max-w-4xl leading-tight'
                },
                {
                    id: 'hero-sub',
                    type: 'text',
                    tag: 'p',
                    content: 'Drag, drop, and build amazing websites in minutes with our new visual editor.',
                    className: 'text-xl text-gray-500 mb-10 max-w-2xl'
                },
                {
                    id: 'hero-btn',
                    type: 'button',
                    content: 'Get Started',
                    className: 'px-8 py-4 bg-blue-600 text-white rounded-full font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/30'
                }
            ]
        }
    ],
    selectedId: null,
    viewMode: 'desktop',

    addBlock: (block: Omit<SectionBlock, 'id'>) => set((state: EditorState) => ({
        blocks: [...state.blocks, { ...block, id: uuidv4() }]
    })),

    updateBlock: (id: string, updates: Partial<SectionBlock>) => set((state: EditorState) => ({
        blocks: state.blocks.map((b: SectionBlock) => b.id === id ? { ...b, ...updates } : b)
    })),

    removeBlock: (id: string) => set((state: EditorState) => ({
        blocks: state.blocks.filter((b: SectionBlock) => b.id !== id)
    })),

    updateElement: (id: string, updates: Partial<EditorElement>) => set((state: EditorState) => ({
        blocks: updateElementInBlocks(state.blocks, id, updates)
    })),

    selectElement: (id: string | null) => set({ selectedId: id }),

    setViewMode: (mode: 'desktop' | 'tablet' | 'mobile') => set({ viewMode: mode }),

    setBlocks: (blocks: SectionBlock[]) => set({ blocks, selectedId: null }),

    findElement: (id: string) => {
        // Simple search (could be optimized)
        let found: EditorElement | SectionBlock | null = null;
        const search = (items: (EditorElement | SectionBlock)[]) => {
            for (const item of items) {
                if (item.id === id) {
                    found = item;
                    return;
                }
                if ('children' in item && item.children) search(item.children);
            }
        };
        search(get().blocks);
        return found;
    }
}));
