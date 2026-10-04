import { describe, expect, it } from "vitest";
import {
  enforceSourceRefIntegrity,
  validateSourceRefs,
} from "../source-ref-integrity";
import { buildAiGraphPlan } from "../case-graph-plan";
import { roundMoney, sumMoney, sumVolume } from "../forensic/core/money";
import { cashRatio } from "../forensic/core/transactions";
import type { Transaction } from "../forensic/types";

describe("SourceRef integrity", () => {
  const dossier = {
    facts: {
      timeline: [
        { event: "A", sourceRef: { documentId: "spis.pdf", page: 2 } },
        { event: "B", sourceRef: { documentId: "neexistuje.pdf", page: 1 } },
        { event: "C", sourceRef: { documentId: "spis.pdf", page: 0 } },
        { event: "D", sourceRef: { documentId: "spis.pdf", page: 99 } },
        { event: "E", source: "legacy text only" },
      ],
    },
    defenseAttack: { attacks: [{ sourceRef: { page: 1 } }] },
  };
  const documents = [{ id: "spis.pdf", pageCount: 10 }];

  it("reports every dangling or out-of-range reference with its path", () => {
    expect(validateSourceRefs(dossier, documents)).toEqual([
      { path: "facts.timeline[1].sourceRef", reason: "unknown_document" },
      { path: "facts.timeline[2].sourceRef", reason: "invalid_page" },
      { path: "facts.timeline[3].sourceRef", reason: "page_out_of_range" },
      { path: "defenseAttack.attacks[0].sourceRef", reason: "malformed" },
    ]);
  });

  it("removes invalid references and leaves no dangling ones", () => {
    const { value, removed } = enforceSourceRefIntegrity(dossier, documents);
    expect(removed).toHaveLength(4);
    expect(validateSourceRefs(value, documents)).toEqual([]);
    expect(value.facts.timeline[0]?.sourceRef).toEqual({ documentId: "spis.pdf", page: 2 });
    expect(value.facts.timeline[1]).toEqual({ event: "B" });
    // Input is not mutated.
    expect(dossier.facts.timeline[1]?.sourceRef).toBeDefined();
  });
});

describe("temporal relation planning", () => {
  it("keeps the same pair and role in different periods as separate relations", () => {
    let n = 0;
    const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const plan = buildAiGraphPlan(
      {
        caseId: "11111111-1111-4111-8111-111111111111",
        persons: [{ name: "Mária Kováčová", dateOfBirth: "1965-05-05" }],
        companies: ["Alfa s.r.o."],
        timeline: [
          { date: "2010-01-01", endDate: "2014-12-31", event: "konateľ", actors: ["Mária Kováčová", "Alfa s.r.o."] },
          { date: "2019-03-01", endDate: "2022-06-30", event: "konateľ", actors: ["Mária Kováčová", "Alfa s.r.o."] },
          { date: "2019-03-01", endDate: "2022-06-30", event: "konateľ", actors: ["Mária Kováčová", "Alfa s.r.o."] },
          { date: "2023-01-01", endDate: "2020-01-01", event: "chybné obdobie", actors: ["Mária Kováčová", "Alfa s.r.o."] },
        ],
      },
      "22222222-2222-4222-8222-222222222222",
      "2026-09-27",
      [],
      [],
      [],
      id,
    );
    expect(plan.relations.map((r) => [r.label, r.valid_from, r.valid_to])).toEqual([
      ["konateľ", "2010-01-01", "2014-12-31"],
      ["konateľ", "2019-03-01", "2022-06-30"],
      ["chybné obdobie", "2023-01-01", null],
    ]);
  });
});

describe("financial safety", () => {
  it("avoids binary floating point drift (0.1 + 0.2)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(roundMoney(1.005)).toBe(1.01);
  });

  it("handles large and negative amounts exactly to the cent", () => {
    expect(sumMoney([9_999_999_999.99, 0.01])).toBe(10_000_000_000);
    expect(sumMoney([-1250.75, 250.25])).toBe(-1000.5);
    expect(sumVolume([-1250.75, 250.25])).toBe(1501);
  });

  it("returns null, never NaN/Infinity or a fake 0 %, when the denominator is zero", () => {
    expect(cashRatio([])).toBeNull();
    const zero = [{ id: "t", amount: 0, method: "cash" }] as unknown as Transaction[];
    expect(cashRatio(zero)).toBeNull();
  });

  it("round-trips minor units without loss", () => {
    const amounts = ["0.30", "-1250.75", "99999999999999.99"];
    for (const text of amounts) {
      const [whole = "0", frac = "00"] = text.replace("-", "").split(".");
      const minor = BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, "0"));
      const back = `${text.startsWith("-") ? "-" : ""}${minor / BigInt(100)}.${String(minor % BigInt(100)).padStart(2, "0")}`;
      expect(back).toBe(text);
    }
  });
});
