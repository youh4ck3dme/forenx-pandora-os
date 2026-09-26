import { describe, expect, it } from "vitest";
import { navGroups, navItems, secondaryItems } from "@/components/malte/nav";

describe("navigácia", () => {
  it("má presne tri skupiny v poradí Prípad, Zistenia, Účet", () => {
    expect(navGroups.map((g) => g.title)).toEqual([
      "Prípad",
      "Zistenia",
      "Účet",
    ]);
  });

  it("spodná navigácia zodpovedá dennému toku", () => {
    expect(navItems.map((i) => i.label)).toEqual([
      "Spisy",
      "Autopilot",
      "Sandbox",
      "Sieť",
      "Viac",
    ]);
    expect(navItems.map((i) => i.to)).toEqual([
      "/forza/pripady",
      "/forza/asistent",
      "/forza/sandbox",
      "/forza/siet",
      "/forza/viac",
    ]);
  });

  it("skupiny obsahujú očakávané položky", () => {
    expect(navGroups[0]?.items.map((i) => i.to)).toEqual([
      "/forza/prehlad",
      "/forza/pripady",
      "/forza/asistent",
      "/forza/sandbox",
      "/forza/import-csv",
    ]);
    expect(navGroups[2]?.items.map((i) => i.to)).toEqual([
      "/forza/profil",
      "/forza/vzhlad",
      "/forza/predplatne",
      "/forza/sukromie",
      "/forza/mcp-info",
      "/forza/stav",
    ]);
  });

  it("plochý zoznam neobsahuje duplicity", () => {
    const targets = secondaryItems.map((i) => i.to);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
