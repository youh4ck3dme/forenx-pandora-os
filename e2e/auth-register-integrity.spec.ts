import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE_URL = process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.BASE_URL || 'https://pandora.whoiswho.at';

test.describe('P0 Auth Gate: Registration Integrity Suite', () => {

  test('Registration page renders fullscreen shell without protected content', async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/.*auth\/register/);

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
    await page.goto(`${BASE_URL}/auth/register`, { waitUntil: 'load' });
    await page.locator('#username').waitFor({ state: 'visible' });
    // Wait for hydration event listeners to attach
    await page.waitForTimeout(1000);

    // 1. Submit empty username
    await page.locator('button[type="submit"]:has-text("Continue")').click();
    await expect(page.getByText('Username is required')).toBeVisible();

    // 2. Submit short username (< 3 chars)
    await page.locator('#username').fill('ab');
    await page.locator('button[type="submit"]:has-text("Continue")').click();
    await expect(page.getByText('Username must be at least 3 characters')).toBeVisible();

    // 3. Submit valid username with whitespace normalization
    await page.locator('#username').fill('  forensic_user_test  ');
    await page.locator('button[type="submit"]:has-text("Continue")').click();

    // Should progress to biometric setup step
    await expect(page.getByRole('heading', { name: 'Setup Biometrics' })).toBeVisible();
  });

  test('Accessibility audit on /auth/register (axe-core)', async ({ page }) => {
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
