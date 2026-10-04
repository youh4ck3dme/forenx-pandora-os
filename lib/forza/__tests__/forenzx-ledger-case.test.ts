// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  collectSuppliedCaseIds,
  decideEvidenceCaseId,
} from "../../../supabase/functions/forenzx-evidence-webhook/ledger-case";

const LEDGER = "22222222-2222-4222-8222-222222222222";
const SPOOF = "33333333-3333-4333-8333-333333333333";

describe("decideEvidenceCaseId", () => {
  it("rejects a spoofed caller caseId that differs from the ledger", () => {
    const decision = decideEvidenceCaseId(LEDGER, [SPOOF]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(400); // caller error: bad input, not authorization failure
      expect(decision.code).toBe("case_id_mismatch");
    }
  });

  it("rejects caller case_id even when it matches an S3 key path segment", () => {
    const fromKey = "cases/99999999-9999-4999-8999-999999999999/evidence/dump.bin";
    const spoofedFromKey = "99999999-9999-4999-8999-999999999999";
    expect(fromKey).toContain(spoofedFromKey);
    const decision = decideEvidenceCaseId(LEDGER, [spoofedFromKey]);
    expect(decision.ok).toBe(false);
    if (decision.ok) expect(decision.caseId).not.toBe(spoofedFromKey);
  });

  it("accepts a caller caseId that matches the ledger", () => {
    const decision = decideEvidenceCaseId(LEDGER, [LEDGER]);
    expect(decision).toEqual({ ok: true, caseId: LEDGER });
  });

  it("accepts an omitted caller caseId and uses only the ledger", () => {
    const decision = decideEvidenceCaseId(LEDGER, null);
    expect(decision).toEqual({ ok: true, caseId: LEDGER });
  });

  it("fails closed when the ledger case_id is null", () => {
    const decision = decideEvidenceCaseId(null, null);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.status).toBe(403);
      expect(decision.code).toBe("ledger_case_missing");
    }
  });

  it("fails closed when the ledger case_id is blank", () => {
    const decision = decideEvidenceCaseId("   ", [LEDGER]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("ledger_case_missing");
  });

  it("treats a non-string caller caseId as a mismatch", () => {
    const decision = decideEvidenceCaseId(LEDGER, [{ case: LEDGER }]);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.code).toBe("case_id_mismatch");
  });
});

describe("collectSuppliedCaseIds", () => {
  it("returns null when case identity is omitted", () => {
    expect(collectSuppliedCaseIds({ record: { id: "ev-1" } })).toBeNull();
  });

  it("collects caseId, case_id, and record.case_id", () => {
    expect(
      collectSuppliedCaseIds({
        caseId: SPOOF,
        case_id: LEDGER,
        record: { case_id: LEDGER },
      }),
    ).toEqual([SPOOF, LEDGER, LEDGER]);
  });
});
