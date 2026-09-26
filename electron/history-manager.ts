import FlexSearch from 'flexsearch'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export class HistoryManager {
    private index: any
    private storagePath: string
    private docs: Map<string, any>

    constructor() {
        this.storagePath = path.join(app.getPath('userData'), 'history-index.json')
        this.docs = new Map()

        // Initialize FlexSearch
        // @ts-ignore
        this.index = new FlexSearch.Document({
            document: {
                id: 'id',
                index: ['title', 'content', 'url'],
                store: ['title', 'url', 'timestamp']
            },
            tokenize: 'forward'
        })

        this.load()
    }

    addEntry(entry: { url: string, title: string, content: string }) {
        const id = Date.now().toString()
        const doc = {
            id,
            url: entry.url,
            title: entry.title,
            content: entry.content,
            timestamp: Date.now()
        }

        this.index.add(doc)
        this.docs.set(id, doc)

        // Auto-save every 10 entries or debounce? simple for now:
        this.save()
    }

    search(query: string) {
        const results = this.index.search(query, { limit: 10 })
        // FlexSearch returns format: [{ field: 'title', result: [id1, id2] }, ...]
        // We need to deduplicate and fetch docs

        const ids = new Set<string>()
        if (results && results.length) {
            results.forEach((fieldResult: any) => {
                fieldResult.result.forEach((id: string) => ids.add(id))
            })
        }

        return Array.from(ids).map(id => {
            const doc = this.docs.get(id)
            return {
                id,
                title: doc.title,
                url: doc.url,
                timestamp: doc.timestamp
            }
        })
    }

    private save() {
        try {
            // FlexSearch export is async in new versions or callback based, 
            // but we can just export keys if we don't need full persistence of the internal tree structure for now
            // Actually FlexSearch persistence is tricky. 
            // For MVP "Second Brain", let's just save the raw docs and re-index on load.
            // It's slower on startup but safer.
            const data = JSON.stringify(Array.from(this.docs.values()))
            fs.writeFileSync(this.storagePath, data)
        } catch (e) {
            console.error('Failed to save history index', e)
        }
    }

    private load() {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8')
                const docs = JSON.parse(data)
                docs.forEach((doc: any) => {
                    this.index.add(doc)
                    this.docs.set(doc.id, doc)
                })
            }
        } catch (e) {
            console.error('Failed to load history index', e)
        }
    }
}
