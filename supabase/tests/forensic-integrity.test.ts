// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { buildAiGraphPlan } from "@/lib/forza/case-graph-plan";
import { createCase, createUser, freshDatabase, migrationFiles } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

type Plan = ReturnType<typeof buildAiGraphPlan>;

async function commitGraph(caseId: string, actor: string, plan: Plan) {
  return db.query<{ r: { entities: number; events: number; relations: number } }>(
    "select public.commit_ai_case_graph($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) as r",
    [
      caseId,
      actor,
      JSON.stringify(plan.entities),
      JSON.stringify(plan.events),
      JSON.stringify(plan.relations),
      "corr-test",
    ],
  );
}

async function count(table: string, caseId: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where case_id = $1`,
    [caseId],
  );
  return result.rows[0]?.n ?? -1;
}

describe("fresh migration chain", () => {
  it("applies every migration in order on a clean Postgres (no hosted functions)", async () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(16);
    const stub = await db.query<{ comment: string | null }>(
      "select obj_description('public.rls_auto_enable()'::regprocedure, 'pg_proc') as comment",
    );
    expect(stub.rows[0]?.comment).toMatch(/Inert stub/);
  });

  it("keeps the hosted rls_auto_enable() untouched when it already exists", async () => {
    const hosted = await freshDatabase({ hostedFunctions: true });
    const fn = await hosted.query<{ src: string; comment: string | null }>(
      `select prosrc as src, obj_description(oid, 'pg_proc') as comment
         from pg_proc where oid = 'public.rls_auto_enable()'::regprocedure`,
    );
    expect(fn.rows[0]?.src).toContain("hosted implementation marker");
    expect(fn.rows[0]?.comment).toBeNull();
    await hosted.close();
  }, 120_000);
});

describe("atomic AI graph commit (Postgres)", () => {
  it("persists entities, events, relations and exactly one audit entry", async () => {
    const user = await createUser(db, "commit@test.local");
    const caseId = await createCase(db, user);
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Anna Horváthová", dateOfBirth: "1980-01-01" },
          { name: "Peter Horváth", dateOfBirth: "1978-02-02" },
        ],
        companies: [],
        timeline: [
          {
            date: "2024-01-05",
            event: "Podpis zmluvy",
            actors: ["Anna Horváthová", "Peter Horváth"],
          },
        ],
      },
      user,
      "2026-09-27",
      [],
      [],
      [],
    );

    const result = await commitGraph(caseId, user, plan);
    expect(result.rows[0]?.r).toEqual({ entities: 2, events: 1, relations: 1 });
    expect(await count("case_entities", caseId)).toBe(2);
    expect(await count("case_relations", caseId)).toBe(1);
    const audit = await db.query<{ action: string; correlation_id: string }>(
      "select action, correlation_id from public.case_audit_log where case_id = $1",
      [caseId],
    );
    expect(audit.rows).toEqual([
      { action: "ai_graph_committed", correlation_id: "corr-test" },
    ]);
  });

  it("rolls back every row when persistence fails midway (fault injection)", async () => {
    const user = await createUser(db, "rollback@test.local");
    const caseId = await createCase(db, user);
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Eva Malá", dateOfBirth: "1988-01-01" },
          { name: "Ivan Veľký", dateOfBirth: "1970-03-03" },
        ],
        companies: [],
        timeline: [
          { date: "2024-02-01", event: "Prevod", actors: ["Eva Malá", "Ivan Veľký"] },
        ],
      },
      user,
      "2026-09-27",
      [],
      [],
      [],
    );
    // Entities and events are valid; the relation step fails after they were inserted.
    const broken: Plan = {
      ...plan,
      relations: plan.relations.map((relation) => ({
        ...relation,
        to_id: "99999999-9999-4999-8999-999999999999",
      })),
    };

    await expect(commitGraph(caseId, user, broken)).rejects.toThrow(/outside case/);
    expect(await count("case_entities", caseId)).toBe(0);
    expect(await count("case_events", caseId)).toBe(0);
    expect(await count("case_relations", caseId)).toBe(0);
    expect(await count("case_audit_log", caseId)).toBe(0);
  });

  it("rejects a commit by a user who does not own the case", async () => {
    const owner = await createUser(db, "owner@test.local");
    const intruder = await createUser(db, "intruder@test.local");
    const caseId = await createCase(db, owner);
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [{ name: "X Y", dateOfBirth: "1990-01-01" }],
        companies: [],
        timeline: [],
      },
      intruder,
      "2026-09-27",
      [],
      [],
      [],
    );
    await expect(commitGraph(caseId, intruder, plan)).rejects.toThrow(/access denied/);
    expect(await count("case_entities", caseId)).toBe(0);
  });

  it("keeps homonyms with different dates of birth as two entities", async () => {
    const user = await createUser(db, "homonym@test.local");
    const caseId = await createCase(db, user);
    const plan = buildAiGraphPlan(
      {
        caseId,
        persons: [
          { name: "Ján Novák", dateOfBirth: "1975-04-12" },
          { name: "Ján Novák", dateOfBirth: "1984-09-30" },
          { name: "Ján Novák" },
        ],
        companies: [],
        timeline: [],
      },
      user,
      "2026-09-27",
      [],
      [],
      [],
    );
    await commitGraph(caseId, user, plan);
    const rows = await db.query<{ identity_key: string | null }>(
      "select identity_key from public.case_entities where case_id = $1 order by identity_key nulls last",
      [caseId],
    );
    // Name-only mention is a third, separate entity — never silently merged.
    expect(rows.rows.map((row) => row.identity_key)).toEqual([
      "person:ján novák|born:1975-04-12",
      "person:ján novák|born:1984-09-30",
      null,
    ]);
  });
});

describe("temporal relations (Postgres)", () => {
  it("stores two functional periods of the same person in the same organisation", async () => {
    const user = await createUser(db, "temporal@test.local");
    const caseId = await createCase(db, user);
    const period = (date: string, endDate: string) => ({
      date,
      endDate,
      event: "konateľ",
      actors: ["Mária Kováčová", "Alfa s.r.o."],
    });
    const first = buildAiGraphPlan(
      {
        caseId,
        persons: [{ name: "Mária Kováčová", dateOfBirth: "1965-05-05" }],
        companies: ["Alfa s.r.o."],
        timeline: [period("2010-01-01", "2014-12-31")],
      },
      user,
      "2026-09-27",
      [],
      [],
      [],
    );
    await commitGraph(caseId, user, first);

    const existingEntities = await db.query<{
      id: string;
      name: string;
      identity_key: string | null;
    }>("select id, name, identity_key from public.case_entities where case_id = $1", [caseId]);
    const existingRelations = await db.query<{
      from_id: string;
      to_id: string;
      label: string;
      valid_from: string | null;
      valid_to: string | null;
    }>(
      "select from_id, to_id, label, valid_from::text, valid_to::text from public.case_relations where case_id = $1",
      [caseId],
    );
    // Re-ingest: the first period again (must be a no-op) plus a second period.
    const second = buildAiGraphPlan(
      {
        caseId,
        persons: [],
        companies: [],
        timeline: [period("2010-01-01", "2014-12-31"), period("2019-03-01", "2022-06-30")],
      },
      user,
      "2026-09-27",
      existingEntities.rows,
      [],
      existingRelations.rows,
    );
    expect(second.relations).toHaveLength(1);
    await commitGraph(caseId, user, second);

    const periods = await db.query<{
      valid_from: string;
      valid_to: string;
      evidence_hash: string;
    }>(
      "select valid_from::text, valid_to::text, evidence_hash from public.case_relations where case_id = $1 order by valid_from",
      [caseId],
    );
    expect(periods.rows.map((row) => [row.valid_from, row.valid_to])).toEqual([
      ["2010-01-01", "2014-12-31"],
      ["2019-03-01", "2022-06-30"],
    ]);
    expect(periods.rows.every((row) => /^[0-9a-f]{64}$/.test(row.evidence_hash))).toBe(true);
    expect(periods.rows[0]?.evidence_hash).not.toBe(periods.rows[1]?.evidence_hash);

    await expect(
      db.query("update public.case_relations set valid_to = '2030-01-01' where case_id = $1", [
        caseId,
      ]),
    ).rejects.toThrow(/immutable/);
  });
});

describe("immutable audit trail (Postgres)", () => {
  it("chains entries, rejects UPDATE/DELETE, and detects tampering", async () => {
    const user = await createUser(db, "audit@test.local");
    const caseId = await createCase(db, user);
    for (const action of ["report_created", "report_downloaded", "authorization_failed"]) {
      await db.query(
        "select public.append_audit_event($1, $2, $3, 'reports', null, '{}'::jsonb, 'corr')",
        [user, caseId, action],
      );
    }
    const chain = await db.query<{
      chain_seq: number;
      previous_event_hash: string;
      event_hash: string;
    }>(
      "select chain_seq::int, previous_event_hash, event_hash from public.case_audit_log where user_id = $1 order by chain_seq",
      [user],
    );
    expect(chain.rows.map((row) => row.chain_seq)).toEqual([1, 2, 3]);
    expect(chain.rows[0]?.previous_event_hash).toBe("0".repeat(64));
    expect(chain.rows[1]?.previous_event_hash).toBe(chain.rows[0]?.event_hash);
    expect(chain.rows[2]?.previous_event_hash).toBe(chain.rows[1]?.event_hash);

    const intact = await db.query("select * from public.verify_audit_chain($1)", [user]);
    expect(intact.rows).toEqual([]);

    await expect(
      db.query("update public.case_audit_log set action = 'report_deleted' where user_id = $1", [
        user,
      ]),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.query("delete from public.case_audit_log where user_id = $1", [user]),
    ).rejects.toThrow(/append-only/);

    // A superuser bypassing the trigger is still caught by verification.
    await db.exec("alter table public.case_audit_log disable trigger case_audit_log_no_update");
    await db.query(
      "update public.case_audit_log set action = 'report_deleted' where user_id = $1 and chain_seq = 2",
      [user],
    );
    await db.exec("alter table public.case_audit_log enable trigger case_audit_log_no_update");
    const tampered = await db.query<{ chain_seq: number; problem: string }>(
      "select chain_seq::int, problem from public.verify_audit_chain($1)",
      [user],
    );
    expect(tampered.rows).toEqual([{ chain_seq: 2, problem: "event_hash_mismatch" }]);

    const erased = await db.query<{ n: number }>(
      "select public.erase_user_audit_log($1) as n",
      [user],
    );
    expect(erased.rows[0]?.n).toBe(3);
  });

  it("ignores a caller-supplied timestamp", async () => {
    const user = await createUser(db, "backdate@test.local");
    await db.query(
      "insert into public.case_audit_log (user_id, action, table_name, created_at) values ($1, 'x', 't', '2001-01-01')",
      [user],
    );
    const row = await db.query<{ year: number }>(
      "select extract(year from created_at)::int as year from public.case_audit_log where user_id = $1",
      [user],
    );
    expect(row.rows[0]?.year).toBeGreaterThan(2001);
  });

  it("chains the import commit audit entry in the same transaction", async () => {
    const user = await createUser(db, "import@test.local");
    const caseId = await createCase(db, user);
    const entity = await db.query<{ id: string }>(
      "insert into public.case_entities (case_id, user_id, name) values ($1, $2, 'A') returning id",
      [caseId, user],
    );
    const entityId = entity.rows[0]?.id;
    const imp = await db.query<{ id: string }>(
      `insert into public.case_imports (case_id, user_id, filename, byte_size, sha256, parser_version, status)
       values ($1, $2, 'x.csv', 1, $3, 'csv-1', 'pending') returning id`,
      [caseId, user, "b".repeat(64)],
    );
    const rows = JSON.stringify([
      { date: "2024-01-01", amount: "10.00", currency: "eur", method: "transfer", from_id: entityId, to_id: entityId },
    ]);
    await db.query("select public.commit_import($1, $2::jsonb, $3)", [imp.rows[0]?.id, rows, user]);
    const audit = await db.query<{ action: string }>(
      "select action from public.case_audit_log where case_id = $1",
      [caseId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["import_committed"]);
  });
});

describe("source snapshots and money (Postgres)", () => {
  it("rejects updates to a source snapshot", async () => {
    const user = await createUser(db, "snap@test.local");
    const caseId = await createCase(db, user);
    await db.query(
      `insert into public.source_snapshots
         (case_id, user_id, source, source_url, http_status, retrieved_at, parser_version, raw_sha256, byte_size)
       values ($1, $2, 'orsr', 'https://example.test/x', 200, now(), 'p1', $3, 10)`,
      [caseId, user, "a".repeat(64)],
    );
    await expect(
      db.query("update public.source_snapshots set http_status = 500 where case_id = $1", [caseId]),
    ).rejects.toThrow(/immutable/);
  });

  it("rejects direct and arbitrary snapshot deletes", async () => {
    const user = await createUser(db, "snap-delete@test.local");
    const caseId = await createCase(db, user);
    const inserted = await db.query<{ id: string }>(
      `insert into public.source_snapshots
         (case_id, user_id, source, source_url, http_status, retrieved_at, parser_version, raw_sha256, byte_size)
       values ($1, $2, 'orsr', 'https://example.test/delete', 200, now(), 'p1', $3, 10)
       returning id`,
      [caseId, user, "c".repeat(64)],
    );
    const snapshotId = inserted.rows[0]?.id;
    await expect(
      db.query("delete from public.source_snapshots where id = $1", [snapshotId]),
    ).rejects.toThrow(/permission denied|complete user erasure/);
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role service_role");
        await tx.query("delete from public.source_snapshots where id = $1", [snapshotId]);
      }),
    ).rejects.toThrow(/permission denied|complete user erasure/);
    expect(
      (await db.query("select id from public.source_snapshots where id = $1", [snapshotId])).rows,
    ).toHaveLength(1);
  });

  it("erases a complete user chain through the controlled function and audits it", async () => {
    const owner = await createUser(db, "snap-erase-owner@test.local");
    const stranger = await createUser(db, "snap-erase-stranger@test.local");
    const ownerCase = await createCase(db, owner);
    const strangerCase = await createCase(db, stranger);
    const insert = (caseId: string, userId: string, hash: string) =>
      db.query<{ id: string }>(
        `insert into public.source_snapshots
           (case_id, user_id, source, source_url, http_status, retrieved_at, parser_version, raw_sha256, byte_size)
         values ($1, $2, 'orsr', 'https://example.test/erase', 200, now(), 'p1', $3, 10)
         returning id`,
        [caseId, userId, hash],
      );
    const ownerSnapshot = (await insert(ownerCase, owner, "d".repeat(64))).rows[0]?.id;
    const strangerSnapshot = (await insert(strangerCase, stranger, "e".repeat(64))).rows[0]?.id;

    const erased = await db.transaction(async (tx) => {
      await tx.exec("set local role service_role");
      const result = await tx.query<{ erase_user_source_snapshots: number }>(
        "select public.erase_user_source_snapshots($1)",
        [owner],
      );
      return result.rows[0]?.erase_user_source_snapshots;
    });
    expect(erased).toBe(1);
    expect((await db.query("select id from public.source_snapshots where id = $1", [ownerSnapshot])).rows).toHaveLength(0);
    expect((await db.query("select id from public.source_snapshots where id = $1", [strangerSnapshot])).rows).toHaveLength(1);

    const audit = await db.query<{ action: string; record_id: string }>(
      "select action, record_id from public.case_audit_log where user_id = $1 and record_id = $2",
      [owner, ownerSnapshot],
    );
    expect(audit.rows).toEqual([{ action: "source_snapshots_erased", record_id: ownerSnapshot }]);
  });

  it("stores amounts as exact minor units and rejects sub-cent values", async () => {
    const user = await createUser(db, "money@test.local");
    const caseId = await createCase(db, user);
    const insert = (amount: string) =>
      db.query<{ amount_minor: string }>(
        "insert into public.case_transactions (case_id, user_id, date, amount) values ($1, $2, '2024-01-01', $3::numeric) returning amount_minor::text",
        [caseId, user, amount],
      );
    expect((await insert("0.30")).rows[0]?.amount_minor).toBe("30");
    expect((await insert("-1250.75")).rows[0]?.amount_minor).toBe("-125075");
    expect((await insert("99999999999999.99")).rows[0]?.amount_minor).toBe("9999999999999999");
    await expect(insert("0.001")).rejects.toThrow(/amount_scale/);
  });
});
