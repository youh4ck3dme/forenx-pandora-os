export type DesktopSendChannel =
  | "tab:create"
  | "tab:switch"
  | "tab:close"
  | "tab:update"
  | "reader:toggle"
  | "devtools:toggle"
  | "nav:back"
  | "nav:forward"
  | "nav:reload"
  | "nav:stop"
  | "proxy:set"
  | "updater:check"
  | "ai:chat";

export type DesktopInvokeChannel =
  | "system:open-external-safe"
  | "vault:select-evidence"
  | "vault:read-chunk"
  | "shield:toggle"
  | "shield:getLogs"
  | "search:suggestions"
  | "tab:getContent"
  | "history:getContent"
  | "ai:generate-image"
  | "session:clear-data"
  | "extension:list"
  | "extension:load"
  | "password:get"
  | "password:save"
  | "password:delete";

export type DesktopEventChannel =
  | "tab:updated"
  | "download:start"
  | "download:updated"
  | "download:completed"
  | "ai:chunk"
  | "ai:done"
  | "ai:error"
  | "shield:blocked";

export interface PandoraDesktopApi {
  send(channel: DesktopSendChannel, payload?: unknown): void;
  invoke(channel: DesktopInvokeChannel, payload?: unknown): Promise<unknown>;
  on(channel: DesktopEventChannel, listener: (...args: never[]) => void): void;
  off(channel: DesktopEventChannel, listener: (...args: never[]) => void): void;
  openExternalSafely(url: string): Promise<unknown>;
  selectEvidenceFiles(caseId: string): Promise<unknown>;
  readEvidenceChunk(tokenId: string, offset: number, length: number): Promise<unknown>;
}

declare global {
  interface Window {
    pandoraDesktop?: PandoraDesktopApi;
  }
}

export {};
