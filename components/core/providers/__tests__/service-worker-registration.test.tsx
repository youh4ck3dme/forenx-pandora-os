import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ServiceWorkerRegistration } from "../service-worker-registration";

function fakeCacheStorage(names: string[]) {
  const store = new Set(names);
  return {
    store,
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (name: string) => store.delete(name)),
  };
}

const original = {
  sw: Object.getOwnPropertyDescriptor(window.navigator, "serviceWorker"),
  caches: Object.getOwnPropertyDescriptor(window, "caches"),
};

afterEach(() => {
  if (original.sw) Object.defineProperty(window.navigator, "serviceWorker", original.sw);
  else delete (window.navigator as unknown as Record<string, unknown>).serviceWorker;
  if (original.caches) Object.defineProperty(window, "caches", original.caches);
  else delete (window as unknown as Record<string, unknown>).caches;
});

describe("ServiceWorkerRegistration", () => {
  it("odregistruje staré workery a zmaže všetky cache tohto originu", async () => {
    const unregister = vi.fn(async () => true);
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => [{ scope: "http://localhost/", unregister }]) },
    });
    const caches = fakeCacheStorage([
      "workbox-precache-v2-http://localhost/",
      "apis",
      "others",
      "static-js-assets",
    ]);
    Object.defineProperty(window, "caches", { configurable: true, value: caches });

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(caches.store.size).toBe(0));
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(caches.delete).toHaveBeenCalledTimes(4);
    expect(await caches.keys()).toEqual([]);
  });

  it("zmaže osirelé cache aj keď už nie je žiadna registrácia", async () => {
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistrations: vi.fn(async () => []) },
    });
    const caches = fakeCacheStorage(["apis", "others"]);
    Object.defineProperty(window, "caches", { configurable: true, value: caches });

    render(<ServiceWorkerRegistration />);

    await waitFor(() => expect(caches.store.size).toBe(0));
  });
});
