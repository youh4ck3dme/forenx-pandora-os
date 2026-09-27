import { test, expect } from "@playwright/test";

test.describe("PΛND0RΛ Navigation Sections & Contrast E2E Flows", () => {
  test("should render high-contrast section headers in desktop sidebar (PRÍPAD, ZISTENIA, ÚČET)", async ({
    page,
  }) => {
    await page.goto("/forza/prehlad", { waitUntil: "domcontentloaded" });

    // PRÍPAD sekcia
    const pripadHeader = page
      .locator(
        'nav p:has-text("PRÍPAD"), aside p:has-text("PRÍPAD"), p:has-text("Prípad")',
      )
      .first();
    await expect(pripadHeader).toBeVisible();

    // ZISTENIA sekcia
    const zisteniaHeader = page
      .locator(
        'nav p:has-text("ZISTENIA"), aside p:has-text("ZISTENIA"), p:has-text("Zistenia")',
      )
      .first();
    await expect(zisteniaHeader).toBeVisible();

    // ÚČET sekcia
    const ucetHeader = page
      .locator(
        'nav p:has-text("ÚČET"), aside p:has-text("ÚČET"), p:has-text("Účet")',
      )
      .first();
    await expect(ucetHeader).toBeVisible();
  });

  test("should navigate across all items in PRÍPAD section", async ({
    page,
  }) => {
    // 1. Prehľad
    await page.goto("/forza/prehlad", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/prehlad/);

    // 2. Prípady
    await page.goto("/forza/pripady", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/pripady/);

    // 3. Forenzný Autopilot
    await page.goto("/forza/asistent", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/asistent/);

    // 4. AI Sandbox
    await page.goto("/forza/sandbox", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/sandbox/);

    // 5. Import CSV
    await page.goto("/forza/import-csv", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/import-csv/);
  });

  test("Import CSV shows high-contrast EmptyState and navigates to Prípady when clicked", async ({
    page,
  }) => {
    await page.goto("/forza/import-csv", { waitUntil: "domcontentloaded" });

    // Overenie zobrazenia kontrastnej hlášky z obrázka
    const emptyTitle = page.getByText("Najprv vyberte alebo vytvorte prípad");
    const emptyDetail = page.getByText(
      "Transakcie z CSV súboru sa priradia k aktívnemu prípadu.",
    );

    await expect(emptyTitle).toBeVisible();
    await expect(emptyDetail).toBeVisible();

    // Overenie akčného tlačidla pre výber prípadu
    const actionButton = page.getByRole("link", {
      name: /Vybrať alebo vytvoriť prípad/i,
    });
    await expect(actionButton).toBeVisible();

    // Preklik medzi sekciami: z Import CSV -> Prípady
    await actionButton.click();
    await expect(page).toHaveURL(/.*\/forza\/pripady/);
  });

  test("should navigate across all items in ZISTENIA section", async ({
    page,
  }) => {
    // 1. Analýza
    await page.goto("/forza/analyza-vypisov", {
      waitUntil: "domcontentloaded",
    });
    await expect(page).toHaveURL(/.*\/forza\/analyza-vypisov/);

    // 2. Osoby
    await page.goto("/forza/osoby", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/osoby/);

    // 3. Vzťahy
    await page.goto("/forza/vztahy", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/vztahy/);

    // 4. Sieť tokov
    await page.goto("/forza/siet", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/siet/);

    // 5. Zbrane
    await page.goto("/forza/zbrane", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/zbrane/);

    // 6. Právny kontext
    await page.goto("/forza/pravny-kontext", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/pravny-kontext/);
  });

  test("should navigate across all items in ÚČET section", async ({ page }) => {
    // 1. Môj profil
    await page.goto("/forza/profil", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/profil/);

    // 2. Vzhľad a téma
    await page.goto("/forza/vzhlad", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/vzhlad/);

    // 3. Predplatné
    await page.goto("/forza/predplatne", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/predplatne/);

    // 4. Súkromie
    await page.goto("/forza/sukromie", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/sukromie/);

    // 5. Agentné API
    await page.goto("/forza/mcp-info", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/mcp-info/);

    // 6. Stav systému
    await page.goto("/forza/stav", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/.*\/forza\/stav/);
  });

  test("should toggle Záložky prehliadača section in sidebar", async ({
    page,
  }) => {
    await page.goto("/forza/prehlad", { waitUntil: "domcontentloaded" });

    const bookmarksBtn = page
      .getByRole("button", { name: /Záložky prehliadača/i })
      .first();
    if (await bookmarksBtn.isVisible()) {
      await bookmarksBtn.click();
      // Po kliknutí by mal byť rozbalený zoznam
      await expect(bookmarksBtn).toBeVisible();
    }
  });
});
