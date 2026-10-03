import { safeStorage, app } from 'electron'
import path from 'path'
import fs from 'fs'

export class PasswordManager {
    private storagePath: string
    private accounts: Map<string, any>

    constructor() {
        this.storagePath = path.join(app.getPath('userData'), 'passwords.enc')
        this.accounts = new Map()
        this.load()
    }

    async savePassword(entry: { url: string, username: string, password: string }) {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error('Encryption not available')
        }

        const encryptedPassword = safeStorage.encryptString(entry.password)
        const id = Buffer.from(`${entry.url}:${entry.username}`).toString('base64')

        const doc = {
            id,
            url: entry.url,
            username: entry.username,
            password: encryptedPassword.toString('base64'),
            updatedAt: Date.now()
        }

        this.accounts.set(id, doc)
        this.save()
        return id
    }

    listMasked(): { id: string; url: string; username: string; updatedAt: number }[] {
        return Array.from(this.accounts.values()).map(doc => ({
            id: doc.id,
            url: doc.url,
            username: doc.username,
            updatedAt: doc.updatedAt,
        }))
    }

    revealPassword(id: string): { id: string; url: string; username: string; password: string; updatedAt: number } | null {
        if (!safeStorage.isEncryptionAvailable()) return null
        const doc = this.accounts.get(id)
        if (!doc) return null
        try {
            const decryptedBuffer = Buffer.from(doc.password, 'base64')
            const decryptedPassword = safeStorage.decryptString(decryptedBuffer)
            return { id: doc.id, url: doc.url, username: doc.username, password: decryptedPassword, updatedAt: doc.updatedAt }
        } catch (e) {
            console.error('Failed to decrypt password', e)
            return null
        }
    }

    deletePassword(id: string) {
        if (this.accounts.has(id)) {
            this.accounts.delete(id)
            this.save()
            return true
        }
        return false
    }

    private save() {
        try {
            const data = JSON.stringify(Array.from(this.accounts.values()))
            fs.writeFileSync(this.storagePath, data)
        } catch (e) {
            console.error('Failed to save passwords', e)
        }
    }

    private load() {
        try {
            if (fs.existsSync(this.storagePath)) {
                const data = fs.readFileSync(this.storagePath, 'utf8')
                const docs = JSON.parse(data)
                docs.forEach((doc: any) => {
                    this.accounts.set(doc.id, doc)
                })
            }
        } catch (e) {
            console.error('Failed to load passwords', e)
        }
    }
}
