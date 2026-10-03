import { app, BrowserWindow, ipcMain, BrowserView, shell, session, protocol, net, nativeTheme, Menu, MenuItem, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import fetch from 'cross-fetch'
import { HistoryManager } from './history-manager.js'
import { PasswordManager } from './password-manager.js'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText } from 'ai'
import pkg from 'electron-updater';
const { autoUpdater } = pkg;
import type { AppUpdater } from 'electron-updater';
import { configureWebTabsSession, createIsolatedBrowserView, getWebTabsSession, isValidWebTabUrl } from './browser-view-factory.js'
import { openExternalRequestSchema, readEvidenceChunkRequestSchema, selectEvidenceRequestSchema } from './ipc-contract.js'
import { validateExternalUrl } from './network-security.js'
import { VaultTokenManager } from './vault-token-manager.js'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = true
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048')

// Necessary for ESM in Electron
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let historyManager: HistoryManager | null = null
let passwordManager: PasswordManager | null = null
const vaultTokens = new VaultTokenManager()

let adBlocker: ElectronBlocker | null = null

// Shield session stats
const shieldStats = {
    ads: 0,
    trackers: 0,
    scripts: 0,
    total: 0
}

interface ShieldLog {
    id: string;
    url: string;
    category: 'ads' | 'trackers' | 'scripts';
    timestamp: number;
}
let shieldLogs: ShieldLog[] = []

function isAllowedRendererUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl)
        if (app.isPackaged) return url.protocol === 'app:'
        return (
            (url.protocol === 'http:' || url.protocol === 'https:') &&
            (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        )
    } catch {
        return false
    }
}

function protectRenderer(webContents: Electron.WebContents): void {
    webContents.on('will-navigate', (event, navigationUrl) => {
        if (!isAllowedRendererUrl(navigationUrl)) event.preventDefault()
    })
    webContents.on('will-attach-webview', (event) => event.preventDefault())
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

// URL categorization helper
function categorizeBlockedUrl(url: string): 'ads' | 'trackers' | 'scripts' {
    const lowerUrl = url.toLowerCase()

    // Ad networks
    const adPatterns = ['doubleclick', 'googlesyndication', 'googleadservices', 'adsystem', 'adservice', 'adnxs', 'advertising', 'amazon-adsystem', 'facebook.com/tr', 'ads.', '/ads/', 'pagead', 'adserver']
    if (adPatterns.some(p => lowerUrl.includes(p))) return 'ads'

    // Trackers
    const trackerPatterns = ['analytics', 'tracking', 'tracker', 'pixel', 'beacon', 'telemetry', 'metrics', 'collect', 'google-analytics', 'hotjar', 'mixpanel', 'segment', 'amplitude', 'sentry', 'newrelic', 'fullstory']
    if (trackerPatterns.some(p => lowerUrl.includes(p))) return 'trackers'

    // Scripts (fallback for blocked JS resources)
    if (lowerUrl.endsWith('.js') || lowerUrl.includes('script')) return 'scripts'

    // Default to trackers for unknown
    return 'trackers'
}

// AdBlocker Setup
async function setupAdBlocker() {
    try {
        adBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch)
        const webTabsSession = getWebTabsSession()
        adBlocker.enableBlockingInSession(webTabsSession)


            adBlocker.on('request-blocked', (request: any) => {
                const category = categorizeBlockedUrl(request.url)
                shieldStats[category]++
                shieldStats.total++

                const logEntry: ShieldLog = {
                    id: Math.random().toString(36).substring(2, 9),
                    url: request.url,
                    category,
                    timestamp: Date.now()
                }

                shieldLogs.unshift(logEntry)
                if (shieldLogs.length > 100) shieldLogs.pop()

                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('shield:blocked', {
                        ...logEntry,
                        stats: { ...shieldStats }
                    })
                }
            })
    } catch (error) {
        console.error('Failed to enable AdBlocker:', error)
    }
}

// IPC for AdBlocker Control
ipcMain.handle('shield:toggle', (_, enabled: boolean) => {
    const webTabsSession = getWebTabsSession()
    if (enabled) {
        if (adBlocker) {
            adBlocker.enableBlockingInSession(webTabsSession)
            return true
        }
    } else {
        if (adBlocker) {
            adBlocker.disableBlockingInSession(webTabsSession)
            return false
        }
    }
    return enabled
})

