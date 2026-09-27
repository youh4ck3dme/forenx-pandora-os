import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { navGroups } from "@/components/malte/nav";

describe("Sidebar Navigation Sections Contrast and Flow Integrity", () => {
  const bookmarksPanelPath = path.resolve(
    process.cwd(),
    "components/features/browser/parts/panels/bookmarks-panel.tsx",
  );
  const shellPath = path.resolve(process.cwd(), "components/malte/Shell.tsx");
  const emptyStatePath = path.resolve(
    process.cwd(),
    "components/malte/EmptyState.tsx",
  );
  const importCsvPath = path.resolve(
    process.cwd(),
    "app/forza/import-csv/page.tsx",
  );

  it("all 3 main sections (PRÍPAD, ZISTENIA, ÚČET) are configured in navGroups", () => {
    const titles = navGroups.map((g) => g.title);
    expect(titles).toContain("Prípad");
    expect(titles).toContain("Zistenia");
    expect(titles).toContain("Účet");

    const pripadItems = navGroups
      .find((g) => g.title === "Prípad")
      ?.items.map((i) => i.label);
    expect(pripadItems).toEqual([
      "Prehľad",
      "Prípady",
      "Forenzný Autopilot",
      "AI Sandbox",
      "Import CSV",
    ]);

    const zisteniaItems = navGroups
      .find((g) => g.title === "Zistenia")
      ?.items.map((i) => i.label);
    expect(zisteniaItems).toEqual([
      "Analýza",
      "Osoby",
      "Vzťahy",
      "Sieť tokov",
      "Zbrane",
      "Právny kontext",
    ]);

    const ucetItems = navGroups
      .find((g) => g.title === "Účet")
      ?.items.map((i) => i.label);
    expect(ucetItems).toEqual([
      "Môj profil",
      "Vzhľad a téma",
      "Predplatné",
      "Súkromie",
      "Agentné API",
      "Stav systému",
    ]);
  });

  it("bookmarks-panel.tsx enforces high-contrast section headers (text-zinc-300 font-extrabold)", () => {
    const content = fs.readFileSync(bookmarksPanelPath, "utf8");
    expect(content).toContain(
      "text-[11px] font-extrabold uppercase tracking-wider text-zinc-300",
    );
    expect(content).toContain("text-zinc-200 hover:text-white");
    expect(content).toContain(
      "bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40",
    );
    expect(content).toContain("Záložky prehliadača");
  });

  it("Shell.tsx desktop sidebar enforces high-contrast section headers and links", () => {
    const content = fs.readFileSync(shellPath, "utf8");
    expect(content).toContain(
      "text-[11px] font-extrabold uppercase tracking-wider text-zinc-300",
    );
    expect(content).toContain(
      "text-zinc-200 transition-colors hover:bg-white/10 hover:text-white",
    );
  });

  it("EmptyState enforces high-contrast background and text (bg-black/85, text-white, text-zinc-300)", () => {
    const content = fs.readFileSync(emptyStatePath, "utf8");
    expect(content).toContain("bg-black/85 backdrop-blur-md");
    expect(content).toContain("text-white");
    expect(content).toContain("text-zinc-300");
    expect(content).toContain("text-amber-400 border border-amber-500/30");
  });

  it("Import CSV provides actionable cross-section navigation to Prípady when no case is selected", () => {
    const content = fs.readFileSync(importCsvPath, "utf8");
    expect(content).toContain('title="Najprv vyberte alebo vytvorte prípad"');
    expect(content).toContain(
      'detail="Transakcie z CSV súboru sa priradia k aktívnemu prípadu."',
    );
    expect(content).toContain('href="/forza/pripady"');
  });
});
