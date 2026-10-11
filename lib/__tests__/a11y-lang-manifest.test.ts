import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("jazyk a manifest", () => {
  it("root layout má lang=\"sk\"", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toMatch(/<html lang="sk"/);
    expect(layout).not.toMatch(/<html lang="en"/);
  });

  it("manifest je slovenský (lang aj popis)", () => {
    const manifest = JSON.parse(read("public/manifest.json")) as { lang: string; description: string };
    expect(manifest.lang).toBe("sk");
    expect(manifest.description).toMatch(/forenzn/i);
    expect(manifest.description).not.toMatch(/Next-generation/);
  });
});
