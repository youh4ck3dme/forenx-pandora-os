export function isElectron() {
    return typeof window !== 'undefined' && window.electron !== undefined
}

export const electron = {
    send: (channel: string, data: any) => {
        if (isElectron()) {
            window.electron.send(channel, data)
        } else {
            console.log(`[PANDORA] Electron IPC Mock: ${channel}`, data)
        }
    },
    on: (channel: string, func: (...args: any[]) => void) => {
        if (isElectron()) {
            window.electron.on(channel, func)
        }
    },
    invoke: async (channel: string, ...args: any[]) => {
        if (isElectron()) {
            return await window.electron.invoke(channel, ...args)
        }
        return null
    }
}

// Type declaration for window.electron
declare global {
    interface Window {
        electron: {
            send: (channel: string, data: any) => void
            on: (channel: string, func: (...args: any[]) => void) => void
            invoke: (channel: string, ...args: any[]) => Promise<any>
        }
    }
}
