import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke testy pre všetky API route a stránky.
 *   npm run test:smoke        → http://localhost:3007 (lokálny `next start -p 3007`)
 *   npm run test:smoke:prod   → https://pandora.whoiswho.at, SMOKE_READONLY=1
 */
const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3007").replace(/\/+$/, "");
const isLocal = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL);
const mode = process.env.SMOKE_READONLY === "1" ? "readonly" : "full";

export default defineConfig({
  testDir: "./e2e/smoke",
  testMatch: /.*-smoke\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["json", { outputFile: `test-results/smoke-${mode}.json` }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 45_000,
    extraHTTPHeaders: { "user-agent": "pandora-smoke/1.0 (read-only check)" },
  },
  outputDir: `test-results/smoke-${mode}`,
  projects: [{ name: "smoke", use: { ...devices["Desktop Chrome"] } }],
  // Lokálne sa server spustí (alebo znovupoužije) na porte 3007, nikdy nie 3000.
  webServer: isLocal
    ? {
        command: "npx next start -p 3007",
        url: `${BASE_URL}/api/healthz/`,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : undefined,
});
