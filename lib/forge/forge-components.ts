import { SectionBlock, EditorElement } from '../store/editor-store';

// We use Recursive partial or specialized template types to avoid ID requirement here
export type TemplateElement = any; // Simplification for the registry
export type TemplateSection = any;
export type ComponentTemplate = TemplateSection;

export const FORGE_COMPONENTS: Record<string, any> = {
  'hero-modern': {
    type: 'section',
    name: 'Hero Section',
    className: 'w-full py-24 px-8 bg-black flex flex-col items-center justify-center text-center relative overflow-hidden',
    children: [
        {
            id: 'h1',
            type: 'text',
            tag: 'h1',
            content: 'Evolve Your Digital Vision',
            className: 'text-6xl font-black tracking-tighter mb-6 bg-clip-text text-transparent bg-linear-to-r from-blue-400 to-purple-600'
        },
        {
            id: 'p1',
            type: 'text',
            tag: 'p',
            content: 'The ultimate browser-based PWA editor for makers, hackers and visionaries.',
            className: 'text-xl text-gray-400 max-w-2xl mb-10'
        },
        {
            id: 'btn1',
            type: 'button',
            content: 'Get Started Matrix',
            className: 'px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(37,99,235,0.4)] hover:scale-105 active:scale-95'
        }
    ]
  },
  'feature-grid': {
    type: 'section',
    name: 'Features',
    className: 'w-full py-20 px-8 bg-[#050508]',
    children: [
        {
            id: 'grid',
            type: 'container',
            className: 'grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto',
            children: [
                {
                    id: 'card1',
                    type: 'container',
                    className: 'p-8 bg-white/5 border border-white/10 rounded-3xl hover:border-blue-500/50 transition-colors group',
                    children: [
                        { id: 'c1-t1', type: 'text', tag: 'h3', content: 'Ultra Fast', className: 'text-xl font-bold mb-2 group-hover:text-blue-400 transition-colors' },
                        { id: 'c1-p1', type: 'text', tag: 'p', content: 'Built on the latest Chromium core with insane speed optimizations.', className: 'text-sm text-gray-500' }
                    ]
                },
                {
                    id: 'card2',
                    type: 'container',
                    className: 'p-8 bg-white/5 border border-white/10 rounded-3xl hover:border-purple-500/50 transition-colors group',
                    children: [
                        { id: 'c2-t1', type: 'text', tag: 'h3', content: 'Secure Core', className: 'text-xl font-bold mb-2 group-hover:text-purple-400 transition-colors' },
                        { id: 'c2-p1', type: 'text', tag: 'p', content: 'Zero-knowledge architecture ensuring your data stays yours.', className: 'text-sm text-gray-500' }
                    ]
                },
                {
                    id: 'card3',
                    type: 'container',
                    className: 'p-8 bg-white/5 border border-white/10 rounded-3xl hover:border-emerald-500/50 transition-colors group',
                    children: [
                        { id: 'c3-t1', type: 'text', tag: 'h3', content: 'AI Powered', className: 'text-xl font-bold mb-2 group-hover:text-emerald-400 transition-colors' },
                        { id: 'c3-p1', type: 'text', tag: 'p', content: 'Integrated LLMs helping you browse and build smarter.', className: 'text-sm text-gray-500' }
                    ]
                }
            ]
        }
    ]
  },
  'glass-card': {
    type: 'section',
    name: 'Promo Card',
    className: 'w-full py-10 px-8 flex justify-center',
    children: [
        {
            id: 'glass-inner',
            type: 'container',
            className: 'p-10 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[40px] shadow-2xl relative group overflow-hidden max-w-lg',
            children: [
                { id: 'g-t', type: 'text', tag: 'h2', content: 'PREMIUM ACCESS', className: 'text-2xl font-black mb-4 tracking-tight text-white' },
                { id: 'g-p', type: 'text', tag: 'p', content: 'Unlock the full potential of PΛND0RΛ with our pro membership features.', className: 'text-white/60 text-sm mb-8' },
                { id: 'g-b', type: 'button', content: 'UPGRADE NOW', className: 'w-full py-3 bg-white text-black font-black rounded-xl hover:bg-blue-400 transition-colors text-[10px]' }
            ]
        }
    ]
  },
  'contact-form': {
    type: 'section',
    name: 'Contact',
    className: 'w-full py-20 px-8 flex justify-center',
    children: [
        {
            id: 'form-cont',
            type: 'container',
            className: 'w-full max-w-md space-y-4 p-8 bg-[#0a0a0f] border border-white/5 rounded-3xl',
            children: [
                { id: 'f-t', type: 'text', tag: 'h2', content: 'Join the waitlist', className: 'text-2xl font-bold text-center mb-6' },
                { id: 'f-i1', type: 'input', inputType: 'text', placeholder: 'PΛND0RΛ ID / Email', className: 'w-full bg-black/40 border border-white/10 px-4 py-3 rounded-xl focus:border-blue-500 outline-hidden' },
                { id: 'f-btn', type: 'button', content: 'SUBMIT ACCESS REQUEST', className: 'w-full py-4 bg-linear-to-r from-blue-600 to-purple-600 rounded-xl font-bold text-[10px] tracking-widest' }
            ]
        }
    ]
  }
};
