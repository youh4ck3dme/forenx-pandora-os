import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const BASE_URL =
  process.env.E2E_BASE_URL ??
  process.env.PLAYWRIGHT_TEST_BASE_URL ??
  process.env.BASE_URL ??
  'https://pandora.whoiswho.at';

export const AUTH_FILE = path.join(__dirname, 'tests/e2e/.auth/user.json');

export default defineConfig({
  timeout: 120 * 1000,
  expect: {
    timeout: 10 * 1000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.05, animations: 'disabled' },
  },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    navigationTimeout: 45 * 1000,
  },
  outputDir: 'test-results/',

  projects: [
    // ── Legacy e2e suite (existing routing/auth specs) ────────────────────────
    {
      name: 'chromium',
      testDir: './e2e',
      use: { ...devices['Desktop Chrome'] },
    },

    // ── New tests/e2e suite: unauthenticated ──────────────────────────────────
    {
      name: 'forensic-unauth',
      testDir: './tests/e2e',
      testIgnore: [/\.auth\.spec\.ts/, /global-setup\.ts/, /auth-file\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },

    // ── New tests/e2e suite: global auth setup ────────────────────────────────
    {
      name: 'forensic-setup',
      testDir: './tests/e2e',
      testMatch: /global-setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // ── New tests/e2e suite: authenticated flows ──────────────────────────────
    {
      name: 'forensic-auth',
      testDir: './tests/e2e',
      testMatch: /\.auth\.spec\.ts/,
      dependencies: ['forensic-setup'],
      use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE },
    },
  ],

  webServer: BASE_URL.startsWith('http://localhost')
    ? {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
      }
    : undefined,
});
