import { BrowserView, session } from "electron";

export const WEB_TABS_PARTITION = "persist:pandora-web-tabs";

export function configureWebTabsSession(): void {
  const webTabsSession = session.fromPartition(WEB_TABS_PARTITION);
  webTabsSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
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
    try {
      const protocol = new URL(navigationUrl).protocol;
      if (protocol !== "https:" && protocol !== "http:") event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  view.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return view;
}
