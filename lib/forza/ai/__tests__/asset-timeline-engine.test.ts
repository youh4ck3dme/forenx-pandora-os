import { describe, expect, it } from "vitest";
import { deterministicTemporalDelta, redactEvidenceDocumentsForModel, verifyLiteralQuote } from "../asset-timeline-engine";

describe("asset timeline deterministic engine", () => {
  it("applies exact boundaries", () => {
    const base = "2026-01-01T00:00:00Z";
    expect(
      deterministicTemporalDelta(base, "2026-01-03T23:59:00Z").severity,
    ).toBe("CRITICAL");
    expect(
      deterministicTemporalDelta(base, "2026-01-04T00:00:00Z").severity,
    ).toBe("HIGH");
    expect(
      deterministicTemporalDelta(base, "2026-01-15T00:00:00Z").severity,
    ).toBe("MEDIUM");
    expect(
      deterministicTemporalDelta(base, "2026-02-15T00:00:00Z").severity,
    ).toBe("LOW");
  });

  it("downgrades date-only and malformed timestamps", () => {
    expect(
      deterministicTemporalDelta("2026-01-01", "2026-01-02"),
    ).toMatchObject({
      precision: "DATE_ONLY",
      timeDeltaHours: null,
      severity: null,
    });
    expect(deterministicTemporalDelta("bad", "2026-01-02")).toMatchObject({
      precision: "UNKNOWN",
      timeDeltaHours: null,
      severity: null,
    });
  });

  it("does not classify date-only timestamps near severity boundaries", () => {
    expect(
      deterministicTemporalDelta("2026-01-01", "2026-01-04"),
    ).toMatchObject({ severity: null, timeDeltaHours: null });
    expect(
      deterministicTemporalDelta("2026-01-01", "2026-01-15"),
    ).toMatchObject({ severity: null, timeDeltaHours: null });
    expect(
      deterministicTemporalDelta("2026-01-01", "2026-02-15"),
    ).toMatchObject({ severity: null, timeDeltaHours: null });
  });

  it("verifies quotes against the model-visible redacted evidence", () => {
    const documents = redactEvidenceDocumentsForModel([
      {
        evidenceId: "e1",
        text: "Platba bola odoslaná na účet SK3112000000198742637541 podľa výpisu.",
      },
    ]);
    const sources = new Map(
      documents.map((document) => [document.evidenceId, document.text]),
    );
    expect(documents[0]?.text).toContain("[IBAN]");
    expect(documents[0]?.text).not.toContain("SK3112000000198742637541");
    expect(
      verifyLiteralQuote(
        "Platba bola odoslaná na účet [IBAN] podľa výpisu.",
        "e1",
        sources,
      ),
    ).toBe(true);
  });

  it("requires a literal quote in the referenced evidence", () => {
    const sources = new Map([
      ["e1", "Bankový prevod vo výške 1000 EUR na účet spoločnosti."],
    ]);
    expect(
      verifyLiteralQuote(
        "Bankový prevod vo výške 1000 EUR",
        "e1",
        sources,
      ),
    ).toBe(true);
    expect(
      verifyLiteralQuote(
        "Vymyslená citácia, ktorá nie je v spise",
        "e1",
        sources,
      ),
    ).toBe(false);
  });
});
