// @vitest-environment node
/**
 * Regresné strážcovia pre axe nálezy zo smoke behu:
 * - meta-viewport: root layout nesmie vypínať zoom (WCAG 1.4.4)
 * - iOS: prihlasovacie polia majú na mobile 16px (text-base), aby sa nezoomovalo
 * - color-contrast: metadáta blogu nepoužívajú text-foreground/40 (3.81:1 na #0d0d0d)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const src = (rel: string) =>
  readFileSync(join(root, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("root viewport", () => {
  const layout = src("app/layout.tsx");
  const viewportBlock = /export const viewport: Viewport = \{([\s\S]*?)\};/.exec(layout)?.[1] ?? "";

  it("existuje práve jeden viewport export s width=device-width a initialScale=1", () => {
    expect(layout.match(/export const viewport\b/g)).toHaveLength(1);
    expect(viewportBlock).toMatch(/width:\s*"device-width"/);
    expect(viewportBlock).toMatch(/initialScale:\s*1\b/);
  });

  it("nevypína zoom (žiadne maximumScale ani userScalable)", () => {
    expect(viewportBlock).not.toMatch(/maximumScale/);
    expect(viewportBlock).not.toMatch(/userScalable/);
    expect(layout).not.toMatch(/user-scalable|maximum-scale/);
  });
});

describe("prihlasovací formulár — iOS input zoom", () => {
  it("polia majú text-base (16px) na mobile a text-sm až od md", () => {
    const form = src("components/malte/AccountSignInForm.tsx");
    const inputClass = /const inputClass =\s*"([^"]+)"/.exec(form)?.[1] ?? "";
    const darkField = /\? "(h-11 w-full rounded-xl border border-white\/20[^"]+)"/.exec(form)?.[1] ?? "";
    for (const cls of [inputClass, darkField]) {
      expect(cls).toContain("text-base");
      expect(cls).toContain("md:text-sm");
      expect(cls.split(/\s+/)).not.toContain("text-sm");
    }
  });
});

describe("blog — kontrast metadát", () => {
  it("dátum a čas čítania na /blog používajú text-foreground/60", () => {
    const page = src("app/blog/page.tsx");
    expect(page).toMatch(/justify-between text-xs text-foreground\/60/);
    expect(page).not.toMatch(/text-foreground\/40/);
  });

  it("riadok 'Autor' na článku používa text-foreground/60", () => {
    const page = src("app/blog/[slug]/page.tsx");
    expect(page).toMatch(/text-foreground\/60 text-sm">Autor</);
    expect(page).not.toMatch(/text-foreground\/40/);
  });
});
