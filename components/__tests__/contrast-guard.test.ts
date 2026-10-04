import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Contrast guard (regression): a class string that paints an OPAQUE theme
 * surface (bg-card / bg-background / bg-popover / bg-muted / bg-secondary /
 * bg-white) must also set an explicit text colour. Otherwise the text inherits
 * from a parent (e.g. the forced-dark `Card` -> text-white) and becomes
 * invisible on a light surface (white-on-white).
 */
const ROOTS = ["components", "app"];
const OPAQUE_BG =
  /(?<![:\w-])bg-(card|background|popover|muted|secondary|white)(\/9\d|\/100)?(?![\w/-])/;
/** Empty decorative blocks (bars, skeletons, fallbacks) hold no text. */
const DECORATIVE =
  /\/>\s*(\}?\)?[;,]?)\s*$|\bh-(px|1|1\.5|2)\b|animate-pulse|\bh-4 w-4 rounded-full\b/;
const TEXT_COLOR =
  /\btext-(card-foreground|foreground|muted-foreground|primary-foreground|primary|secondary-foreground|popover-foreground|destructive|white|black|zinc|gray|slate|neutral|stone|amber|red|rose|green|emerald|blue|purple|violet|indigo|yellow|orange|sky|cyan|teal|pink|risk|header-foreground|accent-foreground|inherit|current|\[#|\[var|\[oklch)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export function findContrastViolations(cwd = process.cwd()): string[] {
  const violations: string[] = [];
  for (const root of ROOTS) {
    const base = path.join(cwd, root);
    if (!fs.existsSync(base)) continue;
    for (const file of walk(base)) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!OPAQUE_BG.test(line)) return;
        if (!/className|cn\(|"[^"]*bg-/.test(line)) return;
        if (DECORATIVE.test(line)) return;
        // class strings may wrap: look one line around for a text colour
        const window = [lines[i - 1], line, lines[i + 1]].join(" ");
        if (TEXT_COLOR.test(window)) return;
        violations.push(`${path.relative(cwd, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  return violations;
}

describe("Contrast guard (no invisible text on opaque theme surfaces)", () => {
  it("every opaque bg-* surface declares an explicit text colour", () => {
    const violations = findContrastViolations();
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
