import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("prístupnosť ikonových tlačidiel", () => {
  it("ikonové tlačidlo kopírovania MCP URL má aria-label a 44px cieľ", () => {
    const page = read("app/forza/mcp-info/page.tsx");
    expect(page).toMatch(/aria-label=\{copied \? "URL skopírovaná" : "Kopírovať URL MCP endpointu"\}/);
    expect(page).toMatch(/h-11 w-11/);
  });
});
