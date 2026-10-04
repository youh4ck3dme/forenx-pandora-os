import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateContrast } from "../contrast";
import { findWarningContrastViolations } from "@/scripts/ci/contrast-class-guard";

describe("warning color contrast", () => {
  it("rejects white text on orange-500 for normal text", () => {
    const result = evaluateContrast("#ffffff", "#f97316");

    expect(result.passesNormalAa).toBe(false);
    expect(result.ratio).toBeLessThan(4.5);
  });

  it("keeps primary yellow buttons readable with their foreground token", () => {
    const result = evaluateContrast("rgb(23, 23, 23)", "rgb(255, 199, 0)");

    expect(result.passesNormalAa).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("composites warning glass over the defined dark surface before evaluating it", () => {
    const result = evaluateContrast(
      "#fbbf24",
      "rgba(245, 158, 11, 0.15)",
      "#09090b",
    );

    expect(result.passesNormalAa).toBe(true);
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("forbids direct white text on yellow, amber, or orange Tailwind backgrounds", () => {
    const root = path.resolve(process.cwd());
    const violations = [
      ...findWarningContrastViolations(path.join(root, "app")),
      ...findWarningContrastViolations(path.join(root, "components")),
    ];

    expect(violations).toEqual([]);
  });
});
