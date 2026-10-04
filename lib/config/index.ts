/**
 * Global application configuration for PΛND0RΛ Browser.
 */
export const config = {
  app: {
    name: "PΛND0RΛ Browser",
    version: "2.0.0",
    author: "PΛND0RΛ Team",
  },
  browser: {
    maxTabs: 20,
    maxHistoryItems: 1000,
    maxBookmarks: 1000,
    defaultSearchEngine: "https://www.google.com/search?q=",
    defaultHomePage: "pandora://newtab",
  },
  storage: {
    keys: {
      tabs: "pandora_tabs",
      closedTabs: "pandora_closed_tabs",
      bookmarks: "pandora_bookmarks",
      history: "pandora_history",
      settings: "pandora_settings",
      downloads: "pandora_downloads",
    },
  },
}
