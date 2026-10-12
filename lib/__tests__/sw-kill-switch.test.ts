/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SW_SOURCE = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
/** Spustiteľný kód bez komentárov (komentár Workbox iba vysvetľuje históriu). */
const SW_CODE = SW_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function loadWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const deleted: string[] = [];
  const self = {
    addEventListener: vi.fn((type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    }),
    skipWaiting: vi.fn(),
    caches: {
      keys: vi.fn(async () => ["apis", "others", "cross-origin", "start-url"]),
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
        return true;
      }),
    },
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => true) },
  };
  vm.runInNewContext(SW_SOURCE, { self });
  return { self, listeners, deleted };
}

describe("public/sw.js kill-switch", () => {
  it("neregistruje fetch handler (žiadna odpoveď zo SW cache)", () => {
    const { listeners } = loadWorker();
    expect(listeners.has("fetch")).toBe(false);
    expect([...listeners.keys()].sort()).toEqual(["activate", "install"]);
  });

  it("neobsahuje Workbox ani cache stratégie", () => {
    expect(SW_CODE).not.toMatch(/importScripts|workbox|registerRoute|precache|respondWith/i);
    expect(SW_CODE).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    // Vysvetľujúci komentár o citlivých forenzných dátach musí ostať.
    expect(SW_SOURCE).toMatch(/NIKDY nesmú doručovať zo\s+\* service-worker cache/);
  });

  it("pri inštalácii preskočí čakanie", () => {
    const { self, listeners } = loadWorker();
    listeners.get("install")?.({});
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("pri aktivácii zmaže všetky cache, prevezme klientov a odregistruje sa", async () => {
    const { self, listeners, deleted } = loadWorker();
    let pending: Promise<unknown> | undefined;
    listeners.get("activate")?.({ waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
    expect(deleted.sort()).toEqual(["apis", "cross-origin", "others", "start-url"]);
    expect(self.clients.claim).toHaveBeenCalledTimes(1);
    expect(self.registration.unregister).toHaveBeenCalledTimes(1);
  });
});
