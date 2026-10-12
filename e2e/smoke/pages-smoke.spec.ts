/**
 * Page smoke: každá stránka sa načíta (status < 400 alebo očakávaný redirect na
 * /auth/login pre chránené stránky), bez nezachytených chýb stránky a
 * neočakávaných console errors, s <html lang="sk"> a titulkom/h1.
 * Na verejných stránkach beží axe (iba report, nezlyháva na existujúcich nálezoch).
 *
 * Vo všetkých režimoch auto fixture `netGuard` (guard-fixture.ts) na úrovni kontextu
 * abortuje každú nie-GET/HEAD/OPTIONS požiadavku na ľubovoľný origin (stránka aj
 * service worker), loguje všetky požiadavky a zlyhá, ak by zápis skutočne odišiel.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./guard-fixture";
import { BASE_URL, EXPECT_LANG, READONLY, REQUEST_DELAY_MS } from "./smoke-config";

type PageCase = {
  path: string;
  protected: boolean;
  /** Očakávaná finálna cesta pre verejné stránky, ktoré presmerúvajú (napr. /auth/ → /auth/login/). */
  finalPath?: string;
};

const FORZA = [
  "analyza-vypisov",
  "asistent",
  "import-csv",
  "mcp-info",
  "osoby",
  "pravny-kontext",
  "predplatne",
  "prehlad",
  "pripady",
  "profil",
  "sandbox",
  "siet",
  "stav",
  "sukromie",
  "viac",
  "vzhlad",
  "vztahy",
  "zbrane",
];

const PAGES: PageCase[] = [
  { path: "/", protected: true }, // neprihlásený → /auth/login/?next=/browser/
  { path: "/auth/", protected: false, finalPath: "/auth/login/" },
  { path: "/auth/login/", protected: false },
  { path: "/auth/register/", protected: false, finalPath: "/auth/login/" }, // → ?mode=signup
  { path: "/blog/", protected: false },
  // Slugy z lib/utils.ts (`@/lib/utils` sa resolvuje na súbor, nie na lib/utils/index.ts).
  { path: "/blog/bezpecnost-prehliadacov-a-izolacia/", protected: false },
  { path: "/browser/", protected: true },
  { path: "/forge/", protected: true },
  { path: "/forza/", protected: true },
  { path: "/offline/", protected: true },
  ...FORZA.map((p) => ({ path: `/forza/${p}/`, protected: true })),
];

/** Známe neškodné console chyby (reportujú sa ako anotácia, nezlyhávajú test). */
const BENIGN_CONSOLE: RegExp[] = [
  /Failed to load resource: the server responded with a status of 401/,
  /Download the React DevTools/,
  /\[HMR\]/,
  /net::ERR_FAILED/, // naše vlastné abortované zápisové požiadavky
  /Supabase configuration missing|Supabase client not configured|placeholder-publishable-key/i,
  // Lokálny beh s CI placeholder Supabase URL (https://supabase-ci.invalid) — DNS zlyhá zámerne.
  /ERR_NAME_NOT_RESOLVED|supabase-ci\.invalid/,
];

