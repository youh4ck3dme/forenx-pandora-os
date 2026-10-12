import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFLINE_AI_MESSAGE, OFFLINE_READONLY_MESSAGE } from "@/lib/hooks/useOnlineStatus";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("offline read-only režim", () => {
  it("má presné znenie read-only hlášky a ponecháva AI hlášku", () => {
    expect(OFFLINE_READONLY_MESSAGE).toBe(
      "Ste offline. Prehliadanie je dostupné. Zápis bude možný po obnovení pripojenia.",
    );
    expect(OFFLINE_AI_MESSAGE).toMatch(/AI analýza vyžaduje internetové pripojenie/);
  });

  it("offline banner aj offline stránka používajú read-only hlášku", () => {
    expect(read("components/malte/Shell.tsx")).toMatch(/\{OFFLINE_READONLY_MESSAGE\}/);
    expect(read("app/offline/page.tsx")).toMatch(/\{OFFLINE_READONLY_MESSAGE\}/);
  });

  it("neexistuje falošná localStorage write fronta", () => {
    for (const file of [
      "lib/hooks/useOnlineStatus.ts",
      "lib/forza/write-status.ts",
      "app/offline/page.tsx",
    ]) {
      expect(code(file)).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
});
