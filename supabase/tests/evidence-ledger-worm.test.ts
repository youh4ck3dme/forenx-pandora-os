// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

/** Runs `fn` as an API request of `userId` (role authenticated + JWT sub), then commits. */
async function asUser<T>(userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

async function insertEvidence(
  userId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const caseId = await createCase(db, userId);
  const row = {
    investigator_id: userId,
    case_id: caseId,
    case_name: "CASE-1",
    file_name: "spis.pdf",
    file_size: 1234,
    mime_type: "application/pdf",
    s3_object_key: `cases/c1/${Math.random().toString(36).slice(2)}.pdf`,
    sha256_hash: HASH_A,
    ...overrides,
  };
  const cols = Object.keys(row);
  return asUser(userId, async (tx) => {
    const res = await tx.query<{ id: string }>(
      `insert into public.evidence_items (${cols.join(", ")})
       values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(row),
    );
    const id = res.rows[0]?.id;
    if (!id) throw new Error("insert returned no id");
    return id;
  });
}

async function evidence(id: string) {
  const res = await db.query<Record<string, unknown>>(
    "select * from public.evidence_items where id = $1",
    [id],
  );
  return res.rows[0];
}

async function auditActions(recordId: string): Promise<string[]> {
  const res = await db.query<{ action: string }>(
    "select action from public.case_audit_log where record_id = $1 order by chain_seq",
    [recordId],
  );
  return res.rows.map((row) => row.action);
}

describe("evidence ledger: registration", () => {
  it("forces pending verification for client inserts and chains an audit event", async () => {
    const user = await createUser(db, "reg@test.local");
    const id = await insertEvidence(user, {
      sha256_hash: HASH_A.toUpperCase(),
      hash_verification_status: "verified",
      verified_sha256: HASH_A,
    });
    const row = await evidence(id);
    expect(row?.hash_verification_status).toBe("pending");
    expect(row?.verified_sha256).toBeNull();
    expect(row?.sha256_hash).toBe(HASH_A);
    expect(await auditActions(id)).toEqual(["evidence_registered"]);
    const chain = await db.query("select * from public.verify_audit_chain($1)", [user]);
    expect(chain.rows).toEqual([]);
  });
});

describe("evidence ledger: WORM identity columns", () => {
  it.each([
    ["sha256_hash", `'${HASH_B}'`],
    ["s3_object_key", "'cases/c1/other.pdf'"],
    ["case_name", "'OTHER'"],
    ["file_size", "1"],
    ["created_at", "now() - interval '1 day'"],
    ["investigator_id", "gen_random_uuid()"],
  ])("owner cannot change %s", async (column, value) => {
    const user = await createUser(db, `worm-${column}@test.local`);
    const id = await insertEvidence(user);
    await expect(
      asUser(user, (tx) =>
        tx.query(`update public.evidence_items set ${column} = ${value} where id = $1`, [id]),
      ),
    ).rejects.toThrow(/write-once|row-level security/);
  });

  it("not even the database owner or service role can rewrite the hash", async () => {
    const user = await createUser(db, "worm-owner@test.local");
    const id = await insertEvidence(user);
    await expect(
      db.query("update public.evidence_items set sha256_hash = $1 where id = $2", [HASH_B, id]),
    ).rejects.toThrow(/write-once/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query("update public.evidence_items set s3_object_key = 'cases/x/y.pdf' where id = $1", [id]);
      }),
    ).rejects.toThrow(/write-once/);
    expect((await evidence(id))?.sha256_hash).toBe(HASH_A);
  });

  it("clients cannot set verification state or legal hold", async () => {
    const user = await createUser(db, "worm-verify@test.local");
    const id = await insertEvidence(user);
    await expect(
      asUser(user, (tx) =>
        tx.query("update public.evidence_items set hash_verification_status = 'verified' where id = $1", [id]),
      ),
    ).rejects.toThrow(/server only/);
  });
});

describe("evidence ledger: deletion", () => {
  it("direct DELETE is impossible for clients and for the database owner", async () => {
    const user = await createUser(db, "del-direct@test.local");
    const id = await insertEvidence(user);
    await expect(
      asUser(user, (tx) => tx.query("delete from public.evidence_items where id = $1", [id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("delete from public.evidence_items where id = $1", [id]),
    ).rejects.toThrow(/delete_evidence_item_audited/);
    expect(await evidence(id)).toBeDefined();
  });

  it("audited RPC refuses strangers, short reasons and legal hold", async () => {
    const owner = await createUser(db, "del-owner@test.local");
    const stranger = await createUser(db, "del-stranger@test.local");
    const id = await insertEvidence(owner);
    const held = await insertEvidence(owner);
    await db.query("update public.evidence_items set legal_hold = true where id = $1", [held]);

    await expect(
      asUser(stranger, (tx) =>
        tx.query("select public.delete_evidence_item_audited($1, $2)", [id, "Duplicitný upload spisu"]),
      ),
    ).rejects.toThrow(/not found or access denied/);
    await expect(
      asUser(owner, (tx) => tx.query("select public.delete_evidence_item_audited($1, $2)", [id, "krátke"])),
    ).rejects.toThrow(/10-1000/);
    await expect(
      asUser(owner, (tx) =>
        tx.query("select public.delete_evidence_item_audited($1, $2)", [held, "Duplicitný upload spisu"]),
      ),
    ).rejects.toThrow(/legal hold/);
    expect(await evidence(id)).toBeDefined();
    expect(await evidence(held)).toBeDefined();
  });

  it("deletes with a hash-chained audit snapshot in the same transaction", async () => {
    const owner = await createUser(db, "del-ok@test.local");
    const id = await insertEvidence(owner);
    const event = await asUser(owner, async (tx) => {
      const res = await tx.query<{ event: string }>(
        "select public.delete_evidence_item_audited($1, $2, 'corr-del') as event",
        [id, "Duplicitný upload toho istého spisu"],
      );
      return res.rows[0]?.event;
    });
    expect(event).toMatch(/^[0-9a-f-]{36}$/);
    expect(await evidence(id)).toBeUndefined();

    const audit = await db.query<{ action: string; changes: Record<string, unknown>; correlation_id: string }>(
      "select action, changes, correlation_id from public.case_audit_log where event_id = $1",
      [event],
    );
    const row = audit.rows[0];
    expect(row?.action).toBe("evidence_deleted");
    expect(row?.correlation_id).toBe("corr-del");
    expect(row?.changes.reason).toBe("Duplicitný upload toho istého spisu");
    expect((row?.changes.snapshot as { sha256_hash: string }).sha256_hash).toBe(HASH_A);
    expect(await auditActions(id)).toEqual(["evidence_registered", "evidence_deleted"]);
    const chain = await db.query("select * from public.verify_audit_chain($1)", [owner]);
    expect(chain.rows).toEqual([]);
  });
});

describe("evidence ledger: server-side hash verification", () => {
  it("is callable by service_role only", async () => {
    const user = await createUser(db, "ver-perm@test.local");
    const id = await insertEvidence(user);
    await expect(
      asUser(user, (tx) =>
        tx.query("select public.record_evidence_verification($1, 'verified', $2, 1234)", [id, HASH_A]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("accepts 'verified' only for a matching hash and size, records mismatches", async () => {
    const user = await createUser(db, "ver@test.local");
    const good = await insertEvidence(user);
    const bad = await insertEvidence(user);
    const asService = <T>(fn: (tx: Transaction) => Promise<T>) =>
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        return fn(tx);
      });

    await expect(
      asService((tx) =>
        tx.query("select public.record_evidence_verification($1, 'verified', $2, 1234)", [bad, HASH_B]),
      ),
    ).rejects.toThrow(/requires matching/);
    await asService((tx) =>
      tx.query("select public.record_evidence_verification($1, 'mismatch', $2, 1234)", [bad, HASH_B]),
    );
    await asService((tx) =>
      tx.query("select public.record_evidence_verification($1, 'verified', $2, 1234)", [good, HASH_A]),
    );

    expect((await evidence(bad))?.hash_verification_status).toBe("mismatch");
    expect((await evidence(bad))?.verified_sha256).toBe(HASH_B);
    expect((await evidence(good))?.hash_verification_status).toBe("verified");
    expect(await auditActions(bad)).toEqual(["evidence_registered", "evidence_hash_mismatch"]);
    expect(await auditActions(good)).toEqual(["evidence_registered", "evidence_hash_verified"]);
  });
});

describe("evidence ledger: review hardening", () => {
  it("a client cannot register evidence already under legal hold", async () => {
    const user = await createUser(db, "hold-insert@test.local");
    const id = await insertEvidence(user, { legal_hold: true });
    expect((await evidence(id))?.legal_hold).toBe(false);
  });

  it("rejects a malformed hash on insert", async () => {
    const user = await createUser(db, "bad-hash@test.local");
    await expect(insertEvidence(user, { sha256_hash: "not-a-hash" })).rejects.toThrow(/64 hex/);
  });

  it("service_role cannot delete directly, even after setting the bypass GUC", async () => {
    const user = await createUser(db, "guc-service@test.local");
    const id = await insertEvidence(user);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query("select set_config('forenx.evidence_delete', 'on', true)");
        await tx.query("delete from public.evidence_items where id = $1", [id]);
      }),
    ).rejects.toThrow(/permission denied/);
    expect(await evidence(id)).toBeDefined();
  });

  it("the GUC is not a bypass for a non-owner role even with a DELETE grant", async () => {
    const user = await createUser(db, "guc-grant@test.local");
    const id = await insertEvidence(user);
    await db.exec("grant delete on public.evidence_items to authenticated");
    try {
      await expect(
        asUser(user, async (tx) => {
          await tx.query("select set_config('forenx.evidence_delete', 'on', true)");
          await tx.query("delete from public.evidence_items where id = $1", [id]);
        }),
      ).rejects.toThrow(/delete_evidence_item_audited/);
    } finally {
      await db.exec("revoke delete on public.evidence_items from authenticated");
    }
    expect(await evidence(id)).toBeDefined();
  });

  it("service_role cannot erase audit entries by setting forenx.audit_erasure", async () => {
    const user = await createUser(db, "guc-audit@test.local");
    await insertEvidence(user);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query("select set_config('forenx.audit_erasure', 'on', true)");
        await tx.query("delete from public.case_audit_log where user_id = $1", [user]);
      }),
    ).rejects.toThrow(/permission denied/);
    const left = await db.query<{ n: number }>(
      "select count(*)::int as n from public.case_audit_log where user_id = $1",
      [user],
    );
    expect(left.rows[0]?.n).toBe(1);
  });

  it("a legacy row with a non-canonical hash can still receive a verification result", async () => {
    const user = await createUser(db, "legacy@test.local");
    await db.exec("alter table public.evidence_items disable trigger evidence_items_insert_guard");
    let id: string | undefined;
    try {
      const res = await db.query<{ id: string }>(
        `insert into public.evidence_items
           (investigator_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
         values ($1, 'LEGACY', 'old.pdf', 10, 'application/pdf', 'cases/c1/old.pdf', 'LEGACY-NOT-HEX')
         returning id`,
        [user],
      );
      id = res.rows[0]?.id;
    } finally {
      await db.exec("alter table public.evidence_items enable trigger evidence_items_insert_guard");
    }
    await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      await tx.query("select public.record_evidence_verification($1, 'mismatch', $2, 10)", [id, HASH_B]);
    });
    expect((await evidence(String(id)))?.hash_verification_status).toBe("mismatch");
  });

  describe("evidence ledger: case_id relational integrity and WORM protection", () => {
    it("successfully links evidence to an existing case and records case_id in audit log", async () => {
      const user = await createUser(db, "case-owner@test.local");
      const caseId = await createCase(db, user);

      const id = await insertEvidence(user, {
        case_id: caseId,
        s3_object_key: `cases/${caseId}/evidence/${Math.random().toString(36).slice(2)}.pdf`,
      });

      const row = await evidence(id);
      expect(row?.case_id).toBe(caseId);

      // Verify case_audit_log captured case_id
      const auditRes = await db.query<{ case_id: string }>(
        "select case_id from public.case_audit_log where record_id = $1 and action = 'evidence_registered'",
        [id],
      );
      expect(auditRes.rows[0]?.case_id).toBe(caseId);
    });

    it("rejects insert with non-existent case_id foreign key", async () => {
      const user = await createUser(db, "fk-test@test.local");
      const nonExistentCaseId = "00000000-0000-4000-8000-000000009999";

      await expect(
        insertEvidence(user, {
          case_id: nonExistentCaseId,
        }),
      ).rejects.toThrow();
    });

    it("enforces WORM write-once immutability on case_id (cannot be modified via update)", async () => {
      const user = await createUser(db, "worm-case@test.local");
      const case1 = await createCase(db, user);
      const case2 = await createCase(db, user);

      const id = await insertEvidence(user, {
        case_id: case1,
      });

      // Modifying case_id must throw WORM violation error
      await expect(
        asUser(user, (tx) =>
          tx.query("update public.evidence_items set case_id = $1 where id = $2", [case2, id]),
        ),
      ).rejects.toThrow(/write-once \(WORM\)/);

      const row = await evidence(id);
      expect(row?.case_id).toBe(case1);
    });

    it("rejects insert when case_id belongs to a different investigator (cross-tenant spoof)", async () => {
      const owner = await createUser(db, "case-owner-ct@test.local");
      const attacker = await createUser(db, "attacker-ct@test.local");
      const ownerCase = await createCase(db, owner);

      // attacker tries to insert evidence attributed to ownerCase — must be rejected
      await expect(
        insertEvidence(attacker, {
          case_id: ownerCase,
          s3_object_key: `cases/${ownerCase}/evidence/stolen.pdf`,
        }),
      ).rejects.toThrow(/does not belong to the authenticated user/);
    });

    it("rejects NULL case_id for new evidence records", async () => {
      const user = await createUser(db, "null-case-ct@test.local");
      await expect(insertEvidence(user, { case_id: null })).rejects.toThrow(/case_id is required/);
    });
  });
});
