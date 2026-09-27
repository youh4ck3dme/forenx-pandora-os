// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

/** Simuluje JWT prihláseného používateľa (auth.uid()). */
async function asUser(userId: string | null) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? "",
  ]);
}

async function makeAdmin(userId: string) {
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'admin')",
    [userId],
  );
}

async function statusOf(caseId: string): Promise<string> {
  const result = await db.query<{ status: string }>(
    "select status from public.cases where id = $1",
    [caseId],
  );
  return result.rows[0]?.status ?? "missing";
}

async function setStatus(
  caseId: string,
  status: string,
  reason = "",
): Promise<unknown> {
  return db.query("select public.set_case_status($1, $2, $3)", [
    caseId,
    status,
    reason,
  ]);
}

async function destroy(caseId: string, reason: string): Promise<unknown> {
  return db.query("select public.destroy_case($1, $2)", [caseId, reason]);
}

async function insertEntity(caseId: string, userId: string) {
  await db.query(
    "insert into public.case_entities (case_id, user_id, name, kind, role, x, y) " +
      "values ($1, $2, 'Test s.r.o.', 'company', 'odberateľ', 10, 10)",
    [caseId, userId],
  );
}

async function auditActions(caseId: string): Promise<string[]> {
  const result = await db.query<{ action: string }>(
    "select action from public.case_audit_log where case_id = $1 order by chain_seq",
    [caseId],
  );
  return result.rows.map((row) => row.action);
}

/** Vyžaduje, že dotaz zlyhá so správou zodpovedajúcou regulárnemu výrazu. */
async function expectDbError(
  run: () => Promise<unknown>,
  message: RegExp,
): Promise<void> {
  let threw: unknown = null;
  try {
    await run();
  } catch (error) {
    threw = error;
  }
  if (!threw) throw new Error("Očakával sa chybový stav databázy.");
  const text = threw instanceof Error ? threw.message : String(threw);
  expect(text).toMatch(message);
}

