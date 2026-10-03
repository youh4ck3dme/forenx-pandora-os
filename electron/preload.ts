import { contextBridge, ipcRenderer } from "electron";
import { z } from "zod";

const tabId = z.string().min(1).max(128);
const url = z.string().url().max(2048);
const aiMessage = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(20_000),
});

const sendSchemas = {
  "tab:create": z.object({ id: tabId, url }),
  "tab:switch": z.object({ id: tabId }),
  "tab:close": z.object({ id: tabId }),
  "tab:update": z.object({ id: tabId, url }),
  "reader:toggle": z.undefined(),
  "devtools:toggle": z.undefined(),
  "nav:back": z.object({ id: tabId }).optional(),
  "nav:forward": z.object({ id: tabId }).optional(),
  "nav:reload": z.object({ id: tabId, hard: z.boolean().optional() }).optional(),
  "nav:stop": z.object({ id: tabId }).optional(),
  "proxy:set": z.object({
    type: z.enum(["none", "http", "socks5"]),
    host: z.string().trim().max(253).optional(),
    port: z.union([z.string().regex(/^\d{1,5}$/), z.number().int().min(1).max(65535)]).optional(),
  }),
  "updater:check": z.undefined(),
  "ai:chat": z.object({
    messages: z.array(aiMessage).min(1).max(100),
    apiKey: z.string().min(1).max(512),
    model: z.enum(["gpt-4o", "gemini-pro"]),
  }),
} as const;

const invokeSchemas = {
  "system:open-external-safe": z.object({ url }),
  "vault:select-evidence": z.object({ caseId: z.string().uuid() }),
  "vault:read-chunk": z.object({
    tokenId: z.string().uuid(),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(10 * 1024 * 1024),
  }),
  "shield:toggle": z.boolean(),
  "shield:getLogs": z.undefined(),
  "search:suggestions": z.string().trim().min(1).max(256),
  "tab:getContent": z.undefined(),
  "history:getContent": url,
  "ai:generate-image": z.object({
    prompt: z.string().trim().min(1).max(4_000),
    apiKey: z.string().min(1).max(512),
  }),
  "session:clear-data": z.undefined(),
  "extension:list": z.undefined(),
  "extension:load": z.string().min(1).max(1024),
  "password:get": z.undefined(),
  "password:reveal": z.string().min(1).max(128),
  "password:save": z.object({
    url,
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(1_024),
  }),
  "password:delete": z.string().min(1).max(128),
} as const;

const eventChannels = new Set([
  "tab:updated",
  "download:start",
  "download:updated",
  "download:completed",
  "ai:chunk",
  "ai:done",
  "ai:error",
  "shield:blocked",
] as const);

type SendChannel = keyof typeof sendSchemas;
type InvokeChannel = keyof typeof invokeSchemas;
type EventChannel = typeof eventChannels extends Set<infer T> ? T : never;
type Listener = (...args: unknown[]) => void;
const listeners = new Map<Listener, (...args: unknown[]) => void>();

function parsePayload<T extends Record<string, z.ZodTypeAny>>(
  schemas: T,
  channel: keyof T,
  payload: unknown,
): unknown {
  const result = schemas[channel].safeParse(payload);
  if (!result.success) throw new Error(`Invalid IPC payload for ${String(channel)}`);
  return result.data;
}

const desktopApi = {
  send(channel: SendChannel, payload?: unknown): void {
    ipcRenderer.send(channel, parsePayload(sendSchemas, channel, payload));
  },
  invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown> {
    return ipcRenderer.invoke(channel, parsePayload(invokeSchemas, channel, payload));
  },
  on(channel: EventChannel, listener: Listener): void {
    if (!eventChannels.has(channel)) throw new Error(`Unsupported IPC event: ${channel}`);
    const wrapped = (_event: unknown, ...args: unknown[]) => listener(...args);
    listeners.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  off(channel: EventChannel, listener: Listener): void {
    const wrapped = listeners.get(listener);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(listener);
    }
  },
  openExternalSafely(urlToOpen: string): Promise<unknown> {
    return ipcRenderer.invoke("system:open-external-safe", parsePayload(invokeSchemas, "system:open-external-safe", { url: urlToOpen }));
  },
  selectEvidenceFiles(caseId: string): Promise<unknown> {
    return ipcRenderer.invoke("vault:select-evidence", parsePayload(invokeSchemas, "vault:select-evidence", { caseId }));
  },
  readEvidenceChunk(tokenId: string, offset: number, length: number): Promise<unknown> {
    return ipcRenderer.invoke("vault:read-chunk", parsePayload(invokeSchemas, "vault:read-chunk", { tokenId, offset, length }));
  },
};

contextBridge.exposeInMainWorld("pandoraDesktop", desktopApi);
