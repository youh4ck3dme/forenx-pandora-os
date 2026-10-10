import { describe, expect, it } from "vitest";
import { deterministicTemporalDelta, verifyLiteralQuote } from "../asset-timeline-engine";
describe("asset timeline deterministic engine", () => {
  it("applies exact boundaries", () => {
    const base = "2026-01-01T00:00:00Z";
    expect(deterministicTemporalDelta(base, "2026-01-03T23:59:00Z").severity).toBe("CRITICAL");
    expect(deterministicTemporalDelta(base, "2026-01-04T00:00:00Z").severity).toBe("HIGH");
    expect(deterministicTemporalDelta(base, "2026-01-15T00:00:00Z").severity).toBe("MEDIUM");
    expect(deterministicTemporalDelta(base, "2026-02-15T00:00:00Z").severity).toBe("LOW");
  });
  it("downgrades date-only and malformed timestamps", () => {
    expect(deterministicTemporalDelta("2026-01-01", "2026-01-02")).toMatchObject({ precision: "DATE_ONLY", timeDeltaHours: null });
    expect(deterministicTemporalDelta("bad", "2026-01-02")).toMatchObject({ precision: "UNKNOWN", timeDeltaHours: null });
  });
  it("requires a literal quote in the referenced evidence", () => {
    const sources = new Map([["e1", "Bankový prevod vo výške 1000 EUR na účet spoločnosti."]]);
    expect(verifyLiteralQuote("Bankový prevod vo výške 1000 EUR", "e1", sources)).toBe(true);
    expect(verifyLiteralQuote("Vymyslená citácia, ktorá nie je v spise", "e1", sources)).toBe(false);
  });
});
