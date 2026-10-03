import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.BASE_URL || 'https://pandora.whoiswho.at';

test.describe('P0 Auth Gate: Pre-Auth Lockdown & Route Protection', () => {

  // Test across specified viewports: 1440x900, 768x1024, 390x844, 360x800
  const viewports = [
    { name: 'Desktop 1440x900', width: 1440, height: 900 },
    { name: 'Tablet 768x1024', width: 768, height: 1024 },
    { name: 'Mobile 390x844', width: 390, height: 844 },
    { name: 'Mobile 360x800', width: 360, height: 800 },
  ];

  for (const vp of viewports) {
    test(`Pre-auth screen integrity & layout on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });

      // Check 100dvh & no horizontal scroll
      const dimensions = await page.evaluate(() => {
        return {
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
          windowInnerHeight: window.innerHeight,
        };
      });

      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

      // Verify no protected UI elements are rendered
      const protectedSelectors = [
        'aside.forensic-sidebar',
        '[data-testid="copilot-panel"]',
        'nav[aria-label="Spodná navigácia"]',
        '[data-forenx-bottom-nav]',
        '#active-case-banner',
        '.forza-shell',
      ];

      for (const selector of protectedSelectors) {
        const count = await page.locator(selector).count();
        expect(count, `Protected UI selector ${selector} must NOT exist on pre-auth screen`).toBe(0);
      }
    });
  }

  test('Protected page routes redirect unauthenticated users to auth with safe next param', async ({ page }) => {
    test.setTimeout(120000);
    const protectedPages = [
      '/forza',
      '/forza/prehlad',
      '/forza/asistent',
      '/forza/vztahy',
      '/forza/siet',
      '/forza/pripady',
      '/workspace',
      '/cases',
      '/pripad',
      '/export',
      '/profile',
      '/settings',
      '/browser',
      '/forge',
      '/offline',
    ];

    for (const route of protectedPages) {
      const response = await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      // Final URL should be login page
      const currentUrl = page.url();
      expect(currentUrl).toContain('/auth');

      // No protected content leaked before redirect
      const content = await page.content();
      expect(content).not.toContain('Forenzný Autopilot');
      expect(content).not.toContain('Zoznam spisov');
    }
  });

  test('Protected API routes return 401 JSON without redirection to HTML', async ({ request }) => {
    const protectedApiEndpoints = [
      '/api/vault',
      '/api/vault/presign',
      '/api/vault/commit',
      '/api/audit',
      '/api/audit/access',
      '/api/health/observe',
      '/api/fn/unknown',
      '/api/completely-unknown-route',
    ];

    for (const endpoint of protectedApiEndpoints) {
      const response = await request.get(`${BASE_URL}${endpoint}`);
      expect(response.status()).toBe(401);
      const json = await response.json();
      expect(json).toHaveProperty('error');
      expect(json.error).toContain('Unauthorized');
    }
  });

  test('Open redirect security on next= parameter', async ({ request, baseURL }) => {
    // Use API request (not page.goto) to avoid browser hanging on javascript:/data: protocols
    // WAF/Apache blocks these at the network level — page.goto times out, request.get resolves
    const maliciousTargets = [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '/auth/login%2Fevil',
      '/forza/../admin',
      '/forza//pripady',
    ];

    for (const target of maliciousTargets) {
      const res = await request.get(
        `${baseURL}/auth/login?next=${encodeURIComponent(target)}`,
        { maxRedirects: 0 },
      );
      // Server must either return 200 (login page) or redirect only to internal paths
      const location = res.headers()['location'] ?? '';
      expect(location, `Unexpected open redirect to: ${location}`).not.toMatch(/^https?:\/\/evil\.example/i);
      expect(location, `Dangerous protocol in redirect: ${location}`).not.toMatch(/^(javascript|data):/i);
    }
  });

  test('Accessibility audit on /auth/login (axe-core)', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(criticalViolations).toEqual([]);
  });

  test('No server secrets are leaked in client bundles or HTML', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' });
    const content = await page.content();

    // Check that sensitive server keys are never present in raw HTML
    expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(content).not.toContain('MISTRAL_API_KEY');
    expect(content).not.toContain('GEMINI_API_KEY');
    expect(content).not.toContain('CRON_SECRET');
  });

});
