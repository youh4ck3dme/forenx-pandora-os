import { vi } from "vitest";

function getBlobBuffer(blob: any): Buffer | null {
  if (blob && Buffer.isBuffer(blob._buffer)) return blob._buffer;
  if (!blob) return null;
  const symbols = Object.getOwnPropertySymbols(blob);
  for (const sym of symbols) {
    const impl = blob[sym];
    if (impl && Buffer.isBuffer(impl._buffer)) {
      return impl._buffer;
    }
  }
  return null;
}

// Polyfill File and Blob .text() and .arrayBuffer() in jsdom
if (typeof Blob !== "undefined") {
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function () {
      const buf = getBlobBuffer(this);
      if (buf) {
        const ab = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer;
        return Promise.resolve(ab);
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }
  if (!Blob.prototype.text) {
    Blob.prototype.text = function () {
      const buf = getBlobBuffer(this);
      if (buf) {
        return Promise.resolve(buf.toString("utf-8"));
      }
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string) || "");
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }
}
if (typeof File !== "undefined") {
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = Blob.prototype.arrayBuffer;
  }
  if (!File.prototype.text) {
    File.prototype.text = Blob.prototype.text;
  }
}

// Mock LocalStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    length: 0,
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
  };
})();

// Node-environment suites (e.g. supabase/tests) have no window.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });

  // Mock matchMedia (often missing in JSDOM)
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// Global Aliases for common mocks
vi.mock("@/lib/api", () => ({
  electron: {
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn(),
  },
  isElectron: () => true,
}));

vi.mock("@/lib/config", () => ({
  config: {
    browser: {
      maxTabs: 10,
      defaultSearchEngine: "https://google.com/search?q=",
      maxHistoryItems: 1000,
      maxBookmarks: 1000,
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
  },
}));
