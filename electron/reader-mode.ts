import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import createDOMPurify from 'dompurify'

const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window)

export class ReaderManager {
    static parse(html: string, url: string) {
        const doc = new JSDOM(html, { url }).window.document
        const reader = new Readability(doc)
        const article = reader.parse()

        if (!article || !article.content) return null

        const cleanContent = DOMPurify.sanitize(article.content)

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${article.title}</title>
                <style>
                    :root {
                        --bg-primary: #0a0a0f;
                        --bg-secondary: #1a1a1f;
                        --text-primary: #e0e0e0;
                        --text-secondary: #a0a0a0;
                        --accent: #3b82f6;
                        --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                        --font-serif: 'Georgia', 'Cambria', serif;
                    }

                    body {
                        font-family: var(--font-serif);
                        background-color: var(--bg-primary);
                        color: var(--text-primary);
                        max-width: 760px;
                        margin: 0 auto;
                        padding: 60px 24px;
                        line-height: 1.8;
                        font-size: 19px;
                        transition: background-color 0.3s, color 0.3s;
                    }

                    h1, h2, h3, h4, h5, h6 {
                        font-family: var(--font-sans);
                        color: #ffffff;
                        line-height: 1.3;
                        margin-top: 1.5em;
                        margin-bottom: 0.5em;
                    }

                    h1 { font-size: 2.8em; font-weight: 700; letter-spacing: -0.02em; border-bottom: 1px solid var(--bg-secondary); padding-bottom: 20px; }
                    
                    a { color: var(--accent); text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 0.2s; }
                    a:hover { border-bottom-color: var(--accent); }
                    
                    img { max-width: 100%; height: auto; border-radius: 12px; margin: 30px 0; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
                    
                    blockquote { border-left: 4px solid var(--accent); padding-left: 20px; margin: 30px 0; color: var(--text-secondary); font-style: italic; background: var(--bg-secondary); padding: 20px; border-radius: 0 8px 8px 0; }
                    
                    pre { background: var(--bg-secondary); padding: 20px; overflow-x: auto; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05); font-family: 'Menlo', monospace; font-size: 0.85em; }
                    
                    .reader-header { margin-bottom: 50px; }
                    .byline { color: var(--text-secondary); font-family: var(--font-sans); font-size: 0.95em; margin-top: -10px; }
                    
                    /* Selection */
                    ::selection { background: rgba(59, 130, 246, 0.3); color: white; }
                </style>
            </head>
            <body>
                <div class="reader-header">
                    <h1>${article.title}</h1>
                    ${article.byline ? `<p class="byline">By ${article.byline}</p>` : ''}
                </div>
                <div class="content">
                    ${cleanContent}
                </div>
            </body>
            </html>
        `
    }
}
