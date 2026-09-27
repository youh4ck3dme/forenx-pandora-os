// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createUser, freshDatabase } from "./harness";

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
  const row = {
    investigator_id: userId,
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
