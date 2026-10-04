import { test, expect } from '@playwright/test';

test.describe('Authenticated Forensic Flows', () => {

  test('Flow 3: Authenticated session reaches evidence upload surface', async ({ page }) => {
    await page.goto('/forza/sandbox');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toContain('/auth/login');

    const uploadArea = page.getByRole('button', { name: /nahrať|upload|vybrať súbor/i })
      .or(page.getByTestId('evidence-dropzone'))
      .or(page.locator('input[type="file"]'));
    await expect(uploadArea.first()).toBeAttached();
  });

  test('Flow 4: /forza/pripady renders case list or empty state without server error', async ({ page }) => {
    const response = await page.goto('/forza/pripady');
    expect(response?.status()).toBeLessThan(400);

    const listOrEmptyState = page.getByRole('table')
      .or(page.getByTestId('case-list'))
      .or(page.getByText(/žiadne prípady|vytvorte prvý prípad|zoznam prípadov/i));
    await expect(listOrEmptyState.first()).toBeVisible({ timeout: 8000 });
  });

  test('Flow 5: ForenZX analysis panel renders with fixture case UUID', async ({ page }) => {
    const fixtureCaseId = process.env.E2E_FIXTURE_CASE_ID ?? '11111111-1111-4111-8111-111111111111';
    await page.goto(`/forza/sandbox?caseId=${fixtureCaseId}`);
    await page.waitForLoadState('domcontentloaded');

    const analysisSurface = page.getByTestId('forenzx-analysis-panel')
      .or(page.getByRole('region', { name: /analýza|forenzx/i }))
      .or(page.getByText(/forenzx|spustiť analýzu/i));
    await expect(analysisSurface.first()).toBeVisible({ timeout: 8000 });
  });
});
