import { test, expect } from '@playwright/test';
import { attachGuards } from './helpers/guard';

test.describe('Routing Integrity & Access Control Suite', () => {

  test('Public routes load cleanly without 404/500 errors', async ({ page }) => {
    // Only test auth routes that are guaranteed to exist on every deployment.
    // The root "/" may render a complex component that differs by environment.
    const publicRoutes = ['/auth', '/auth/login', '/auth/register'];

    for (const route of publicRoutes) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `Response for ${route} should exist`).not.toBeNull();
      const status = response?.status() ?? 0;
      expect(status, `Route ${route} returned error status ${status}`).toBeLessThan(400);

      const content = await page.content();
      expect(content).not.toContain('Internal Server Error');
      const heading404 = page.getByRole('heading', { name: /404|Page not found/i });
      await expect(heading404).not.toBeVisible();
    }
  });

  test('Root route / responds without 5xx errors', async ({ request }) => {
    // Test via HTTP request (avoids JS-rendering issues) — just verify HTTP layer is healthy
    const res = await request.get('/');
    // Allow 200 (content), 3xx (redirect to auth), or 404 (no root page configured)
    // but NEVER 5xx (server error)
    expect(res.status(), 'Root route must not return a 5xx error').toBeLessThan(500);
  });

  test('Protected page routes redirect unauthenticated users without 404/500', async ({ page }) => {
    test.setTimeout(120_000);
    const guard = attachGuards(page);

    const protectedRoutes = [
      '/prehlad',
      '/asistent',
      '/vztahy',
      '/forza',
      '/forza/prehlad',
      '/forza/pripady',
      '/forza/asistent',
      '/forza/vztahy',
      '/forza/siet',
      '/forza/sandbox',
      '/forza/stav',
      '/workspace',
      '/cases',
      '/export',
      '/profile',
      '/settings',
    ];

    for (const route of protectedRoutes) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response, `Response for ${route} must exist`).not.toBeNull();

      const status = response?.status() ?? 0;
      expect(status, `Route ${route} returned unexpected 5xx error`).toBeLessThan(500);
      expect(status, `Route ${route} returned 404`).not.toBe(404);

      // Must land on auth page after redirect
      const currentUrl = page.url();
      expect(currentUrl, `Route ${route} must redirect unauthenticated users to auth`).toContain('/auth');

      // No protected content leaked
      const pageText = await page.innerText('body');
      expect(pageText).not.toContain('Forenzný Autopilot');
      expect(pageText).not.toContain('Zoznam spisov');
    }

    guard.assertClean();
  });

  test('Protected API endpoints return 401 JSON and never redirect to HTML login', async ({ request }) => {
    // Use trailing slash since next.config has trailingSlash:true.
    // Without it, the CDN/server issues a 308 before middleware can return 401.
    const apiEndpoints = [
      '/api/vault/',
      '/api/vault/presign/',
      '/api/vault/commit/',
      '/api/audit/access/',
      '/api/health/observe/',
      '/api/fn/execute/',
    ];

    for (const endpoint of apiEndpoints) {
      // Follow the trailing-slash 308 redirect automatically, then assert final 401
      const res = await request.get(endpoint);

      expect(res.status(), `API endpoint ${endpoint} must return 401`).toBe(401);

      const contentType = res.headers()['content-type'] || '';
      expect(contentType, `API endpoint ${endpoint} must return JSON`).toContain('application/json');

      // Final URL must not be an HTML auth page
      expect(res.url(), `API endpoint ${endpoint} must not redirect to HTML auth`).not.toContain('/auth');

      const json = await res.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toContain('Unauthorized');
    }
  });

  test('Public and System health APIs respond correctly without requiring auth', async ({ request }) => {
    const healthRes = await request.get('/api/healthz/');
    expect(healthRes.status(), 'API health check should be accessible').toBeLessThan(400);

    const json = await healthRes.json();
    // Accept either `status` (after deploy) or `ok` (current live) — both indicate healthy
    const isHealthy = ('status' in json) || ('ok' in json && json.ok === true);
    expect(isHealthy, 'Healthz response must contain either status or ok field').toBe(true);
  });

  test('Safe next= redirect parameter rejects open redirect attacks', async ({ page }) => {
    const guard = attachGuards(page);
    const attackVectors = [
      'https://evil.example.com',
      'http://attacker.org',
      '//malicious.site/phish',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/auth/login%2Fevil',
      '/forza/../admin',
      '/forza//pripady',
    ];

    for (const vector of attackVectors) {
      await page.goto(`/auth/login?next=${encodeURIComponent(vector)}`, {
        waitUntil: 'domcontentloaded',
      });

      const parsedUrl = new URL(page.url());
      expect(parsedUrl.hostname, `Open redirect exploit succeeded for ${vector}`).not.toBe('evil.example.com');
      expect(parsedUrl.hostname).not.toBe('attacker.org');
      expect(parsedUrl.hostname).not.toBe('malicious.site');
      expect(parsedUrl.protocol).toMatch(/^https?:$/);
    }

    guard.assertClean();
  });

  test('Browser back and forward navigation preserves integrity without errors', async ({ page }) => {
    const guard = attachGuards(page);

    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    expect(page.url()).toContain('/auth/login');

    const registerLink = page.getByRole('link', { name: /Registrovať sa|Nemáte účet/i }).first();
    if (await registerLink.isVisible()) {
      await registerLink.click();
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/auth/register');

      await page.goBack();
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/auth/login');

      await page.goForward();
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('/auth/register');
    }

    guard.assertClean();
  });

});
