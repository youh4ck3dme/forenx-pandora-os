// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P2-03 — Terminológia: v používateľsky viditeľných textoch (UI, exporty,
 * šablóny) nesmie zostať pojem „Projekt“; jednotný pojem je „Prípad“.
 * Test skenuje zdrojové súbory webu, Electronu a knižníc (bez testov a docs).
 */
const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib", "config", "integrations", "electron"];
const SKIP = new Set(["node_modules", ".next", "dist", "dist-electron", "__tests__"]);

const offenders: string[] = [];
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|mts)$/.test(entry.name)) {
      const source = fs.readFileSync(full, "utf8");
      if (/\b[Pp]rojekt/i.test(source)) {
        offenders.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  }
};

describe("P2-03 — jednotná terminológia Prípad", () => {
  it("žiadne viditeľné výskyty „Projekt“ v UI, exportoch a šablónach", () => {
    for (const dir of SCAN_DIRS) {
      const full = path.join(ROOT, dir);
      if (fs.existsSync(full)) walk(full);
    }
    expect(offenders).toEqual([]);
  });
});
