// @vitest-environment node — NOT vitest; this is a Playwright spec
import { test, expect } from '@playwright/test';

test.describe('PANDORA / ForenX — Unauthenticated flows', () => {

  test('Flow 1: Auth gate redirects unauthenticated user to login with return target', async ({ page }) => {
    await page.goto('/forza/prehlad');
    await page.waitForURL((url) => url.pathname.includes('/auth/login'), { timeout: 8000 });

    const currentUrl = new URL(page.url());
    expect(currentUrl.pathname).toContain('/auth/login');
    expect(currentUrl.searchParams.get('next')).toContain('/forza/prehlad');
  });

  test('Flow 2: Login page renders email, password, submit button with 0 JS errors', async ({ page }) => {
    const jsErrors: string[] = [];
    page.on('pageerror', (err) => jsErrors.push(err.message));

    await page.goto('/auth/login/');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.getByRole('textbox', { name: /email/i }).or(page.locator('input[type="email"]'));
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.getByRole('button', { name: /prihlásiť|sign in|login/i });

    await expect(emailInput.first()).toBeVisible();
    await expect(passwordInput.first()).toBeVisible();
    await expect(submitBtn.first()).toBeVisible();
    expect(jsErrors, `JS exceptions: ${jsErrors.join(', ')}`).toHaveLength(0);
  });

  test('Flow 6: CSP header — nonce present, strictly enforced, no unsafe-inline in script-src', async ({ request, baseURL }) => {
    const response = await request.get(baseURL + '/');
    const headers = response.headers();

    const csp = headers['content-security-policy'];
    expect(csp, 'Content-Security-Policy header must be present').toBeDefined();
    expect(
      headers['content-security-policy-report-only'],
      'CSP must be strictly enforced (not Report-Only)',
    ).toBeUndefined();

    expect(csp).toMatch(/script-src[^;]*'nonce-[A-Za-z0-9_-]+'/);

    const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/);
    expect(scriptSrcMatch).toBeTruthy();
    expect(scriptSrcMatch![1]).not.toContain("'unsafe-inline'");
  });

  test('Flow 7: Health endpoint returns 200 and healthy JSON status', async ({ request, baseURL }) => {
    const response = await request.get(baseURL + '/api/healthz');
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(['ok', 'healthy', 'pass']).toContain(String(data.status).toLowerCase());
  });
});
