/*
 * PΛND0RΛ / ForenX — Service Worker KILL-SWITCH
 *
 * Aplikácia service worker zámerne NEPOUŽÍVA (pozri
 * components/core/providers/service-worker-registration.tsx, ktorý všetky
 * registrácie odregistruje). Tento súbor nahrádza starý vygenerovaný
 * next-pwa/Workbox worker, ktorý cachoval same-origin `/api/*` GET odpovede,
 * HTML/RSC stránky prípadov aj cross-origin (Supabase REST) odpovede a pri
 * výpadku siete ich vracal zo stale cache.
 *
 * Citlivé forenzné dáta (stav workflow, audit log, overenie dôkazov, forenzné
 * prípady, ledger, autentifikácia, oprávnenia) sa NIKDY nesmú doručovať zo
 * service-worker cache — zastaraný stav overenia alebo oprávnení je forenzne
 * nepravdivý (INV-004, INV-013). Preto:
 *   - žiadny `fetch` handler (všetky požiadavky idú priamo na sieť),
 *   - pri aktivácii sa zmažú všetky Cache Storage cache,
 *   - worker sa sám odregistruje.
 *
 * Prehliadač pri kontrole aktualizácie starého workera stiahne tento súbor,
 * nainštaluje ho a tým starý Workbox worker aj jeho cache odstráni.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await self.caches.keys();
        await Promise.all(keys.map((key) => self.caches.delete(key)));
      } finally {
        await self.clients.claim();
        await self.registration.unregister();
      }
    })(),
  );
});