// IPC for Shield Stats
ipcMain.handle('shield:getStats', () => {
    return { ...shieldStats }
})

ipcMain.handle('shield:getLogs', () => {
    return [...shieldLogs]
})

// IPC Handlers for Password Manager
ipcMain.handle('password:save', async (_, entry) => {
    return passwordManager?.savePassword(entry)
})

ipcMain.handle('password:get', async () => {
    return passwordManager?.getPasswords()
})

ipcMain.handle('password:delete', async (_, id) => {
    return passwordManager?.deletePassword(id)
})


// IPC Handlers for Session Data
ipcMain.handle('session:clear-data', async () => {
    try {
        const webTabsSession = getWebTabsSession()
        await webTabsSession.clearStorageData({
            storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
        })
        await webTabsSession.clearCache()

        return true
    } catch (e) {
        console.error('Failed to clear session data:', e)
        return false
    }
})

// Deep Linking Setup
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('pandora', process.execPath, [path.resolve(process.argv[1])])
    }
} else {
    app.setAsDefaultProtocolClient('pandora')
}

ipcMain.handle('system:open-external-safe', async (_event, payload: unknown) => {
    const parsed = openExternalRequestSchema.safeParse(payload)
    if (!parsed.success) return { ok: false, code: 'VALIDATION_ERROR' }
    const validation = validateExternalUrl(parsed.data.url)
    if (!validation.ok) return { ok: false, code: 'SECURITY_POLICY_VIOLATION' }
    await shell.openExternal(validation.url)
    return { ok: true }
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
    app.quit()
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore()
            mainWindow.focus()
        }
        const url = commandLine.pop()
        if (url?.startsWith('pandora://')) {
            handleDeepLink(url)
        }
    })

    // Splash Screen
    function createSplashWindow() {
        splashWindow = new BrowserWindow({
            width: 340,
            height: 380,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
            },
            backgroundColor: '#00000000' // transparent
        })

        const html = `
    <html>
        <body style="margin:0;overflow:hidden;background:transparent;display:flex;align-items:center;justify-content:center;height:100vh;">
            <div style="background:#09090b;border:1px solid #27272a;border-radius:16px;padding:32px;display:flex;flex-direction:column;align-items:center;width:280px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
                <div style="width:64px;height:64px;background:linear-gradient(45deg, #3b82f6, #06b6d4);border-radius:16px;margin-bottom:24px;display:flex;align-items:center;justify-content:center;">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                </div>
                <h1 style="color:white;font-family:sans-serif;font-weight:800;font-size:24px;margin:0 0 8px 0;letter-spacing:-1px;">PΛND0RΛ</h1>
                <p style="color:#71717a;font-family:sans-serif;font-size:12px;margin:0 0 24px 0;letter-spacing:2px;text-transform:uppercase;font-weight:600;">Secure Browser</p>
                <div style="width:100%;height:2px;background:#27272a;border-radius:2px;overflow:hidden;">
                    <div style="width:100%;height:100%;background:#3b82f6;animation:load 1.5s infinite ease-in-out;transform-origin:0% 50%;"></div>
                </div>
                <style>
                    @keyframes load {
                        0% { transform: scaleX(0); }
                        50% { transform: scaleX(0.7); }
                        100% { transform: scaleX(0); transform-origin: 100% 50%; }
                    }
                </style>
            </div>
        </body>
    </html>
    `
        const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
        splashWindow.loadURL(dataUrl)
    }

    // Create window when ready
    app.whenReady().then(async () => {
        session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
            callback(false)
        })
        configureWebTabsSession()
        createSplashWindow()

        await setupAdBlocker()
        historyManager = new HistoryManager()
        passwordManager = new PasswordManager()

        // Slight delay to show splash (aesthetic)
        setTimeout(() => {
            createWindow()
        }, 1500)

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow()
        })
    })
}

// macOS Deep Link
app.on('open-url', (event, url) => {
    event.preventDefault()
    if (mainWindow) {
        handleDeepLink(url)
    }
})

function handleDeepLink(url: string) {
    if (!mainWindow) return
    const id = Date.now().toString()
    createTab(id, url)
}

