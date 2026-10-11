/**
 * Page smoke: každá stránka sa načíta (status < 400 alebo očakávaný redirect na
 * /auth/login pre chránené stránky), bez nezachytených chýb stránky a
 * neočakávaných console errors, s <html lang="sk"> a titulkom/h1.
 * Na verejných stránkach beží axe (iba report, nezlyháva na existujúcich nálezoch).
 *
 * Vo všetkých režimoch sa v prehliadači abortuje každá nie-GET/HEAD/OPTIONS
 * požiadavka na cieľový origin (CSP reporty, telemetria …) → žiadne zápisy.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BASE_URL, READONLY, REQUEST_DELAY_MS, SAFE_METHODS } from "./smoke-config";

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

async function guard(page: Page) {
  const consoleErrors: string[] = [];
  const benign: string[] = [];
  const pageErrors: string[] = [];
  const blockedWrites: string[] = [];
  const origin = new URL(BASE_URL).origin;

  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!SAFE_METHODS.has(req.method()) && new URL(req.url()).origin === origin) {
      blockedWrites.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    (BENIGN_CONSOLE.some((re) => re.test(text)) ? benign : consoleErrors).push(text.slice(0, 300));
  });
  page.on("pageerror", (err) => pageErrors.push(`${err.name}: ${err.message}`.slice(0, 300)));
  return { consoleErrors, benign, pageErrors, blockedWrites };
}

// Sekvenčne (workers: 1), ale nezávisle — jeden fail nezastaví ostatné.

test.describe(`Pages smoke (${READONLY ? "READ-ONLY" : "full"})`, () => {
  for (const pc of PAGES) {
    test(`page ${pc.path}`, async ({ page }) => {
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
      if (g.blockedWrites.length)
        test.info().annotations.push({ type: "blocked-writes", description: g.blockedWrites.join(", ") });
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
      expect.soft(ssrLang, '<html lang="sk"> v SSR HTML').toBe("sk");
      expect.soft(title.length > 0 || h1Count > 0, "titulok alebo h1").toBe(true);
      expect.soft(appError, "klientsky pád (Next.js Application error)").toBe(0);
      expect.soft(g.pageErrors, "nezachytené chyby stránky").toEqual([]);
      expect.soft(g.consoleErrors, "neočakávané console errors").toEqual([]);
    });
  }

  for (const path of ["/auth/login/", "/auth/register/", "/blog/"]) {
    test(`axe report ${path}`, async ({ page }) => {
      if (REQUEST_DELAY_MS > 0) await page.waitForTimeout(REQUEST_DELAY_MS);
      await guard(page);
      await page.goto(path, { waitUntil: "load" });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const summary = results.violations.map((v) => `${v.impact ?? "?"}:${v.id}(${v.nodes.length})`).join(", ");
      test.info().annotations.push({ type: "axe", description: summary || "0 violations" });
      // Iba report — existujúce nálezy nezlyhávajú smoke beh.
      expect(results).toBeTruthy();
    });
  }
});
