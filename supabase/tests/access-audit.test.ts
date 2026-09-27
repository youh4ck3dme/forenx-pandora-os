// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

async function asUser(userId: string | null) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
    userId ?? "",
  ]);
}

async function logAccess(
  caseId: string,
  action: string,
  legalBasis = "§ 119 ods. 2 TP; GDPR čl. 6(1)(e), čl. 9(2)(f)",
  sourceIp = "203.0.113.10",
  userAgent = "PandoraBrowser/2.0 (ForenX)",
): Promise<unknown> {
  return db.query("select public.log_case_access($1, $2, $3, $4, $5)", [
    caseId,
    action,
    legalBasis,
    sourceIp,
    userAgent,
  ]);
}

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

type AccessRow = {
  action: string;
  created_at: string;
  changes: {
    actor: string;
    kind: string;
    legal_basis: string;
    source_ip: string | null;
    user_agent: string | null;
  };
};

async function accessRows(caseId: string): Promise<AccessRow[]> {
  const result = await db.query<AccessRow>(
    "select action, created_at, changes from public.case_audit_log " +
      "where case_id = $1 and action like 'case_access_%' order by chain_seq",
    [caseId],
  );
  return result.rows;
}

describe("access audit log (P1-04)", () => {
  it("rejects unauthenticated access logging", async () => {
    const user = await createUser(db, "owner@audit.test");
    const caseId = await createCase(db, user);
    await asUser(null);

    await expectDbError(
      () => logAccess(caseId, "view"),
      /Chýba overenie identity/,
    );
    expect(await accessRows(caseId)).toEqual([]);
  });

  it("writes a structured view record for the case owner", async () => {
    const user = await createUser(db, "view@audit.test");
    const caseId = await createCase(db, user);
    await asUser(user);

    await logAccess(caseId, "view", undefined, "198.51.100.7", "UA-Test/1.0");

    const rows = await accessRows(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("case_access_view");
    expect(rows[0]?.changes).toEqual({
      actor: user,
      kind: "view",
      legal_basis: "§ 119 ods. 2 TP; GDPR čl. 6(1)(e), čl. 9(2)(f)",
      source_ip: "198.51.100.7",
      user_agent: "UA-Test/1.0",
    });
    // Timestamp je serverový UTC (nastaví reťazový trigger, nie klient).
    expect(Number.isNaN(Date.parse(rows[0]?.created_at))).toBe(false);
  });

  it("writes a structured export record with a custom legal basis", async () => {
    const user = await createUser(db, "export@audit.test");
    const caseId = await createCase(db, user);
    await asUser(user);

    await logAccess(caseId, "export", "§ 165 TP — vyhotovenie odpisu", "192.0.2.5");

    const rows = await accessRows(caseId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe("case_access_export");
    expect(rows[0]?.changes.kind).toBe("export");
    expect(rows[0]?.changes.legal_basis).toBe("§ 165 TP — vyhotovenie odpisu");
    expect(rows[0]?.changes.source_ip).toBe("192.0.2.5");
  });

  it("rejects a stranger and accepts an administrator", async () => {
    const owner = await createUser(db, "case-owner@audit.test");
    const stranger = await createUser(db, "stranger@audit.test");
    const admin = await createUser(db, "audit-admin@audit.test");
    await db.query(
      "insert into public.user_roles (user_id, role) values ($1, 'admin')",
      [admin],
    );
    const caseId = await createCase(db, owner);

    await asUser(stranger);
    await expectDbError(
      () => logAccess(caseId, "view"),
      /Nemáte oprávnenie na túto operáciu/,
    );

    await asUser(admin);
    await logAccess(caseId, "view", undefined, "203.0.113.99");
    expect((await accessRows(caseId)).length).toBe(1);
  });

  it("rejects unknown action kinds and an empty legal basis", async () => {
    const user = await createUser(db, "validation@audit.test");
    const caseId = await createCase(db, user);
    await asUser(user);

    await expectDbError(() => logAccess(caseId, "delete"), /Neplatný typ prístupu/);
    await expectDbError(
      () => logAccess(caseId, "view", "  "),
      /vyžaduje právny základ/,
    );
    expect(await accessRows(caseId)).toEqual([]);
  });

  it("keeps the audit chain verifiable and the records immutable", async () => {
    const user = await createUser(db, "chain@audit.test");
    const caseId = await createCase(db, user);
    await asUser(user);
    await logAccess(caseId, "view");
    await logAccess(caseId, "export");

    const broken = await db.query<{ chain_seq: number }>(
      "select chain_seq from public.verify_audit_chain($1)",
      [user],
    );
    expect(broken.rows).toEqual([]);

    await expectDbError(
      () =>
        db.query(
          "update public.case_audit_log set changes = '{}' where case_id = $1",
          [caseId],
        ),
      /append-only/,
    );
    await expectDbError(
      () =>
        db.query("delete from public.case_audit_log where case_id = $1", [
          caseId,
        ]),
      /append-only/,
    );
  });
});
