// @ts-check
import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { AUTH_FILE } from './auth-file';

setup('authenticate via Supabase credentials', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  const dir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (!email || !password) {
    console.warn('[E2E Setup] E2E_USER_EMAIL / E2E_USER_PASSWORD missing — writing empty storageState.');
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  await page.goto('/auth/login/');
  await page.waitForLoadState('domcontentloaded');

  const emailInput = page.getByRole('textbox', { name: /email/i })
    .or(page.locator('input[type="email"]'))
    .or(page.getByTestId('login-email-input'));
  const passwordInput = page.locator('input[type="password"]')
    .or(page.getByTestId('login-password-input'));
  const submitBtn = page.getByRole('button', { name: /prihlásiť|sign in|login/i })
    .or(page.getByTestId('login-submit-btn'));

  await emailInput.first().fill(email);
  await passwordInput.first().fill(password);
  await submitBtn.first().click();

  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 15000 });
  await page.context().storageState({ path: AUTH_FILE });
});
