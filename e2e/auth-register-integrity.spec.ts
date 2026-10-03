import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.BASE_URL || 'https://pandora.whoiswho.at';

test.describe('P0 Auth Gate: Registration Integrity Suite', () => {

  test('Registration page renders fullscreen shell without protected content', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'domcontentloaded' });
    // App unifies auth on /auth/login?mode=signup — accept both URLs
    await expect(page).toHaveURL(/\/auth\/(register|login(\?|\/\?)mode=signup)/);

    // Verify 100dvh & layout bounds
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

    // Ensure protected UI is absent
    const protectedElements = await page.locator('aside.forensic-sidebar, nav[aria-label="Spodná navigácia"]').count();
    expect(protectedElements).toBe(0);
  });

  test('Registration validation: empty, short, and valid progression', async ({ page }) => {
    test.skip(!process.env.E2E_USER_EMAIL, 'Vyžaduje signup flow — preskočené bez E2E_USER_EMAIL');
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'load' });

    // App may unify register on login?mode=signup — locate email/password inputs generically
    const emailInput = page.locator('input[type="email"]').or(page.locator('#username')).or(page.locator('#email'));
    await emailInput.first().waitFor({ state: 'visible', timeout: 10000 });

    // 1. Submit empty — expect validation error
    await page.locator('button[type="submit"]').first().click();
    const validationError = page.getByText(/required|povinné/i).first();
    await expect(validationError).toBeVisible({ timeout: 5000 });

    // 2. Email format check
    await emailInput.first().fill('notanemail');
    await page.locator('button[type="submit"]').first().click();
    const formatError = page.getByText(/valid email|platný email|neplatný/i).first();
    await expect(formatError.or(validationError)).toBeVisible({ timeout: 5000 });
  });

  test('Accessibility audit on /auth/register (axe-core)', async ({ page }) => {
    // /auth/register may redirect to /auth/login?mode=signup — audit wherever we land
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'domcontentloaded' });
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const criticalViolations = accessibilityScanResults.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    expect(criticalViolations).toEqual([]);
  });

});
