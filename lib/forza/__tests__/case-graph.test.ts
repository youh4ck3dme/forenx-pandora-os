import { describe, expect, it } from "vitest";
import { buildAiGraphPlan } from "../case-graph-plan";

const caseId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function ids() {
  let index = 0;
  return () =>
    `00000000-0000-4000-8000-${String(++index).padStart(12, "0")}`;
}

describe("AI graph persistence plan", () => {
  it("keeps homonyms with different dates of birth as separate entities", () => {
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Ján Novák", dateOfBirth: "1975-04-12" },
          { name: "Ján Novák", dateOfBirth: "1984-09-30" },
        ],
        companies: [],
        timeline: [],
      },
      userId,
      "2026-09-27",
      [],
      [],
      [],
      ids(),
    );

    expect(plan.entities).toHaveLength(2);
    expect(plan.entities.map((entity) => entity.identity_key)).toEqual([
      "person:ján novák|born:1975-04-12",
      "person:ján novák|born:1984-09-30",
    ]);
  });

  it("does not link an event actor when its name is ambiguous", () => {
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Ján Novák", dateOfBirth: "1975-04-12" },
          { name: "Ján Novák", dateOfBirth: "1984-09-30" },
          { name: "Eva Malá", dateOfBirth: "1988-01-01" },
        ],
        companies: [],
        timeline: [
          {
            date: "2026-09-20",
            event: "Stretnutie",
            actors: ["Ján Novák", "Eva Malá"],
          },
        ],
      },
      userId,
      "2026-09-27",
      [],
      [],
      [],
      ids(),
    );

    expect(plan.events).toHaveLength(1);
    expect(plan.relations).toHaveLength(0);
  });

  it("builds entities, events, and relations before one atomic commit", () => {
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Anna Horváthová", dateOfBirth: "1980-01-01" },
          { name: "Peter Horváth", dateOfBirth: "1978-02-02" },
        ],
        companies: [],
        timeline: [
          {
            event: "Podpis zmluvy",
            actors: ["Anna Horváthová", "Peter Horváth"],
          },
        ],
      },
      userId,
      "2026-09-27",
      [],
      [],
      [],
      ids(),
    );

    expect(plan.entities).toHaveLength(2);
    expect(plan.events).toHaveLength(1);
    expect(plan.relations).toHaveLength(1);
    expect(plan.relations[0]?.from_id).toBe(plan.entities[0]?.id);
    expect(plan.relations[0]?.to_id).toBe(plan.entities[1]?.id);
  });

  it("keeps the existing partial-date fallback behavior", () => {
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [],
        companies: [],
        timeline: [{ date: "2026-09", event: "Mesačný záznam" }],
      },
      userId,
      "2026-09-27",
      [],
      [],
      [],
      ids(),
    );

    expect(plan.events[0]?.date).toBe("2026-09-01");
  });
});
