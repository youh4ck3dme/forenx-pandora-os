/**
 * Sieťová poistka pre stránkové smoke testy (auto fixture na úrovni BrowserContext).
 *
 * - `context.route` (vzor: všetky URL) zachytí každú požiadavku stránky aj service workera (Chromium)
 *   a abortuje KAŽDÚ metódu mimo GET/HEAD/OPTIONS na ĽUBOVOĽNOM origine (cieľ, Supabase,
 *   telemetria …) ešte pred odoslaním.
 * - Každá požiadavka (metóda + URL + výsledok) sa loguje do prílohy testu
 *   `network-log` a do súboru `test-results/smoke-requests-<mode>.log`.
 * - Test zlyhá, ak by nie-bezpečná požiadavka skutočne odišla (dostala odpoveď)
 *   alebo ak ju poistka nezachytila.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { READONLY, SAFE_METHODS } from "./smoke-config";

export type NetGuard = {
  /** Všetky požiadavky: "METHOD URL -> výsledok". */
  log: string[];
  /** Nie-bezpečné požiadavky abortované poistkou. */
  blocked: string[];
  /** Nie-bezpečné požiadavky, ktoré dostali odpoveď (musí byť 0). */
  sentUnsafe: string[];
  /** Nie-bezpečné požiadavky pozorované mimo route (musí byť 0). */
  unroutedUnsafe: string[];
};

/**
 * URL do logu: iba origin + cesta; hodnoty query parametrov sa redigujú (tokeny, kľúče).
 * Hlavičky (cookie, authorization, apikey …) sa nelogujú vôbec.
 */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const keys = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${keys.length ? "?" + keys.map((k) => `${k}=<redacted>`).join("&") : ""}`;
  } catch {
    return "<unparseable-url>";
  }
}

const MODE = READONLY ? "readonly" : "full";
const RUN_LOG = `test-results/smoke-requests-${MODE}.log`;

export const test = base.extend<{ netGuard: NetGuard }>({
  netGuard: [
    async ({ context }, use, testInfo) => {
      const g: NetGuard = { log: [], blocked: [], sentUnsafe: [], unroutedUnsafe: [] };
      const routed = new WeakSet<object>();

      await context.route("**/*", async (route) => {
        const req = route.request();
        routed.add(req);
        const method = req.method().toUpperCase();
        const src = req.serviceWorker() ? "[sw] " : "";
        if (!SAFE_METHODS.has(method)) {
          g.blocked.push(`${src}${method} ${redactUrl(req.url())}`);
          g.log.push(`${src}${method} ${redactUrl(req.url())} -> BLOCKED`);
          return route.abort("blockedbyclient");
        }
        g.log.push(`${src}${method} ${redactUrl(req.url())} -> continue`);
        return route.continue();
      });
      context.on("request", (req) => {
        const method = req.method().toUpperCase();
        // data:/blob: a pod. route nezachytí; nie-bezpečná požiadavka mimo route je chyba.
        if (!SAFE_METHODS.has(method) && !routed.has(req) && /^https?:/i.test(req.url())) {
          // route handler beží asynchrónne — overíme po krátkej chvíli
          setTimeout(() => {
            if (!routed.has(req)) g.unroutedUnsafe.push(`${method} ${redactUrl(req.url())}`);
          }, 500);
        }
      });
      context.on("response", (res) => {
        const method = res.request().method().toUpperCase();
        if (!SAFE_METHODS.has(method)) g.sentUnsafe.push(`${method} ${redactUrl(res.url())} (${res.status()})`);
      });

      await use(g);
      await new Promise((r) => setTimeout(r, 600));

      const header = `# ${testInfo.titlePath.join(" › ")} | requests=${g.log.length} blocked=${g.blocked.length} sentUnsafe=${g.sentUnsafe.length} unroutedUnsafe=${g.unroutedUnsafe.length}`;
      const body = [header, ...g.log, ...g.sentUnsafe.map((s) => `SENT-UNSAFE ${s}`), ""].join("\n");
      await testInfo.attach("network-log", { body, contentType: "text/plain" });
      mkdirSync("test-results", { recursive: true });
      appendFileSync(RUN_LOG, body + "\n");
      testInfo.annotations.push({
        type: "net-guard",
        description: `requests=${g.log.length} blocked=${g.blocked.length} sentUnsafe=${g.sentUnsafe.length}`,
      });

      expect(g.sentUnsafe, "nie-GET/HEAD/OPTIONS požiadavka skutočne odišla").toEqual([]);
      expect(g.unroutedUnsafe, "nie-bezpečná požiadavka obišla poistku").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };