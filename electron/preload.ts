import { contextBridge, ipcRenderer } from 'electron'

const forenxDesktop = {
    openExternalSafely: async (url: string) => {
        return ipcRenderer.invoke('system:open-external-safe', { url })
    },
    selectEvidenceFiles: async (caseId: string) => {
        return ipcRenderer.invoke('vault:select-evidence', { caseId })
    },
    readEvidenceChunk: async (tokenId: string, offset: number, length: number) => {
        return ipcRenderer.invoke('vault:read-chunk', { tokenId, offset, length })
    },
}

contextBridge.exposeInMainWorld('forenxDesktop', forenxDesktop)

contextBridge.exposeInMainWorld('electron', {
    send: (channel: string, data: any) => {
        const validChannels = [
            'tab:create', 'tab:switch', 'tab:close', 'tab:update',
            'reader:toggle', 'devtools:toggle', 'capture:page',
            'nav:back', 'nav:forward', 'nav:reload',
            'ai:chat'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.send(channel, data)
        }
    },
    on: (channel: string, func: (...args: any[]) => void) => {
        const validChannels = [
            'tab:updated',
            'download:start', 'download:updated', 'download:completed',
            'ai:chunk', 'ai:done', 'ai:error',
            'shield:blocked'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.on(channel, (_, ...args) => func(...args))
        }
    },
    once: (channel: string, func: (...args: any[]) => void) => {
        const validChannels = [
            'ai:done'
        ]
        if (validChannels.includes(channel)) {
            ipcRenderer.once(channel, (_, ...args) => func(...args))
        }
    },
    off: (channel: string, func: (...args: any[]) => void) => {
        // We can allow off for any channel that is in 'on'
        const validChannels = [
            'tab:updated',
            'download:start', 'download:updated', 'download:completed',
            'ai:chunk', 'ai:done', 'ai:error',
            'shield:blocked'
        ]
        if (validChannels.includes(channel)) {
            // Electron's removeListener requires the exact same function reference
            // This is tricky with contextBridge as functions are wrapped.
            // For simple use cases (removing all listeners), removeAllListeners might be safer if exposed carefully,
            // or we just acknowledge this limitation.
            // However, ipcRenderer.removeAllListeners(channel) is often what we want in React useEffect cleanup.
            ipcRenderer.removeAllListeners(channel)
        }
    },
    invoke: (channel: string, ...args: any[]) => {
        const validChannels = [
            'history:search', 'history:getContent', 'tab:getContent',
            'password:save', 'password:get', 'password:delete',
            'ai:generate-image', 'capture:page', 'search:suggestions',
            'shield:getStats', 'shield:getLogs', 'shield:toggle',
            'dialog:openFile', 'dialog:saveFile', 'vault:upload'
        ]
        if (validChannels.includes(channel)) {
            return ipcRenderer.invoke(channel, ...args)
        }
    }
})
