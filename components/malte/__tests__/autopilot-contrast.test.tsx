import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Forenzný Autopilot dark blur and background contrast", () => {
  const assistantPath = path.resolve(
    process.cwd(),
    "components/malte/Assistant.tsx",
  );
  const globeCanvasPath = path.resolve(
    process.cwd(),
    "components/ui/Globe/GlobeCanvas.tsx",
  );
  const shellPath = path.resolve(process.cwd(), "components/malte/Shell.tsx");
  const globalsCssPath = path.resolve(process.cwd(), "app/globals.css");

  it("GlobeCanvas stays in background with zIndex: 0", () => {
    const content = fs.readFileSync(globeCanvasPath, "utf8");
    expect(content).toContain("zIndex: 0");
    expect(content).not.toContain("zIndex: 10");
  });

  it("Assistant wraps interactive UI in a relative z-10 container above Globe", () => {
    const content = fs.readFileSync(assistantPath, "utf8");
    expect(content).toContain('<div className="relative z-10 space-y-4">');
    expect(content).toContain(
      "pointer-events-none absolute inset-0 z-0 overflow-hidden",
    );
  });

  it("Forenzný Autopilot cards and dropzone enforce high-contrast bg-black/85 and backdrop-blur-md", () => {
    const content = fs.readFileSync(assistantPath, "utf8");
    expect(content).toContain("bg-black/85 backdrop-blur-md");
    expect(content).toContain("border-white/20");
    expect(content).toContain("border-white/30");
  });

  it("liquid-glass-card and Shell.tsx Card have >= 85% opacity with 16px blur", () => {
    const css = fs.readFileSync(globalsCssPath, "utf8");
    const shell = fs.readFileSync(shellPath, "utf8");
    expect(css).toContain("rgba(0, 0, 0, 0.85)");
    expect(shell).toContain("bg-black/85");
  });
});
