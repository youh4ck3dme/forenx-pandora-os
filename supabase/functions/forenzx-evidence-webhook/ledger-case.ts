/**
 * Ledger-authoritative case identity for the ForenZX evidence webhook.
 *
 * caseId is taken only from evidence_items.case_id. Caller caseId / case_id
 * values are compared and rejected on mismatch. S3 object keys are never
 * parsed into a case identity.
 */

const CASE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export type CaseIdDecision =
  | { ok: true; caseId: string }
  | { ok: false; status: 403; code: "ledger_case_missing"; error: string }
  | { ok: false; status: 400; code: "case_id_mismatch"; error: string };

type CaseBody = {
  caseId?: unknown;
  case_id?: unknown;
  record?: { case_id?: unknown } | null;
};

/** Returns supplied case identifiers, or null when the caller omitted all of them. */
export function collectSuppliedCaseIds(body: CaseBody | null | undefined): unknown[] | null {
  if (!body || typeof body !== "object") return null;
  const supplied: unknown[] = [];
  let present = false;
  if (Object.prototype.hasOwnProperty.call(body, "caseId")) {
    present = true;
    supplied.push(body.caseId);
  }
  if (Object.prototype.hasOwnProperty.call(body, "case_id")) {
    present = true;
    supplied.push(body.case_id);
  }
  const record = body.record;
  if (
    record &&
    typeof record === "object" &&
    Object.prototype.hasOwnProperty.call(record, "case_id")
  ) {
    present = true;
    supplied.push(record.case_id);
  }
  return present ? supplied : null;
}

export function decideEvidenceCaseId(
  ledgerCaseId: unknown,
  suppliedCaseIds: unknown[] | null,
): CaseIdDecision {
  const ledger = typeof ledgerCaseId === "string" ? ledgerCaseId.trim() : "";
  if (!ledger || !CASE_ID.test(ledger)) {
    return {
      ok: false,
      status: 403,
      code: "ledger_case_missing",
      error: "Ledger case_id is missing or invalid; refusing to start a job",
    };
  }

  if (suppliedCaseIds) {
    for (const value of suppliedCaseIds) {
      const supplied = typeof value === "string" ? value.trim() : "";
      if (supplied !== ledger) {
        return {
          ok: false,
          status: 400,
          code: "case_id_mismatch",
          error: "CASE_ID_MISMATCH: Supplied caseId does not match canonical ledger",
        };
      }
    }
  }

  return { ok: true, caseId: ledger };
}