describe("case lifecycle (P1-03)", () => {
  it("new cases start as draft", async () => {
    const user = await createUser(db, "draft@test.local");
    const caseId = await createCase(db, user);
    expect(await statusOf(caseId)).toBe("draft");
  });

  it("follows the transition map and writes audit entries", async () => {
    const user = await createUser(db, "lifecycle@test.local");
    const caseId = await createCase(db, user);
    await asUser(user);

    await setStatus(caseId, "closed", "dokončené vyšetrovanie");
    expect(await statusOf(caseId)).toBe("closed");

    await setStatus(caseId, "draft");
    expect(await statusOf(caseId)).toBe("draft");

    await setStatus(caseId, "legal_hold", "súdny príkaz 12C/2026");
    expect(await statusOf(caseId)).toBe("legal_hold");

    await expectDbError(
      () => setStatus(caseId, "draft"),
      /Zmena stavu „legal_hold“ → „draft“ nie je povolená/,
    );

    expect(await auditActions(caseId)).toEqual([
      "case_status_changed",
      "case_status_changed",
      "case_status_changed",
    ]);
  });

  it("rejects status changes outside the lifecycle RPCs", async () => {
    const user = await createUser(db, "rawupdate@test.local");
    const caseId = await createCase(db, user);
    await asUser(user);

    await expectDbError(
      () =>
        db.query("update public.cases set status = 'closed' where id = $1", [
          caseId,
        ]),
      /sa smie meniť iba cez set_case_status \/ destroy_case/,
    );
    expect(await statusOf(caseId)).toBe("draft");
  });

  it("legal hold blocks every mutation and deletion path", async () => {
    const user = await createUser(db, "hold@test.local");
    const caseId = await createCase(db, user);
    await insertEntity(caseId, user);
    await asUser(user);

    await setStatus(caseId, "legal_hold", "lítiga BC-77");

    await expectDbError(
      () => insertEntity(caseId, user),
      /Prípad je v stave „legal_hold“ — zmeny dát prípadu nie sú povolené/,
    );
    await expectDbError(
      () =>
        db.query("update public.cases set name = 'X' where id = $1", [caseId]),
      /obsahové zmeny nie sú povolené/,
    );
    await expectDbError(
      () =>
        db.query("update public.case_entities set name = 'X' where case_id = $1", [
          caseId,
        ]),
      /zmeny dát prípadu nie sú povolené/,
    );
    await expectDbError(
      () => db.query("delete from public.case_entities where case_id = $1", [caseId]),
      /zmeny dát prípadu nie sú povolené/,
    );
    await expectDbError(
      () => db.query("delete from public.cases where id = $1", [caseId]),
      /kontrolovaným zničením/,
    );
  });

  it("only an administrator can release a legal hold", async () => {
    const user = await createUser(db, "owner@test.local");
    const admin = await createUser(db, "admin@test.local");
    await makeAdmin(admin);
    const caseId = await createCase(db, user);
    await asUser(user);
    await setStatus(caseId, "legal_hold", "blokácia");

    await expectDbError(
      () => setStatus(caseId, "closed"),
      /Legal hold môže zrušiť iba administrátor/,
    );
    expect(await statusOf(caseId)).toBe("legal_hold");

    await asUser(admin);
    await setStatus(caseId, "closed", "hold zrušený");
    expect(await statusOf(caseId)).toBe("closed");
  });

  it("closed cases are read-only until reopened", async () => {
    const user = await createUser(db, "closed@test.local");
    const caseId = await createCase(db, user);
    await asUser(user);
    await setStatus(caseId, "closed");

    await expectDbError(
      () => insertEntity(caseId, user),
      /Prípad je v stave „closed“/,
    );

    await setStatus(caseId, "draft");
    await insertEntity(caseId, user);
    expect(await statusOf(caseId)).toBe("draft");
  });

  it("controlled destruction requires an admin and an archived case", async () => {
    const user = await createUser(db, "destroy-owner@test.local");
    const admin = await createUser(db, "destroy-admin@test.local");
    await makeAdmin(admin);
    const caseId = await createCase(db, user);
    await insertEntity(caseId, user);

    await asUser(user);
    await expectDbError(
      () => destroy(caseId, "likvidácia po lehote"),
      /schválenie administrátora/,
    );

    await asUser(admin);
    await expectDbError(
      () => destroy(caseId, "likvidácia po lehote"),
      /iba archivovaný prípad/,
    );

    await setStatus(caseId, "closed", "prípad uzavretý");
    await setStatus(caseId, "archived", "uplynula retenčná lehota");
    await destroy(caseId, "Nyírád 22/2026 — rozhodnutie o likvidácii");

    const gone = await db.query<{ n: number }>(
      "select count(*)::int as n from public.cases where id = $1",
      [caseId],
    );
    expect(gone.rows[0]?.n).toBe(0);

    const children = await db.query<{ n: number }>(
      "select count(*)::int as n from public.case_entities where case_id = $1",
      [caseId],
    );
    expect(children.rows[0]?.n).toBe(0);

    // Audit prežíva kaskádu a zaznamenáva zničenie.
    expect(await auditActions(caseId)).toEqual([
      "case_status_changed",
      "case_status_changed",
      "case_destroyed",
    ]);
    const destroyed = await db.query<{
      reason: string;
      actor: string;
      records: unknown;
    }>(
      "select changes->>'reason' as reason, changes->>'actor' as actor, changes->'records' as records " +
        "from public.case_audit_log where case_id = $1 and action = 'case_destroyed'",
      [caseId],
    );
    expect(destroyed.rows[0]?.reason).toBe(
      "Nyírád 22/2026 — rozhodnutie o likvidácii",
    );
    expect(destroyed.rows[0]?.actor).toBe(admin);
  });

  it("keeps the audit chain verifiable after lifecycle operations", async () => {
    const user = await createUser(db, "chain@test.local");
    const caseId = await createCase(db, user);
    await asUser(user);
    await setStatus(caseId, "closed");
    await setStatus(caseId, "archived");

    const broken = await db.query<{ chain_seq: number }>(
      "select chain_seq from public.verify_audit_chain($1)",
      [user],
    );
    expect(broken.rows).toEqual([]);
  });

  it("still allows deleting a draft case directly", async () => {
    const user = await createUser(db, "draftdelete@test.local");
    const caseId = await createCase(db, user);
    await insertEntity(caseId, user);
    await asUser(user);

    await db.query("delete from public.cases where id = $1", [caseId]);
    const gone = await db.query<{ n: number }>(
      "select count(*)::int as n from public.cases where id = $1",
      [caseId],
    );
    expect(gone.rows[0]?.n).toBe(0);
  });
});
