// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

function asUser<T>(
  db: PGlite,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return fn(tx);
  });
}

async function claim(
  db: PGlite,
  caseId: string,
  userId: string,
  key: string,
  leaseSeconds = 600,
) {
  const result = await db.query<{ r: {
    claimed: boolean;
    workflowId: string;
    status: string;
    attemptCount: number;
    startedAt: string | null;
  } }>(
    "select public.claim_asset_timeline_workflow($1,$2,$3,$4) as r",
    [caseId, userId, key, leaseSeconds],
  );
  const row = result.rows[0]?.r;
  if (!row) throw new Error("claim returned no row");
  return row;
}

async function complete(
  db: PGlite,
  input: {
    workflowId: string;
    caseId: string;
    userId: string;
    key: string;
    supersedes?: string | null;
  },
) {
  const hash = "a".repeat(64);
  const result = await db.query<{ r: Record<string, unknown> }>(
    `select public.complete_asset_timeline_analysis(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13
    ) as r`,
    [
      input.workflowId,
      input.caseId,
      input.userId,
      input.key,
      input.supersedes ?? null,
      hash,
      "asset-timeline-test",
      hash,
      "mistral",
      "test-model",
      JSON.stringify([{ evidenceId: "e1", sha256: hash, fileName: "x.txt", fileSize: 1 }]),
      JSON.stringify({ caseExecutiveSummary: "test" }),
      hash,
    ],
  );
  const row = result.rows[0]?.r;
  if (!row) throw new Error("complete returned no row");
  return row;
}

describe("asset timeline PostgreSQL workflow invariants", () => {
  it("allows exactly one fresh execution owner for the same canonical key", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-claim@test.local");
    const caseId = await createCase(db, user);
    const key = "k".repeat(64);

    const [first, second] = await Promise.all([
      claim(db, caseId, user, key),
      claim(db, caseId, user, key),
    ]);

    expect([first.claimed, second.claimed].sort()).toEqual([false, true]);
    expect(first.workflowId).toBe(second.workflowId);

    const rows = await db.query<{ n: number }>(
      "select count(*)::int as n from public.forensic_workflow_runs where case_id=$1 and workflow_type='ASSET_TIMELINE_FORENSICS' and idempotency_key=$2",
      [caseId, key],
    );
    expect(rows.rows[0]?.n).toBe(1);
    await db.close();
  }, 60_000);

  it("does not duplicate a fresh running claim and reclaims a stale one", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-stale@test.local");
    const caseId = await createCase(db, user);
    const key = "s".repeat(64);

    const first = await claim(db, caseId, user, key);
    expect(first.claimed).toBe(true);
    expect(first.attemptCount).toBe(1);

    const active = await claim(db, caseId, user, key);
    expect(active.claimed).toBe(false);
    expect(active.attemptCount).toBe(1);

    await db.query(
      "update public.forensic_workflow_runs set started_at = now() - interval '20 minutes' where id=$1",
      [first.workflowId],
    );
    const reclaimed = await claim(db, caseId, user, key, 600);
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.attemptCount).toBe(2);
    await db.close();
  }, 60_000);

  it("increments attempts after a failed run", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-failed@test.local");
    const caseId = await createCase(db, user);
    const key = "f".repeat(64);

    const first = await claim(db, caseId, user, key);
    const failed = await db.query<{ ok: boolean }>(
      "select public.fail_asset_timeline_workflow($1,$2,$3,$4,'TEST','failed') as ok",
      [first.workflowId, caseId, user, key],
    );
    expect(failed.rows[0]?.ok).toBe(true);

    const retried = await claim(db, caseId, user, key);
    expect(retried.claimed).toBe(true);
    expect(retried.attemptCount).toBe(2);
    await db.close();
  }, 60_000);

  it("commits immutable result and workflow completion atomically", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-complete@test.local");
    const caseId = await createCase(db, user);
    const key = "c".repeat(64);

    const owned = await claim(db, caseId, user, key);
    const run = await complete(db, {
      workflowId: owned.workflowId,
      caseId,
      userId: user,
      key,
    });
    expect(run.id).toBeTruthy();

    const state = await db.query<{ status: string }>(
      "select status from public.forensic_workflow_runs where id=$1",
      [owned.workflowId],
    );
    expect(state.rows[0]?.status).toBe("completed");

    const resultCount = await db.query<{ n: number }>(
      "select count(*)::int as n from public.forensic_asset_timeline_runs where case_id=$1 and user_id=$2 and idempotency_key=$3",
      [caseId, user, key],
    );
    expect(resultCount.rows[0]?.n).toBe(1);

    const repeatClaim = await claim(db, caseId, user, key);
    expect(repeatClaim.claimed).toBe(false);
    expect(repeatClaim.status).toBe("completed");
    await db.close();
  }, 60_000);

  it("rolls back the immutable result if the terminal workflow update fails", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-rollback@test.local");
    const caseId = await createCase(db, user);
    const key = "r".repeat(64);
    const owned = await claim(db, caseId, user, key);

    await db.exec(`
      create or replace function public.test_reject_asset_completion()
      returns trigger language plpgsql as $$
      begin
        if new.status = 'completed' then
          raise exception 'forced terminal failure';
        end if;
        return new;
      end $$;
      create trigger test_reject_asset_completion
      before update on public.forensic_workflow_runs
      for each row execute function public.test_reject_asset_completion();
    `);

    await expect(
      complete(db, {
        workflowId: owned.workflowId,
        caseId,
        userId: user,
        key,
      }),
    ).rejects.toThrow(/forced terminal failure/);

    const resultCount = await db.query<{ n: number }>(
      "select count(*)::int as n from public.forensic_asset_timeline_runs where case_id=$1",
      [caseId],
    );
    expect(resultCount.rows[0]?.n).toBe(0);
    await db.close();
  }, 60_000);

  it("denies asset timeline workflow RPCs to authenticated clients", async () => {
    const db = await freshDatabase();
    const user = await createUser(db, "asset-rpc-denied@test.local");
    const caseId = await createCase(db, user);

    await expect(
      asUser(db, user, (tx) =>
        tx.query(
          "select public.claim_asset_timeline_workflow($1,$2,$3,600)",
          [caseId, user, "d".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);
    await db.close();
  }, 60_000);

  it("blocks direct deletion but permits the audited destroy_case cascade", async () => {
    const db = await freshDatabase();
    const owner = await createUser(db, "asset-owner@test.local");
    const admin = await createUser(db, "asset-admin@test.local");
    await db.query(
      "insert into public.user_roles (user_id, role) values ($1, 'admin')",
      [admin],
    );
    const caseId = await createCase(db, owner);
    const hash = "b".repeat(64);

    await db.query(
      `insert into public.forensic_asset_timeline_runs (
        case_id,user_id,status,idempotency_key,input_sha256,prompt_version,
        prompt_sha256,provider,model,evidence_bindings,result,result_sha256
      ) values ($1,$2,'COMPLETED',$3,$4,'test',$4,'mistral','model','[]'::jsonb,'{}'::jsonb,$4)`,
      [caseId, owner, "x".repeat(64), hash],
    );

    await expect(
      db.query(
        "delete from public.forensic_asset_timeline_runs where case_id=$1",
        [caseId],
      ),
    ).rejects.toThrow(/append-only/);

    await asUser(db, owner, (tx) =>
      tx.query("select public.set_case_status($1,'closed','done')", [caseId]),
    );
    await asUser(db, admin, (tx) =>
      tx.query("select public.set_case_status($1,'archived','archive')", [caseId]),
    );
    await asUser(db, admin, (tx) =>
      tx.query("select public.destroy_case($1,'retention expired')", [caseId]),
    );

    const remaining = await db.query<{ n: number }>(
      "select count(*)::int as n from public.forensic_asset_timeline_runs where case_id=$1",
      [caseId],
    );
    expect(remaining.rows[0]?.n).toBe(0);

    const audit = await db.query<{ action: string }>(
      "select action from public.case_audit_log where case_id=$1 order by chain_seq",
      [caseId],
    );
    expect(audit.rows.map((row) => row.action)).toContain("case_destroyed");
    await db.close();
  }, 60_000);

  it("does not let destroy_case bypass legal hold lifecycle rules", async () => {
    const db = await freshDatabase();
    const owner = await createUser(db, "asset-held@test.local");
    const admin = await createUser(db, "asset-held-admin@test.local");
    await db.query(
      "insert into public.user_roles (user_id, role) values ($1, 'admin')",
      [admin],
    );
    const caseId = await createCase(db, owner);
    await asUser(db, owner, (tx) =>
      tx.query("select public.set_case_status($1,'legal_hold','hold')", [caseId]),
    );
    await expect(
      asUser(db, admin, (tx) =>
        tx.query("select public.destroy_case($1,'no')", [caseId]),
      ),
    ).rejects.toThrow(/archivovaný prípad/);
    await db.close();
  }, 60_000);
});