// Tab management state
interface TabView {
    id: string
    view: BrowserView
    active: boolean
}

let tabs: TabView[] = []
let activeTabId: string | null = null

function createWindow() {
    nativeTheme.themeSource = 'dark'
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            preload: path.join(__dirname, 'preload.js'),
        },
        titleBarStyle: 'hiddenInset',
        backgroundColor: '#000000',
        show: false,
        icon: path.join(__dirname, '../public/apple-icon.png')
    })
    const mainWindowWebContentsId = mainWindow.webContents.id
    protectRenderer(mainWindow.webContents)

    // Clear cache and service workers on startup to prevent hijacking from old projects
    session.defaultSession.clearCache()
    session.defaultSession.clearStorageData({
        storages: ['serviceworkers', 'cachestorage']
    })

    // Register custom protocol for production
    if (!app.isPackaged) {
        mainWindow.loadURL(process.env.ELECTRON_START_URL || 'http://localhost:5353')
    } else {
        protocol.handle('app', (request) => {
            try {
                const url = new URL(request.url)
                let relativePath = url.pathname

                if (relativePath.startsWith('/')) {
                    relativePath = relativePath.substring(1)
                }

                if (!relativePath || relativePath === '.') {
                    relativePath = 'index.html'
                }

                let filePath = path.normalize(path.join(__dirname, '../out', relativePath))
                const outputRoot = path.resolve(__dirname, '../out')
                if (!filePath.startsWith(`${outputRoot}${path.sep}`) && filePath !== outputRoot) {
                    return new Response('Not Found', { status: 404 })
                }

                // If it's a directory or doesn't have an extension, try index.html
                if (!path.extname(filePath)) {
                    filePath = path.join(filePath, 'index.html')
                }


                return net.fetch(`file://${filePath}`)
            } catch (e) {
                console.error(`[PΛND0RΛ] Protocol Error:`, e)
                return new Response('Not Found', { status: 404 })
            }
        })
        mainWindow.loadURL('app://index.html')
    }

    mainWindow.once('ready-to-show', () => {
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.close()
            splashWindow = null
        }
        mainWindow?.show()
    })

    mainWindow.once('closed', () => {
        vaultTokens.revokeOwner(mainWindowWebContentsId)
        mainWindow = null
    })

    // Window Resize Handler
    mainWindow.on('resize', () => {
        if (!mainWindow) return
        const bounds = mainWindow.getContentBounds()
        tabs.forEach(t => {
            if (t.active) {
                t.view.setBounds({ x: 0, y: 88, width: bounds.width, height: bounds.height - 88 })
            }
        })
    })

    // Permission Handler
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false)
    })

    // IPC Handlers
    ipcMain.on('tab:create', (_, { id, url }) => {
        createTab(id, url)
    })

    ipcMain.on('tab:switch', (_, { id }) => {
        switchTab(id)
    })

    ipcMain.on('tab:close', (_, { id }) => {
        closeTab(id)
    })

    ipcMain.on('tab:update', (_, { id, url }) => {
        updateTabUrl(id, url)
    })

    // IPC for History Search
    ipcMain.handle('history:search', (_, query) => {
        return historyManager?.search(query) || []
    })

    ipcMain.handle('history:getContent', (_, url) => {
        // Find doc by URL in history
        const docs = Array.from((historyManager as any).docs.values())
        return docs.find((d: any) => d.url === url)
    })

    ipcMain.handle('search:suggestions', async (_, query) => {
        try {
            const response = await fetch(`https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`)
            if (!response.ok) return []
            const data: any = await response.json()
            if (Array.isArray(data) && data.length > 0) {
                return data.slice(0, 5).map((phrase: string) => ({
                    id: `search-ddg-${phrase}`,
                    title: phrase,
                    url: `https://duckduckgo.com/?q=${encodeURIComponent(phrase)}`,
                    type: 'search',
                    description: 'Search Request'
                }))
            }
            return []
        } catch (e) {
            return []
        }
    })

    ipcMain.handle('tab:getContent', async () => {
        if (!activeTabId) return null
        const tab = tabs.find(t => t.id === activeTabId)
        if (!tab || !tab.view) return null

        try {
            return await tab.view.webContents.executeJavaScript(`
                (function() {
                    const clone = document.body.cloneNode(true);
                    const scripts = clone.querySelectorAll('script, style, noscript, iframe, link, svg, path');
                    scripts.forEach(n => n.remove());
                    return {
                        title: document.title,
                        url: window.location.href,
                        content: clone.innerText.replace(/\\s+/g, ' ').trim().substring(0, 15000)
                    };
                })()
            `)
        } catch (e) {
            console.error('[PΛND0RΛ] Failed to extract tab content:', e)
            return null
        }
    })

    // IPC for Proxy
    ipcMain.on('proxy:set', async (_, config) => {
        const webTabsSession = getWebTabsSession()
        if (!config || config.type === 'none') {
            await webTabsSession.setProxy({ mode: 'direct' })
        } else {
            const proxyRules = `${config.type}://${config.host}:${config.port}`
            await webTabsSession.setProxy({
                proxyRules,
                proxyBypassRules: 'localhost,127.0.0.1,::1'
            })
        }
    })

    // IPC for Extensions
    ipcMain.handle('extension:load', async (_, path) => {
        try {
            const webTabsSession = getWebTabsSession()
            const ext = await webTabsSession.loadExtension(path)
            return { id: ext.id, name: ext.name }
        } catch (e: any) {
            console.error('[PΛND0RΛ] Failed to load extension:', e)
            throw new Error(e.message)
        }
    })

    ipcMain.handle('extension:list', () => {
        const webTabsSession = getWebTabsSession()
        return webTabsSession.getAllExtensions().map(e => ({
            id: e.id,
            name: e.name,
            version: e.version
        }))
    })

    // IPC for Reader Mode
    ipcMain.on('reader:toggle', async () => {

        if (!mainWindow || !activeTabId) return
        const tab = tabs.find(t => t.id === activeTabId)
        if (!tab || !tab.view) {
            console.error('[PΛND0RΛ] Reader Mode: Tab or view not found')
            return
        }

        const currentUrl = tab.view.webContents.getURL()


        if (currentUrl.startsWith('data:text/html')) {

            if (tab.view.webContents.canGoBack()) {
                tab.view.webContents.goBack()
            }
            return
        }

        if (currentUrl.includes('pandora://newtab')) {

            return
        }

        try {
            const html = await tab.view.webContents.executeJavaScript('document.documentElement.outerHTML')
            const { ReaderManager } = await import('./reader-mode.js')
            const readerHtml = ReaderManager.parse(html, currentUrl)

            if (readerHtml) {

                const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(readerHtml)}`
                tab.view.webContents.loadURL(dataUrl)
            } else {
                console.warn('[PΛND0RΛ] Reader Mode: Failed to parse article content')
            }
        } catch (e) {
            console.error('[PΛND0RΛ] Reader Mode Error:', e)
        }
    })

    // Tools IPC
    ipcMain.on('devtools:toggle', () => {
        if (!mainWindow || !activeTabId) return
        const tab = tabs.find(t => t.id === activeTabId)
        if (tab?.view) {
            if (tab.view.webContents.isDevToolsOpened()) {
                tab.view.webContents.closeDevTools()
            } else {
                tab.view.webContents.openDevTools({ mode: 'detach' })
            }
        }
    })

    ipcMain.handle('capture:page', async () => {
        if (!mainWindow || !activeTabId) return null
        const tab = tabs.find(t => t.id === activeTabId)
        if (!tab?.view) return null

        try {
            const image = await tab.view.webContents.capturePage()
            const date = new Date().toISOString().replace(/[:.]/g, '-')
            const filename = `screenshot-${date}.png`
            const savePath = path.join(app.getPath('downloads'), filename)
            fs.writeFileSync(savePath, image.toPNG() as any)

            // Open in shell to show user
            shell.showItemInFolder(savePath)

            return savePath
        } catch (e) {
            console.error('Screenshot failed:', e)
            return null
        }
    })

    // Native File Dialogs (Forensic Files & Dossiers)
    ipcMain.handle('dialog:openFile', async (_, options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => {
        if (!mainWindow) return null

        const defaultFilters = [
            { name: 'Forensic & Case Documents', extensions: ['pdf', 'csv', 'xlsx', 'txt', 'json'] },
            { name: 'Court PDF Documents', extensions: ['pdf'] },
            { name: 'Data Sheets (CSV, XLSX)', extensions: ['csv', 'xlsx'] },
            { name: 'All Files', extensions: ['*'] }
        ]

        const result = await dialog.showOpenDialog(mainWindow, {
            title: options?.title || 'Otvoriť spis / forenzný dokument (PΛND0RΛ)',
            properties: ['openFile'],
            filters: options?.filters || defaultFilters
        })

        if (result.canceled || result.filePaths.length === 0) {
            return null
        }

        const filePath = result.filePaths[0]
        const stats = await fs.promises.stat(filePath)

        return {
            path: filePath,
            name: path.basename(filePath),
            size: stats.size,
            extension: path.extname(filePath).toLowerCase().replace('.', '')
        }
    })

    ipcMain.handle('vault:select-evidence', async (event, payload: unknown) => {
        if (!mainWindow) return { ok: false, code: 'WINDOW_UNAVAILABLE' }
        const parsed = selectEvidenceRequestSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, code: 'VALIDATION_ERROR' }
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Zaistiť dôkaz do spisu',
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Forenzné dokumenty', extensions: ['pdf', 'csv', 'xlsx', 'docx', 'png', 'jpg', 'heic'] },
            ],
        })
        if (result.canceled) return { ok: true, files: [] }
        try {
            const files = await Promise.all(
                result.filePaths.map((filePath) =>
                    vaultTokens.register(filePath, parsed.data.caseId, event.sender.id),
                ),
            )
            return { ok: true, files }
        } catch {
            return { ok: false, code: 'FILE_REGISTRATION_FAILED' }
        }
    })

    ipcMain.handle('vault:read-chunk', async (event, payload: unknown) => {
        const parsed = readEvidenceChunkRequestSchema.safeParse(payload)
        if (!parsed.success) return { ok: false, code: 'VALIDATION_ERROR' }
        return vaultTokens.read(
            parsed.data.tokenId,
            event.sender.id,
            parsed.data.offset,
            parsed.data.length,
        )
    })

    ipcMain.handle('dialog:saveFile', async (_, options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
        if (!mainWindow) return null

        const result = await dialog.showSaveDialog(mainWindow, {
            title: options?.title || 'Uložiť export / forenznú správu (PΛND0RΛ)',
            defaultPath: options?.defaultPath || 'pandora-forensic-report.pdf',
            filters: options?.filters || [
                { name: 'PDF Documents', extensions: ['pdf'] },
                { name: 'JSON Dossier', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        })

        if (result.canceled || !result.filePath) {
            return null
        }

        return {
            path: result.filePath,
            name: path.basename(result.filePath)
        }
    })

    // Navigation IPC
    ipcMain.on('nav:back', () => {
        const tab = tabs.find(t => t.id === activeTabId)
        if (tab?.view?.webContents.canGoBack()) tab.view.webContents.goBack()
    })

    ipcMain.on('nav:forward', () => {
        const tab = tabs.find(t => t.id === activeTabId)
        if (tab?.view?.webContents.canGoForward()) tab.view.webContents.goForward()
    })

    ipcMain.on('nav:reload', () => {
        const tab = tabs.find(t => t.id === activeTabId)
        tab?.view?.webContents.reload()
    })

    // AI IPC Handlers
    ipcMain.on('ai:chat', async (event, { messages, apiKey, model }) => {
        const id = Date.now().toString()


        try {
            let aiModel;

            if (model === 'gemini-pro') {
                const google = createGoogleGenerativeAI({ apiKey })
                aiModel = google('gemini-1.5-pro-latest')
            } else {
                const openai = createOpenAI({ apiKey })
                aiModel = openai('gpt-4o')
            }

            const result = await streamText({
                model: aiModel,
                messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
                system: `Si PΛND0RΛ CORE v2.0 AI, vysoko inteligentný, kybernetický operačný systém integrovaný do bezpečnostného prehliadača PΛND0RΛ.
                Komunikuj výhradne v SLOVENČINE.
                Pravidlá odpovede:
                - Každú správu začni krátkym statusom v hranatých zátvorkách, napr. [CORE: ACTIVE], [ANALYZING...].
                - Používaj MARKDOWN.
                - Buď priamy a efektívny.`
            })

            const stream = result.textStream
            for await (const chunk of stream) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('ai:chunk', { chunk })
                }
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:done', {})
            }

        } catch (error: any) {
            console.error('[PΛND0RΛ] AI Error:', error)
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('ai:error', { message: error.message || 'Unknown AI Error' })
            }
        }
    })

    ipcMain.handle('ai:generate-image', async (_, { prompt, apiKey }) => {
        // Simple fetch for DALL-E 3 as @ai-sdk/openai doesn't support images yet or standard interface is different
        try {
            const response = await fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "dall-e-3",
                    prompt: prompt,
                    n: 1,
                    size: "1024x1024",
                    quality: "standard"
                })
            });

            if (!response.ok) {
                const err = await response.json()
                throw new Error(err.error?.message || 'Failed to generate image')
            }

            const data = await response.json()
            return data.data[0].url
        } catch (e: any) {
            console.error('[PΛND0RΛ] AI Image Error:', e)
            throw e
        }
    })

    // Download Handling on web tabs session
    const webTabsSession = getWebTabsSession()
    webTabsSession.on('will-download', (event, item, webContents) => {
        const id = Date.now().toString()
        const fileName = item.getFilename()
        const url = item.getURL()

        mainWindow?.webContents.send('download:start', {
            id,
            fileName,
            url,
            totalBytes: item.getTotalBytes(),
            startTime: Date.now()
        })

        item.on('updated', (_event: any, state: string) => {
            if (state === 'interrupted') {
                mainWindow?.webContents.send('download:updated', { id, status: 'failed' })
            } else if (state === 'progressing') {
                if (item.isPaused()) {
                    mainWindow?.webContents.send('download:updated', { id, status: 'paused' })
                } else {
                    mainWindow?.webContents.send('download:updated', {
                        id,
                        status: 'in-progress',
                        receivedBytes: item.getReceivedBytes(),
                        totalBytes: item.getTotalBytes()
                    })
                }
            }
        })

        item.on('done', (_event: any, state: string) => {
            if (state === 'completed') {
                mainWindow?.webContents.send('download:completed', { id, status: 'completed', path: item.getSavePath() })
            } else {
                mainWindow?.webContents.send('download:updated', { id, status: 'failed' })
            }
        })
    })
}

// BrowserView Management
function createTab(id: string, url: string) {
    if (!mainWindow) return

    if (url && url !== 'pandora://newtab') {
        if (!isValidWebTabUrl(url)) {
            console.warn('[PΛND0RΛ] Rejected tab creation with invalid URL protocol:', url)
            mainWindow.webContents.send('tab:updated', { id, title: 'Blocked Protocol', url, isLoading: false })
            return
        }
    }

    const view = createIsolatedBrowserView()

    mainWindow.setBrowserView(view)

    const bounds = mainWindow.getContentBounds()
    view.setBounds({ x: 0, y: 88, width: bounds.width, height: bounds.height - 88 })
    view.setAutoResize({ width: true, height: true })
    view.setBackgroundColor('#000000')

    if (url && url !== 'pandora://newtab') {
        view.webContents.loadURL(url)
    }

    view.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error(`[PΛND0RΛ] Failed to load: ${errorDescription} (${errorCode})`)
        mainWindow?.webContents.send('tab:updated', { id, title: 'Error', url: view.webContents.getURL(), isLoading: false })
    })

    view.webContents.on('did-finish-load', async () => {
        mainWindow?.webContents.send('tab:updated', { id, title: view.webContents.getTitle(), url: view.webContents.getURL() })

        // Second Brain Capture
        try {
            const pageContent = await view.webContents.executeJavaScript(`
                (function() {
                    const clone = document.body.cloneNode(true);
                    const scripts = clone.querySelectorAll('script, style, noscript');
                    scripts.forEach(n => n.remove());
                    return clone.innerText.replace(/\\s+/g, ' ').trim().substring(0, 10000);
                })()
            `)

            if (pageContent && pageContent.length > 50 && historyManager) {
                historyManager.addEntry({
                    url: view.webContents.getURL(),
                    title: view.webContents.getTitle(),
                    content: pageContent
                })
            }
        } catch (e) {
            // Ignore
        }
    })

    // Context Menu
    view.webContents.on('context-menu', (_, params) => {
        const menu = new Menu()
        if (params.linkURL) {
            menu.append(new MenuItem({ label: 'Open in New Tab', click: () => createTab(Date.now().toString(), params.linkURL) }))
            menu.append(new MenuItem({ type: 'separator' }))
        }
        menu.append(new MenuItem({ role: 'cut' }))
        menu.append(new MenuItem({ role: 'copy' }))
        menu.append(new MenuItem({ role: 'paste' }))
        menu.append(new MenuItem({ type: 'separator' }))
        menu.append(new MenuItem({ label: 'Inspect Element', click: () => view.webContents.inspectElement(params.x, params.y) }))
        menu.popup()
    })

    const tab: TabView = { id, view, active: true }
    tabs.push(tab)

    switchTab(id)
}

function switchTab(id: string) {
    if (!mainWindow) return

    tabs.forEach(t => {
        if (t.id !== id) {
            mainWindow?.removeBrowserView(t.view)
            t.active = false
        }
    })

    const tab = tabs.find(t => t.id === id)
    if (tab) {
        const currentUrl = tab.view.webContents.getURL()
        // For newtab and internal forensic modules, remove native BrowserView so React iframe renders seamlessly
        if (currentUrl === '' || currentUrl.includes('pandora://newtab') || currentUrl.includes('/forza/')) {
            mainWindow.removeBrowserView(tab.view)
        } else {
            mainWindow.setBrowserView(tab.view)
            const bounds = mainWindow.getContentBounds()
            tab.view.setBounds({ x: 0, y: 88, width: bounds.width, height: bounds.height - 88 })
        }
        tab.active = true
        activeTabId = id
    }
}

function closeTab(id: string) {
    const tabIndex = tabs.findIndex(t => t.id === id)
    if (tabIndex === -1) return

    const tab = tabs[tabIndex]
    if (mainWindow) {
        mainWindow.removeBrowserView(tab.view)
    }
    if (tab.view.webContents) {
        try {
            tab.view.webContents.close()
        } catch (e) {
            // Ignore if already closed
        }
    }

    tabs.splice(tabIndex, 1)

    if (id === activeTabId && tabs.length > 0) {
        const newActive = tabs[Math.max(0, tabIndex - 1)]
        switchTab(newActive.id)
    }
}

function updateTabUrl(id: string, url: string) {
    const tab = tabs.find(t => t.id === id)
    if (!tab) {
        createTab(id, url)
        return
    }

    // For newtab and internal forensic modules, remove native overlay so embedded UI renders
    if (url === 'pandora://newtab' || url.includes('/forza/')) {
        if (mainWindow) mainWindow.removeBrowserView(tab.view)
    } else {
        if (!isValidWebTabUrl(url)) {
            console.warn('[PΛND0RΛ] Rejected navigation to invalid URL protocol:', url)
            mainWindow?.webContents.send('tab:updated', { id, title: 'Blocked Protocol', url, isLoading: false })
            return
        }
        if (mainWindow && activeTabId === id) mainWindow.setBrowserView(tab.view)
        tab.view.webContents.loadURL(url)
    }
}

app.on('window-all-closed', () => {
    if (mainWindow) vaultTokens.revokeOwner(mainWindow.webContents.id)
    if (process.platform !== 'darwin') app.quit()
})

// Auto-Updater IPC
ipcMain.on('updater:check', () => {
    if (!app.isPackaged) {
        mainWindow?.webContents.send('updater:status', { status: 'error', message: 'Cannot check for updates in dev mode' })
        return
    }
    autoUpdater.checkForUpdates()
})

ipcMain.on('updater:install', () => {
    autoUpdater.quitAndInstall()
})

autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater:status', { status: 'checking' })
})

autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:status', { status: 'available', version: info.version })
})

autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater:status', { status: 'not-available' })
})

autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('updater:status', { status: 'error', message: err.message })
})

autoUpdater.on('download-progress', (progressObj) => {
    mainWindow?.webContents.send('updater:progress', progressObj)
})

autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('updater:status', { status: 'downloaded' })
})
