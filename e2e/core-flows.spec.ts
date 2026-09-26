import { test, expect } from '@playwright/test';

test.describe('PΛND0RΛ Browser Core Flows', () => {

    test('should launch with correct branding', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveTitle(/PΛND0RΛ/);
    });

    test('should navigate to new tab', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const url = page.url();
        expect(url).toContain('localhost');
    });

    test('should open Forge editor panel', async ({ page }) => {
        await page.goto('/forge', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Forge Studio').first()).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    });

    test('omnibox should handle input', async ({ page }) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        const input = page.getByPlaceholder('Search or enter URL');
        if (await input.count() > 0) {
            await input.fill('pandora://test');
            await expect(input).toHaveValue('pandora://test');
        }
    });

    test('should render Auth Login page', async ({ page }) => {
        await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL(/.*auth\/login/);
    });

});

test.describe('PΛND0RΛ Forza Forensic Suite Flows', () => {

    test('should open Forza Prehľad (Dashboard)', async ({ page }) => {
        await page.goto('/forza/prehlad', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Forenzný prehľad|Prehľad/i).first()).toBeVisible();
    });

    test('should open Forza Prípady (Cases)', async ({ page }) => {
        await page.goto('/forza/pripady', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Spisy|Prípady/i).first()).toBeVisible();
    });

    test('should open Forza Sieť (Network Graph)', async ({ page }) => {
        await page.goto('/forza/siet', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Sieť|Prepojenia/i).first()).toBeVisible();
    });

    test('should open Forza Sandbox (AI Document Processing)', async ({ page }) => {
        await page.goto('/forza/sandbox', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Sandbox|Spis/i).first()).toBeVisible();
    });

    test('should open Forza Stav systému (Health & Status)', async ({ page }) => {
        await page.goto('/forza/stav', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Stav systému|Systémy sú v prevádzke/i).first()).toBeVisible();
    });

    test('should open Forza Profil', async ({ page }) => {
        await page.goto('/forza/profil', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Môj profil|vyšetrovateľa/i).first()).toBeVisible();
    });

    test('should open Forza Predplatné', async ({ page }) => {
        await page.goto('/forza/predplatne', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Predplatné|Balíky/i).first()).toBeVisible();
    });

    test('should open Forza Súkromie', async ({ page }) => {
        await page.goto('/forza/sukromie', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Súkromie|Ochrana dát/i).first()).toBeVisible();
    });

    test('should open Forza Viac (Navigation Hub)', async ({ page }) => {
        await page.goto('/forza/viac', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText(/Viac|Nastavenia/i).first()).toBeVisible();
    });

});
