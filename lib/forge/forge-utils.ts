import { SectionBlock, EditorElement } from '../store/editor-store';

export const generateReactCode = (blocks: SectionBlock[]): string => {
    const generateElement = (el: EditorElement, indent = 4): string => {
        const spaces = ' '.repeat(indent);

        // Handling className - ensuring typical tailwind classes
        const className = el.className ? `className="${el.className}"` : '';

        if (el.type === 'text') {
            return `\n${spaces}<${el.tag} ${className}>${el.content}</${el.tag}>`;
        }

        if (el.type === 'button') {
            return `\n${spaces}<button ${className}>${el.content}</button>`;
        }

        if (el.type === 'image') {
            return `\n${spaces}<img src="${el.src}" alt="${el.alt}" ${className} />`;
        }

        if (el.type === 'container') {
            const children = el.children.map((c: any) => generateElement(c, indent + 2)).join('');
            return `\n${spaces}<div ${className}>${children}\n${spaces}</div>`;
        }

        return '';
    };

    const generateSection = (section: SectionBlock): string => {
        const content = section.children.map((c: any) => generateElement(c, 6)).join('');
        return `
    {/* ${section.name} */}
    <section className="${section.className}">${content}
    </section>`;
    };

    return `import React from 'react';

export default function App() {
  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      ${blocks.map(generateSection).join('\n')}
    </div>
  );
}`;
};
