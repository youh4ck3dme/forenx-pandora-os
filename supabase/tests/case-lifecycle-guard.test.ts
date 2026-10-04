// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

/**
 * Every test uses a NEW database session in which `forenx.lifecycle_rpc` was never
 * set — exactly the state of a fresh API request in production. (The P1-03 tests
 * share one session, where an earlier RPC leaves the GUC at '' instead of NULL,
 * which hid the fail-open guard.)
 */
async function freshSession() {
  const db = await freshDatabase();
  const owner = await createUser(db, "owner@test.local");
  const caseId = await createCase(db, owner);
  return { db, owner, caseId };
}

/** One API request of `userId`: role authenticated + JWT sub, own transaction. */
function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

async function statusOf(db: PGlite, caseId: string): Promise<string> {
  const res = await db.query<{ status: string }>("select status from public.cases where id = $1", [caseId]);
  return res.rows[0]?.status ?? "missing";
}

/**
 * A case already under legal hold, created WITHOUT calling an RPC: calling
 * set_case_status would leave the GUC at '' in this session and mask the bug.
 */
async function heldCase(db: PGlite, owner: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    "insert into public.cases (user_id, name, status) values ($1, 'Held', 'legal_hold') returning id",
    [owner],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("insert returned no id");
  const guc = await db.query<{ v: string | null }>("select current_setting('forenx.lifecycle_rpc', true) as v");
  if (guc.rows[0]?.v !== null) throw new Error("test setup touched the lifecycle GUC");
  return id;
}

async function holdCase(db: PGlite, owner: string, caseId: string) {
  await asUser(db, owner, (tx) =>
    tx.query("select public.set_case_status($1, 'legal_hold', 'Súdny príkaz')", [caseId]),
  );
}

describe("case lifecycle guard (fresh session, GUC never set)", () => {
  it("the GUC really is NULL in a fresh session", async () => {
    const { db } = await freshSession();
    const res = await db.query<{ v: string | null }>(
      "select current_setting('forenx.lifecycle_rpc', true) as v",
    );
    expect(res.rows[0]?.v).toBeNull();
  }, 60_000);

  it("rejects a direct status change by the owner", async () => {
    const { db, owner, caseId } = await freshSession();
    await expect(
      asUser(db, owner, (tx) => tx.query("update public.cases set status = 'closed' where id = $1", [caseId])),
    ).rejects.toThrow(/iba cez set_case_status/);
    expect(await statusOf(db, caseId)).toBe("draft");
  }, 60_000);

  it("rejects releasing a legal hold by a direct UPDATE", async () => {
    const { db, owner } = await freshSession();
    const caseId = await heldCase(db, owner);
    await expect(
      asUser(db, owner, (tx) => tx.query("update public.cases set status = 'draft' where id = $1", [caseId])),
    ).rejects.toThrow(/iba cez set_case_status/);
    expect(await statusOf(db, caseId)).toBe("legal_hold");
  }, 60_000);

  it("rejects deleting a case under legal hold by a direct DELETE", async () => {
    const { db, owner } = await freshSession();
    const caseId = await heldCase(db, owner);
    await expect(
      asUser(db, owner, (tx) => tx.query("delete from public.cases where id = $1", [caseId])),
    ).rejects.toThrow(/destroy_case/);
    expect(await statusOf(db, caseId)).toBe("legal_hold");
  }, 60_000);

  it("setting the GUC from a client session is not a bypass", async () => {
    const { db, owner } = await freshSession();
    const caseId = await heldCase(db, owner);
    await expect(
      asUser(db, owner, async (tx) => {
        await tx.query("select set_config('forenx.lifecycle_rpc', 'on', true)");
        await tx.query("update public.cases set status = 'draft' where id = $1", [caseId]);
      }),
    ).rejects.toThrow(/iba cez set_case_status/);
    await expect(
      asUser(db, owner, async (tx) => {
        await tx.query("select set_config('forenx.lifecycle_rpc', 'on', true)");
        await tx.query("delete from public.cases where id = $1", [caseId]);
      }),
    ).rejects.toThrow(/destroy_case/);
    expect(await statusOf(db, caseId)).toBe("legal_hold");
  }, 60_000);

  it("status_reason / status_changed_at are not directly editable", async () => {
    const { db, owner } = await freshSession();
    const caseId = await heldCase(db, owner);
    await expect(
      asUser(db, owner, (tx) =>
        tx.query("update public.cases set status_reason = 'prepísané' where id = $1", [caseId]),
      ),
    ).rejects.toThrow(/iba cez set_case_status/);
  }, 60_000);

  it("a client cannot create a case that already starts under legal hold", async () => {
    const { db, owner } = await freshSession();
    await expect(
      asUser(db, owner, (tx) =>
        tx.query("insert into public.cases (user_id, name, status) values ($1, 'X', 'legal_hold')", [owner]),
      ),
    ).rejects.toThrow(/musí začínať v stave/);
  }, 60_000);
});

describe("case lifecycle RPCs still work after hardening", () => {
  it("owner moves draft → closed → draft; admin releases a hold and destroys an archived case", async () => {
    const { db, owner, caseId } = await freshSession();
    const admin = await createUser(db, "admin@test.local");
    await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [admin]);

    await asUser(db, owner, (tx) => tx.query("select public.set_case_status($1, 'closed', 'Hotovo')", [caseId]));
    expect(await statusOf(db, caseId)).toBe("closed");
    await asUser(db, owner, (tx) => tx.query("select public.set_case_status($1, 'draft', 'Doplnenie')", [caseId]));
    expect(await statusOf(db, caseId)).toBe("draft");

    await holdCase(db, owner, caseId);
    await expect(
      asUser(db, owner, (tx) => tx.query("select public.set_case_status($1, 'closed', 'x')", [caseId])),
    ).rejects.toThrow(/iba administrátor/);
    await asUser(db, admin, (tx) => tx.query("select public.set_case_status($1, 'archived', 'Archív')", [caseId]));
    expect(await statusOf(db, caseId)).toBe("archived");

    await asUser(db, admin, (tx) => tx.query("select public.destroy_case($1, 'Uplynula lehota')", [caseId]));
    expect(await statusOf(db, caseId)).toBe("missing");

    const audit = await db.query<{ action: string }>(
      "select action from public.case_audit_log where case_id = $1 order by chain_seq",
      [caseId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "case_status_changed",
      "case_status_changed",
      "case_status_changed",
      "case_status_changed",
      "case_destroyed",
    ]);
    const chain = await db.query("select * from public.verify_audit_chain($1)", [owner]);
    expect(chain.rows).toEqual([]);
  }, 60_000);

  it("the owner can still delete a draft case directly", async () => {
    const { db, owner, caseId } = await freshSession();
    await asUser(db, owner, (tx) => tx.query("delete from public.cases where id = $1", [caseId]));
    expect(await statusOf(db, caseId)).toBe("missing");
  }, 60_000);
});
