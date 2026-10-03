import { BrowserView, session, type Session } from "electron";

export const WEB_TABS_PARTITION = "persist:pandora-web-tabs";

export function getWebTabsSession(): Session {
  return session.fromPartition(WEB_TABS_PARTITION);
}

export function configureWebTabsSession(): Session {
  const webTabsSession = getWebTabsSession();
  webTabsSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  return webTabsSession;
}

export function isValidWebTabUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function createIsolatedBrowserView(): BrowserView {
  const view = new BrowserView({
    webPreferences: {
      partition: WEB_TABS_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: undefined,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });
  view.webContents.on("will-navigate", (event, navigationUrl) => {
    if (!isValidWebTabUrl(navigationUrl)) {
      event.preventDefault();
    }
  });
  view.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return view;
}
