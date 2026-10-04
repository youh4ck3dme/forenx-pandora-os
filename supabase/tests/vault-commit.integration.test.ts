// @vitest-environment node
/**
 * Integration: the real POST /api/vault/commit handler against a real Postgres
 * (PGlite, all migrations) — inserts run as role `authenticated` with the user's
 * JWT sub, so RLS, the WORM/insert triggers and the audit hash chain all apply.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { handleCommitEvidence, type CommitHandlerDeps } from "@/lib/storage/evidence-commit";
import { escapeLike, evidenceStorageKey, type LedgerDeps, type LedgerRow } from "@/lib/storage/evidence-ledger";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;
const SHA = "cd".repeat(32);
const COLS =
  "id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash, hash_verification_status, created_at::text as created_at";

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

/** Ledger deps backed by PGlite; user-scoped queries run as `authenticated`. */
function pgliteLedger(userId: string): LedgerDeps {
  const asUser = <T>(fn: (q: (sql: string, params: unknown[]) => Promise<T[]>) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      return fn(async (sql, params) => (await tx.query<T>(sql, params)).rows);
    });
  return {
    caseOf: async (caseId) => {
      const res = await db.query<{ user_id: string; name: string }>(
        "select user_id, name from public.cases where id::text = $1",
        [caseId],
      );
      const found = res.rows[0];
      return found ? { ok: true, userId: found.user_id, name: found.name } : { ok: false, reason: "not_found" };
    },
    findByKey: (key) =>
      asUser<LedgerRow | null>(async (q) => {
        const rows = await q(`select ${COLS} from public.evidence_items where s3_object_key = $1 limit 1`, [key]);
        return (rows[0] as LedgerRow | undefined) ?? null;
      }),
    insert: (r) =>
      asUser<LedgerRow>(async (q) => {
        const rows = await q(
          `insert into public.evidence_items
             (investigator_id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${COLS}`,
          [r.investigator_id, r.case_id, r.case_name, r.file_name, r.file_size, r.mime_type, r.s3_object_key, r.sha256_hash],
        );
        const inserted = rows[0] as LedgerRow | undefined;
        if (!inserted) throw new Error("no row");
        return inserted;
      }),
  };
}

function handlerDeps(userId: string | null, overrides: Partial<CommitHandlerDeps> = {}): CommitHandlerDeps {
  return {
    authenticate: async () =>
      userId ? { userId, token: `token-for-${userId}` } : { userId: null, error: "Neautorizovaný prístup.", status: 401 },
    configured: () => true,
    isProduction: () => true,
    ledgerFor: async (token) => pgliteLedger(token.replace("token-for-", "")),
    ...overrides,
  };
}

function commitRequest(body: unknown): Request {
  return new Request("http://localhost/api/vault/commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body(caseId: string, fileName = "zmluva.pdf") {
  return {
    caseId,
    storageKey: evidenceStorageKey(caseId, SHA, fileName),
    fileName,
    fileSizeBytes: 4096,
    mimeType: "application/pdf",
    sha256Hash: SHA,
  };
}

describe("POST /api/vault/commit (integration, real Postgres + RLS)", () => {
  it("registers pending evidence with an audit event, idempotently", async () => {
    const user = await createUser(db, "commit-ok@test.local");
    const caseId = await createCase(db, user);

    const first = await handleCommitEvidence(commitRequest(body(caseId)), handlerDeps(user));
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created).toMatchObject({ persisted: true, created: true, hashVerificationStatus: "pending", integrityStatus: "checking" });

    const dbRow = await db.query<{ investigator_id: string; legal_hold: boolean; hash_verification_status: string; case_name: string }>(
      "select investigator_id, legal_hold, hash_verification_status, case_name from public.evidence_items where id = $1",
      [created.evidenceId],
    );
    expect(dbRow.rows[0]).toEqual({ investigator_id: user, legal_hold: false, hash_verification_status: "pending", case_name: "Test" });

    const audit = await db.query<{ action: string }>(
      "select action from public.case_audit_log where record_id = $1",
      [created.evidenceId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["evidence_registered"]);

    const again = await handleCommitEvidence(commitRequest(body(caseId)), handlerDeps(user));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ created: false, evidenceId: created.evidenceId });
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.evidence_items where s3_object_key = $1",
      [evidenceStorageKey(caseId, SHA, "zmluva.pdf")],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it("refuses another investigator's case and writes nothing", async () => {
    const owner = await createUser(db, "commit-owner@test.local");
    const intruder = await createUser(db, "commit-intruder@test.local");
    const caseId = await createCase(db, owner);
    const res = await handleCommitEvidence(commitRequest(body(caseId, "cudzi.pdf")), handlerDeps(intruder));
    expect(res.status).toBe(403);
    const rows = await db.query<{ n: number }>(
      "select count(*)::int as n from public.evidence_items where s3_object_key like $1",
      [`cases/${escapeLike(caseId)}/evidence/%`],
    );
    expect(rows.rows[0]?.n).toBe(0);
  });

  it("rejects a storage key that was not issued for the case/hash/file", async () => {
    const user = await createUser(db, "commit-key@test.local");
    const caseId = await createCase(db, user);
    const res = await handleCommitEvidence(
      commitRequest({ ...body(caseId), storageKey: `cases/${caseId}/evidence/other-object.pdf` }),
      handlerDeps(user),
    );
    expect(res.status).toBe(400);
  });

  it("requires authentication and a valid body", async () => {
    const unauth = await handleCommitEvidence(commitRequest(body("x")), handlerDeps(null));
    expect(unauth.status).toBe(401);
    const user = await createUser(db, "commit-body@test.local");
    const bad = await handleCommitEvidence(commitRequest({ caseId: "x" }), handlerDeps(user));
    expect(bad.status).toBe(400);
  });

  it("fails closed in production without a ledger, allows a dev no-op", async () => {
    const user = await createUser(db, "commit-cfg@test.local");
    const caseId = await createCase(db, user);
    const prod = await handleCommitEvidence(commitRequest(body(caseId)), handlerDeps(user, { configured: () => false }));
    expect(prod.status).toBe(503);
    const dev = await handleCommitEvidence(
      commitRequest(body(caseId)),
      handlerDeps(user, { configured: () => false, isProduction: () => false }),
    );
    expect(dev.status).toBe(200);
    expect(await dev.json()).toMatchObject({ persisted: false, integrityStatus: "checking" });
  });

  it("does not leak database details on failure", async () => {
    const user = await createUser(db, "commit-err@test.local");
    const caseId = await createCase(db, user);
    const res = await handleCommitEvidence(
      commitRequest(body(caseId)),
      handlerDeps(user, {
        ledgerFor: async () => ({
          ...pgliteLedger(user),
          insert: async () => {
            throw new Error("ledger_insert_failed:42501 secret detail");
          },
        }),
      }),
    );
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("42501");
  });
});