/** Zbiera console/page chyby; sieťovú poistku zabezpečuje auto fixture `netGuard`. */
async function guard(page: Page) {
  const consoleErrors: string[] = [];
  const benign: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    (BENIGN_CONSOLE.some((re) => re.test(text)) ? benign : consoleErrors).push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`.slice(0, 300)));
  return { consoleErrors, benign, pageErrors };
}

// Sekvenčne (workers: 1), ale nezávisle — jeden fail nezastaví ostatné.

test.describe(`Pages smoke (${READONLY ? "READ-ONLY" : "full"})`, () => {
  for (const pc of PAGES) {
    test(`page ${pc.path}`, async ({ page, netGuard }) => {
      if (REQUEST_DELAY_MS > 0) await page.waitForTimeout(REQUEST_DELAY_MS);
      const g = await guard(page);
      const response = await page.goto(pc.path, { waitUntil: "domcontentloaded" });
      // Krátko počkáme na hydratáciu a klientske chyby.
      await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1500);

      const finalUrl = new URL(page.url());
      const status = response?.status() ?? 0;
      const redirectedToLogin = finalUrl.pathname.startsWith("/auth/login");
      // lang overujeme v SSR HTML hlavného dokumentu (klientsky pád by DOM prepísal na error page).
      const html = (await response?.text().catch(() => "")) ?? "";
      const ssrLang = /<html[^>]*\blang="([^"]*)"/i.exec(html)?.[1] ?? null;
      const domLang = await page.locator("html").getAttribute("lang");
      const title = (await page.title()).trim();
      const h1Count = await page.locator("h1").count();
      const appError = await page
        .getByText(/Application error: a client-side exception/i)
        .count()
        .catch(() => 0);

      test.info().annotations.push({
        type: "result",
        description: `status=${status} final=${finalUrl.pathname}${finalUrl.search} ssrLang=${ssrLang} domLang=${domLang} title=${JSON.stringify(title.slice(0, 50))} h1=${h1Count}${appError ? " CLIENT-CRASH" : ""}`,
      });
      if (g.benign.length) test.info().annotations.push({ type: "benign-console", description: g.benign.join(" | ") });
      if (netGuard.blocked.length)
        test.info().annotations.push({ type: "blocked-writes", description: netGuard.blocked.join(", ") });
      if (g.pageErrors.length) test.info().annotations.push({ type: "page-errors", description: g.pageErrors.join(" | ") });
      if (g.consoleErrors.length)
        test.info().annotations.push({ type: "console-errors", description: g.consoleErrors.join(" | ") });

      expect.soft(status, "HTTP status finálnej stránky").toBeGreaterThan(0);
      expect.soft(status, "HTTP status finálnej stránky").toBeLessThan(400);
      if (pc.protected) {
        expect
          .soft(redirectedToLogin, `chránená stránka bez session má skončiť na /auth/login, je ${finalUrl.pathname}`)
          .toBe(true);
        // Bezpečný next parameter: iba interná cesta.
        const next = finalUrl.searchParams.get("next");
        if (next) expect.soft(next.startsWith("/") && !next.startsWith("//"), `next=${next}`).toBe(true);
      } else {
        const strip = (v: string) => v.replace(/\/+$/, "");
        expect.soft(strip(finalUrl.pathname)).toBe(strip(pc.finalPath ?? pc.path));
      }
      expect.soft(ssrLang, `<html lang="${EXPECT_LANG}"> v SSR HTML (SMOKE_EXPECT_LANG)`).toBe(EXPECT_LANG);
      expect.soft(title.length > 0 || h1Count > 0, "titulok alebo h1").toBe(true);
      expect.soft(appError, "klientsky pád (Next.js Application error)").toBe(0);
      expect.soft(g.pageErrors, "nezachytené chyby stránky").toEqual([]);
      expect.soft(g.consoleErrors, "neočakávané console errors").toEqual([]);
    });
  }

  // axe: meta-viewport, listitem/list a serious/critical color-contrast sú na týchto stránkach
  // regresie (opravené v ui/ux-safe-fixes); ostatné nálezy sa iba reportujú.
  const AXE_PAGES = ["/auth/login/", "/auth/register/", "/blog/", "/blog/bezpecnost-prehliadacov-a-izolacia/"];
  for (const path of AXE_PAGES) {
    test(`axe ${path}`, async ({ page }) => {
      if (REQUEST_DELAY_MS > 0) await page.waitForTimeout(REQUEST_DELAY_MS);
      await guard(page);
      await page.goto(path, { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const summary = results.violations.map((v) => `${v.impact ?? "?"}:${v.id}(${v.nodes.length})`).join(", ");
      test.info().annotations.push({ type: "axe", description: summary || "0 violations" });

      const regressions = results.violations.filter(
        (v) =>
          v.id === "meta-viewport" ||
          v.id === "listitem" ||
          v.id === "list" ||
          (v.id === "color-contrast" && (v.impact === "serious" || v.impact === "critical")),
      );
      const details = regressions.flatMap((v) =>
        v.nodes.map((n) => {
          const d = (n.any?.[0]?.data ?? {}) as Record<string, unknown>;
          return `${v.id} ${n.target.join(" ")} ${d.fgColor ?? ""}/${d.bgColor ?? ""} ${d.contrastRatio ?? ""}`.trim();
        }),
      );
      expect(details, "axe regresie (meta-viewport / listitem / serious color-contrast)").toEqual([]);
    });
  }

  // Prihlasovací formulár: medzery medzi poliami (regresia fieldset display:contents)
  // a stav vypnutia pri chýbajúcej Supabase konfigurácii.
  for (const width of [390, 1280]) {
    test(`login form layout @${width}px`, async ({ page }) => {
      if (REQUEST_DELAY_MS > 0) await page.waitForTimeout(REQUEST_DELAY_MS);
      await guard(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/auth/login/", { waitUntil: "load" });
      await page.waitForTimeout(1000);
      const m = await page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const email = r("#account-email");
        const password = r("#account-password");
        const submit = r('form button[type="submit"]');
        const controls = Array.from(document.querySelectorAll("form input, form button")) as HTMLElement[];
        return {
          gapEmailPassword: email && password ? password.top - email.bottom : null,
          gapPasswordSubmit: password && submit ? submit.top - password.bottom : null,
          notice: Boolean(document.querySelector('[data-testid="auth-config-missing"]')),
          disabled: controls.filter((c) => c.matches(":disabled")).length,
          total: controls.length,
        };
      });
      test.info().annotations.push({
        type: "result",
        description: `gaps=${m.gapEmailPassword}/${m.gapPasswordSubmit}px notice=${m.notice} disabled=${m.disabled}/${m.total}`,
      });
      expect.soft(m.gapEmailPassword ?? -1, "medzera e-mail → heslo").toBeGreaterThanOrEqual(8);
      expect.soft(m.gapPasswordSubmit ?? -1, "medzera heslo → tlačidlo").toBeGreaterThanOrEqual(8);
      // Bez konfigurácie musia byť vypnuté všetky prvky, s konfiguráciou žiadny.
      expect.soft(m.disabled, "vypnuté ovládacie prvky").toBe(m.notice ? m.total : 0);
    });
  }
});

// Dôkaz poistky: nie-bezpečné požiadavky zo stránky (cross-origin aj same-origin) sa
// abortujú pred odoslaním. Cross-origin cieľ je `.invalid` (RFC 2606) — nikdy neexistuje.
// Cross-origin POST s text/plain telom je „simple request" (bez CORS preflightu), takže
// sa dostane priamo k poistke; navyše cez navigator.sendBeacon (typický telemetrický kanál).
test.describe(`Network guard (${READONLY ? "READ-ONLY" : "full"})`, () => {
  // Sondy (vrátane testovacieho SW) bežia iba proti lokálnemu serveru, nikdy nie proti produkcii.
  test.skip(
    !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL),
    "sondy poistky iba lokálne (BASE_URL nie je localhost)",
  );

  test("cross-origin a same-origin zápis zo stránky je abortovaný", async ({ page, netGuard }) => {
    await page.goto("/auth/login/", { waitUntil: "domcontentloaded" });
    const results = await page.evaluate(async () => {
      const attempt = async (url: string, method: string) => {
        try {
          await fetch(url, { method, body: method === "DELETE" ? undefined : "{}" });
          return `${method} ${url}: SENT`;
        } catch {
          return `${method} ${url}: ABORTED`;
        }
      };
      return [
        await attempt("https://smoke-guard.invalid/write-probe", "POST"),
        navigator.sendBeacon("https://smoke-guard.invalid/beacon-probe", "{}") ? "beacon queued" : "beacon rejected",
        await attempt("/api/csp-report/", "POST"),
        await attempt("/api/auth/session/", "DELETE"),
      ];
    });
    test.info().annotations.push({ type: "probe", description: results.join(" | ") });
    await page.waitForTimeout(1000); // sendBeacon je asynchrónny
    expect(results.filter((r) => r.includes(": ")).every((r) => r.endsWith("ABORTED")), results.join(" | ")).toBe(true);
    expect(netGuard.blocked).toEqual(
      expect.arrayContaining([
        "POST https://smoke-guard.invalid/write-probe",
        "POST https://smoke-guard.invalid/beacon-probe",
        expect.stringMatching(/^POST https?:\/\/[^/]+\/api\/csp-report\/$/),
        expect.stringMatching(/^DELETE https?:\/\/[^/]+\/api\/auth\/session\/$/),
      ]),
    );
    expect(netGuard.sentUnsafe).toEqual([]);
  });

  // Service worker: testovací SW (servírovaný iba z route fixtúry, nie z app kódu) pošle
  // cross-origin POST; poistka na úrovni kontextu ho musí zachytiť ako [sw] požiadavku.
  test("zápis iniciovaný service workerom je abortovaný", async ({ page, context, netGuard }) => {
    const SW_PATH = "/__smoke-guard-sw-probe.js";
    const swSource = `
      self.addEventListener("install", () => self.skipWaiting());
      self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
      self.addEventListener("message", (e) => {
        e.waitUntil((async () => {
          let r;
          try { await fetch("https://smoke-guard.invalid/sw-write-probe", { method: "POST", body: "{}" }); r = "SENT"; }
          catch { r = "ABORTED"; }
          e.source.postMessage(r);
        })());
      });`;
    // Neskôr registrovaná route má prednosť; iné URL prepadnú do netGuard.
    await context.route(`**${SW_PATH}`, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 200, contentType: "text/javascript", body: swSource })
        : route.fallback(),
    );
    await page.goto("/auth/login/", { waitUntil: "load" });
    const result = await page.evaluate(async (path) => {
      const reg = await navigator.serviceWorker.register(path, { scope: "/" });
      const sw = reg.installing ?? reg.waiting ?? reg.active;
      if (!sw) return "NO-SW";
      if (sw.state !== "activated")
        await new Promise<void>((res) => sw.addEventListener("statechange", () => sw.state === "activated" && res()));
      const reply = new Promise<string>((res) =>
        navigator.serviceWorker.addEventListener("message", (e) => res(String(e.data)), { once: true }),
      );
      sw.postMessage("probe");
      const r = await Promise.race([reply, new Promise<string>((res) => setTimeout(() => res("TIMEOUT"), 10_000))]);
      await reg.unregister();
      return r;
    }, SW_PATH);
    test.info().annotations.push({ type: "sw-probe", description: `result=${result} blocked=${netGuard.blocked.join(", ")}` });
    expect(result).toBe("ABORTED");
    expect(netGuard.blocked).toContain("[sw] POST https://smoke-guard.invalid/sw-write-probe");
    expect(netGuard.sentUnsafe).toEqual([]);
  });
});
