// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CommitEvidenceSchema,
  escapeLike,
  evidenceStorageKey,
  integrityStatusOf,
  ledgerRowToItem,
  registerEvidence,
  sanitizeEvidenceFileName,
  type LedgerDeps,
  type LedgerRow,
} from "../storage/evidence-ledger";

const CASE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const SHA = "ab".repeat(32);

function input(overrides: Record<string, unknown> = {}) {
  return CommitEvidenceSchema.parse({
    caseId: CASE,
    storageKey: evidenceStorageKey(CASE, SHA, "spis č.1.pdf"),
    fileName: "spis č.1.pdf",
    fileSizeBytes: 2048,
    mimeType: "application/pdf",
    sha256Hash: SHA,
    ...overrides,
  });
}

function row(overrides: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    case_name: "Prípad X",
    file_name: "spis č.1.pdf",
    file_size: 2048,
    mime_type: "application/pdf",
    s3_object_key: evidenceStorageKey(CASE, SHA, "spis č.1.pdf"),
    sha256_hash: SHA,
    hash_verification_status: "pending",
    created_at: "2026-09-27T12:00:00.000Z",
    ...overrides,
  };
}

function deps(overrides: Partial<LedgerDeps> = {}) {
  const inserted: Parameters<LedgerDeps["insert"]>[0][] = [];
  const d: LedgerDeps = {
    caseOf: async () => ({ ok: true, userId: USER, name: "Prípad X" }),
    findByKey: async () => null,
    insert: async (r) => {
      inserted.push(r);
      return row();
    },
    ...overrides,
  };
  return { d, inserted };
}

describe("evidence storage key", () => {
  it("is deterministic, lowercases the hash and sanitises the file name", () => {
    expect(sanitizeEvidenceFileName("spis č.1 (final).pdf")).toBe("spis__.1__final_.pdf");
    expect(evidenceStorageKey(CASE, SHA.toUpperCase(), "a b.pdf")).toBe(`cases/${CASE}/evidence/${SHA}-a_b.pdf`);
  });

  it("escapes LIKE wildcards so a prefix matches exactly one case", () => {
    expect(escapeLike("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(escapeLike(CASE)).toBe(CASE);
  });
});

describe("integrityStatusOf", () => {
  it("shows 'verified' only for a server-verified hash", () => {
    expect(integrityStatusOf("verified")).toBe("verified");
    expect(integrityStatusOf("pending")).toBe("checking");
    expect(integrityStatusOf("error")).toBe("checking");
    expect(integrityStatusOf("mismatch")).toBe("compromised");
    expect(integrityStatusOf("object_missing")).toBe("compromised");
    expect(integrityStatusOf("anything-else")).toBe("checking");
  });

  it("maps a ledger row to a UI item without claiming verification", () => {
    const item = ledgerRowToItem(row(), CASE, "forenx-vault-sk", USER);
    expect(item).toMatchObject({ caseId: CASE, integrityStatus: "checking", tags: ["zmluva"], s3Bucket: "forenx-vault-sk" });
  });
});

describe("CommitEvidenceSchema", () => {
  it("rejects oversize files, bad hashes and unknown fields", () => {
    expect(CommitEvidenceSchema.safeParse({ ...input(), fileSizeBytes: 251 * 1024 * 1024 }).success).toBe(false);
    expect(CommitEvidenceSchema.safeParse({ ...input(), sha256Hash: "xyz" }).success).toBe(false);
    expect(CommitEvidenceSchema.safeParse({ ...input(), legal_hold: true }).success).toBe(false);
  });
});

describe("registerEvidence", () => {
  it("inserts a canonical row for the case owner", async () => {
    const { d, inserted } = deps();
    const result = await registerEvidence(input({ sha256Hash: SHA.toUpperCase() }), USER, d);
    expect(result).toMatchObject({ ok: true, created: true });
    expect(inserted).toEqual([
      {
        investigator_id: USER,
        case_name: "Prípad X",
        file_name: "spis č.1.pdf",
        file_size: 2048,
        mime_type: "application/pdf",
        s3_object_key: `cases/${CASE}/evidence/${SHA}-spis__.1.pdf`,
        sha256_hash: SHA,
      },
    ]);
  });

  it("refuses a storage key that was not issued for this case, hash and file", async () => {
    const { d, inserted } = deps();
    for (const storageKey of [
      `cases/${CASE}/evidence/${"cd".repeat(32)}-spis__.1.pdf`,
      `cases/99999999-9999-4999-8999-999999999999/evidence/${SHA}-spis__.1.pdf`,
      `cases/${CASE}/evidence/../../other.pdf`,
    ]) {
      expect(await registerEvidence(input({ storageKey }), USER, d)).toMatchObject({ ok: false, status: 400 });
    }
    expect(inserted).toEqual([]);
  });

  it("maps ownership failures to 404 / 503 / 403 without inserting", async () => {
    const cases: [LedgerDeps["caseOf"], number][] = [
      [async () => ({ ok: false, reason: "not_found" }), 404],
      [async () => ({ ok: false, reason: "unavailable" }), 503],
      [async () => ({ ok: true, userId: "someone-else", name: "X" }), 403],
    ];
    for (const [caseOf, status] of cases) {
      const { d, inserted } = deps({ caseOf });
      expect(await registerEvidence(input(), USER, d)).toMatchObject({ ok: false, status });
      expect(inserted).toEqual([]);
    }
  });

  it("is idempotent for an already registered object", async () => {
    const existing = row({ id: "44444444-4444-4444-8444-444444444444", hash_verification_status: "verified" });
    const { d, inserted } = deps({ findByKey: async () => existing });
    expect(await registerEvidence(input(), USER, d)).toEqual({ ok: true, created: false, row: existing });
    expect(inserted).toEqual([]);
  });
});
