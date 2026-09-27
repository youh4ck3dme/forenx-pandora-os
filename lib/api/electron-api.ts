import type {
  DesktopEventChannel,
  DesktopInvokeChannel,
  DesktopSendChannel,
  PandoraDesktopApi,
} from "./desktop-api";

export class DesktopUnavailableError extends Error {
  constructor() {
    super("This feature is available only in the PANDORA desktop application.");
    this.name = "DesktopUnavailableError";
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.pandoraDesktop !== undefined;
}

function requireDesktop(): PandoraDesktopApi {
  if (!isElectron()) throw new DesktopUnavailableError();
  return window.pandoraDesktop!;
}

export const electron = {
  send(channel: DesktopSendChannel, payload?: unknown): void {
    requireDesktop().send(channel, payload);
  },
  on(channel: DesktopEventChannel, listener: (...args: never[]) => void): void {
    requireDesktop().on(channel, listener);
  },
  off(channel: DesktopEventChannel, listener: (...args: never[]) => void): void {
    requireDesktop().off(channel, listener);
  },
  invoke(channel: DesktopInvokeChannel, payload?: unknown): Promise<unknown> {
    return requireDesktop().invoke(channel, payload);
  },
};
