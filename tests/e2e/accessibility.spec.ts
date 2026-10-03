import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PUBLIC_ROUTES = [
  { name: 'Login Page', path: '/auth/login/' },
  { name: 'Public Landing', path: '/' },
];

test.describe('WCAG 2.1 AA — Automated contrast audit (axe-core)', () => {
  for (const { name, path } of PUBLIC_ROUTES) {
    test(`${name} has 0 critical contrast violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('domcontentloaded');

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast');

      expect(
        contrastViolations,
        `${contrastViolations.length} contrast violations on ${name}:\n` +
          contrastViolations.map((v) => `  - ${v.description} (${v.nodes.length} elements)`).join('\n'),
      ).toHaveLength(0);
    });
  }
});
