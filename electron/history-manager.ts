import FlexSearch from 'flexsearch'
import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'

export interface HistoryEntry {
    url: string
    title: string
    content?: string
}

export interface HistoryDoc {
    id: string
    url: string
    title: string
    content?: string
    timestamp: number
}

export interface PersistedHistoryDoc {
    id: string
    url: string
    title: string
    timestamp: number
    encryptedContent?: string
    // Legacy plaintext content key (migrated and deleted from disk)
    content?: string
}

export class HistoryManager {
    private index: any
    private storagePath: string
    private docs: Map<string, HistoryDoc>

    constructor(customStoragePath?: string) {
        this.storagePath = customStoragePath || (app ? path.join(app.getPath('userData'), 'history-index.json') : '')
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

        if (this.storagePath) {
            this.load()
        }
    }

    addEntry(entry: { url: string; title: string; content?: string }) {
        if (!entry || !entry.url) return

        let id = Date.now().toString()
        if (this.docs.has(id)) {
            id = `${id}-${Math.random().toString(36).substring(2, 8)}`
        }

        const doc: HistoryDoc = {
            id,
            url: entry.url,
            title: entry.title || '',
            content: typeof entry.content === 'string' ? entry.content.substring(0, 10000) : '',
            timestamp: Date.now()
        }

        this.index.add(doc)
        this.docs.set(id, doc)

        // Persist to encrypted history index
        this.save()
    }

    search(query: string) {
        if (!query || typeof query !== 'string') return []
        const results = this.index.search(query, { limit: 10 })

        // FlexSearch returns format: [{ field: 'title', result: [id1, id2] }, ...]
        // We deduplicate and fetch docs
        const ids = new Set<string>()
        if (results && results.length) {
            results.forEach((fieldResult: any) => {
                if (Array.isArray(fieldResult.result)) {
                    fieldResult.result.forEach((id: string) => ids.add(id))
                }
            })
        }

        return Array.from(ids).map(id => {
            const doc = this.docs.get(id)
            if (!doc) return null
            return {
                id,
                title: doc.title,
                url: doc.url,
                timestamp: doc.timestamp
            }
        }).filter((item): item is { id: string; title: string; url: string; timestamp: number } => item !== null)
    }

    getContent(url: string): HistoryDoc | null {
        if (!url || typeof url !== 'string') return null
        for (const doc of this.docs.values()) {
            if (doc.url === url) {
                return {
                    id: doc.id,
                    url: doc.url,
                    title: doc.title,
                    content: doc.content || '',
                    timestamp: doc.timestamp
                }
            }
        }
        return null
    }

    clear() {
        this.docs.clear()
        // @ts-ignore
        this.index = new FlexSearch.Document({
            document: {
                id: 'id',
                index: ['title', 'content', 'url'],
                store: ['title', 'url', 'timestamp']
            },
            tokenize: 'forward'
        })
        this.save()
    }

    private save() {
        if (!this.storagePath) return
        try {
            const encryptionAvailable = Boolean(
                safeStorage &&
                typeof safeStorage.isEncryptionAvailable === 'function' &&
                safeStorage.isEncryptionAvailable()
            )

            // Security invariant: NEVER store plaintext page content on disk.
            // If safeStorage is available, encrypt the content string.
            // If encryption is unavailable, do NOT persist content at all (metadata-only on disk).
            const serializedDocs: PersistedHistoryDoc[] = Array.from(this.docs.values()).map(doc => {
                const diskRecord: PersistedHistoryDoc = {
                    id: doc.id,
                    url: doc.url,
                    title: doc.title,
                    timestamp: doc.timestamp
                }

                if (doc.content && typeof doc.content === 'string' && doc.content.length > 0) {
                    if (encryptionAvailable) {
                        try {
                            const encryptedBuffer = safeStorage.encryptString(doc.content)
                            diskRecord.encryptedContent = encryptedBuffer.toString('base64')
                        } catch (err) {
                            console.error('[HistoryManager] safeStorage encryption failed, omitting content from disk:', err)
                        }
                    }
                    // When encryption is unavailable, diskRecord does NOT include content or encryptedContent
                }

                return diskRecord
            })

            const dir = path.dirname(this.storagePath)
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true })
            }

            const data = JSON.stringify(serializedDocs)
            fs.writeFileSync(this.storagePath, data, { encoding: 'utf8', mode: 0o600 })
        } catch (e) {
            console.error('[HistoryManager] Failed to save history index:', e)
        }
    }

    private load() {
        if (!this.storagePath) return
        try {
            if (!fs.existsSync(this.storagePath)) return

            const raw = fs.readFileSync(this.storagePath, 'utf8')
            if (!raw.trim()) return

            const docs = JSON.parse(raw)
            if (!Array.isArray(docs)) {
                console.error('[HistoryManager] History index is not an array')
                return
            }

            const encryptionAvailable = Boolean(
                safeStorage &&
                typeof safeStorage.isEncryptionAvailable === 'function' &&
                safeStorage.isEncryptionAvailable()
            )

            let needsRewrite = false

            docs.forEach((record: any) => {
                let content = ''

                if (record.encryptedContent && typeof record.encryptedContent === 'string') {
                    // Modern encrypted record
                    if (encryptionAvailable) {
                        try {
                            const buffer = Buffer.from(record.encryptedContent, 'base64')
                            content = safeStorage.decryptString(buffer)
                        } catch (err) {
                            console.error('[HistoryManager] Failed to decrypt encryptedContent:', err)
                            content = ''
                        }
                    } else {
                        // SafeStorage unavailable: fail-closed, do not expose or decrypt
                        content = ''
                    }
                } else if ('content' in record) {
                    // Legacy record with plaintext content: migration needed
                    needsRewrite = true
                    if (typeof record.content === 'string' && record.content.length > 0) {
                        if (encryptionAvailable) {
                            // Migrate: keep in memory, will be encrypted on rewrite
                            content = record.content
                        } else {
                            // Fail-closed: cannot encrypt on this platform/session, discard plaintext content
                            console.warn('[HistoryManager] Encryption unavailable during migration; discarding legacy plaintext content')
                            content = ''
                        }
                    }
                }

                const doc: HistoryDoc = {
                    id: String(record.id || Date.now()),
                    url: String(record.url || ''),
                    title: String(record.title || ''),
                    content,
                    timestamp: Number(record.timestamp) || Date.now()
                }

                this.index.add(doc)
                this.docs.set(doc.id, doc)
            })

            // Migration: rewrite file immediately so no plaintext 'content' remains on disk
            if (needsRewrite) {
                this.save()
            }
        } catch (e) {
            console.error('[HistoryManager] Failed to load history index:', e)
        }
    }
}
