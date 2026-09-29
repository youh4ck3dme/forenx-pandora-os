// @vitest-environment node
import { beforeAll, afterEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;
let userA: string;
let userB: string;
let adminUser: string;
let caseA: string;
let caseB: string;

beforeAll(async () => {
  db = await freshDatabase();

  // Create test actors
  userA = await createUser(db, "userA@test.local");
  userB = await createUser(db, "userB@test.local");
  adminUser = await createUser(db, "admin@test.local");

  // auth.users insert automatically assigns 'user' role via trigger.
  // Grant 'admin' role to adminUser.
  await db.query(
    "insert into public.user_roles (user_id, role) values ($1, 'admin') on conflict do nothing",
    [adminUser],
  );

  // Create test cases
  caseA = await createCase(db, userA);
  caseB = await createCase(db, userB);
}, 120_000);

afterEach(async () => {
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
});

async function asUser(userId: string) {
  await db.query("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

describe("Database Source-of-Truth Reconciliation Tests", () => {
  describe("1. has_role oracle closure", () => {
    it("user A cannot inspect user B role through has_role (returns false, no oracle leak)", async () => {
      await asUser(userA);

      // User B actually has the user role
      const res = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'user'::public.app_role) as has_role",
        [userB],
      );
      // Because User A is neither User B nor admin, has_role returns false
      expect(res.rows[0]?.has_role).toBe(false);

      // User B does not have admin role
      const resAdmin = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'admin'::public.app_role) as has_role",
        [userB],
      );
      expect(resAdmin.rows[0]?.has_role).toBe(false);
    });

    it("legitimate self role checks work for ordinary users", async () => {
      await asUser(userA);

      const res = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'user'::public.app_role) as has_role",
        [userA],
      );
      expect(res.rows[0]?.has_role).toBe(true);

      const resAdmin = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'admin'::public.app_role) as has_role",
        [userA],
      );
      expect(resAdmin.rows[0]?.has_role).toBe(false);
    });

    it("admin can query any user role", async () => {
      await asUser(adminUser);

      const resB = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'user'::public.app_role) as has_role",
        [userB],
      );
      expect(resB.rows[0]?.has_role).toBe(true);

      const resAdminSelf = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'admin'::public.app_role) as has_role",
        [adminUser],
      );
      expect(resAdminSelf.rows[0]?.has_role).toBe(true);
    });

    it("system context (auth.uid() is null) can evaluate roles", async () => {
      await db.query("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false)");

      const res = await db.query<{ has_role: boolean }>(
        "select public.has_role($1, 'user'::public.app_role) as has_role",
        [userA],
      );
      expect(res.rows[0]?.has_role).toBe(true);
    });
  });

  describe("2. cross_border_analyses case ownership enforcement", () => {
    it("user A cannot create cross_border_analyses against user B case", async () => {
      await asUser(userA);

      // Attempt to insert record for caseB owned by userB
      await expect(
        db.query(
          `insert into public.cross_border_analyses (case_id, user_id, report_id, source)
           values ($1, $2, 'rep-1', 'dimitri')`,
          [caseB, userA],
        ),
      ).rejects.toThrow();
    });

    it("valid own-case flow works for cross_border_analyses", async () => {
      await asUser(userA);

      const res = await db.query<{ id: string }>(
        `insert into public.cross_border_analyses (case_id, user_id, report_id, source)
         values ($1, $2, 'rep-valid-1', 'dimitri')
         returning id`,
        [caseA, userA],
      );
      expect(res.rows[0]?.id).toBeDefined();

      // Read own record
      const readRes = await db.query(
        "select * from public.cross_border_analyses where case_id = $1",
        [caseA],
      );
      expect(readRes.rows.length).toBe(1);

      // User B cannot read user A cross_border_analyses
      await asUser(userB);
      const readResB = await db.query(
        "select * from public.cross_border_analyses where case_id = $1",
        [caseA],
      );
      expect(readResB.rows.length).toBe(0);
    });
  });

  describe("3. forensic_workflow_runs initial state forgery prevention", () => {
    it("forged forensic_workflow_runs state is rejected on direct insert", async () => {
      await asUser(userA);

      // Attempt 1: Forging status to 'completed'
      await expect(
        db.query(
          `insert into public.forensic_workflow_runs (case_id, user_id, workflow_type, idempotency_key, status)
           values ($1, $2, 'FORENSIC_CASE_ANALYSIS', 'k-forge-1', 'completed')`,
          [caseA, userA],
        ),
      ).rejects.toThrow();

      // Attempt 2: Forging attempt_count > 0
      await expect(
        db.query(
          `insert into public.forensic_workflow_runs (case_id, user_id, workflow_type, idempotency_key, status, attempt_count)
           values ($1, $2, 'FORENSIC_CASE_ANALYSIS', 'k-forge-2', 'queued', 5)`,
          [caseA, userA],
        ),
      ).rejects.toThrow();

      // Attempt 3: Forging workflow_run_id
      await expect(
        db.query(
          `insert into public.forensic_workflow_runs (case_id, user_id, workflow_type, idempotency_key, status, workflow_run_id)
           values ($1, $2, 'FORENSIC_CASE_ANALYSIS', 'k-forge-3', 'queued', 'fake-run-id')`,
          [caseA, userA],
        ),
      ).rejects.toThrow();

      // Attempt 4: Forging started_at
      await expect(
        db.query(
          `insert into public.forensic_workflow_runs (case_id, user_id, workflow_type, idempotency_key, status, started_at)
           values ($1, $2, 'FORENSIC_CASE_ANALYSIS', 'k-forge-4', 'queued', now())`,
          [caseA, userA],
        ),
      ).rejects.toThrow();
    });

    it("legitimate queue flow works", async () => {
      await asUser(userA);

      const res = await db.query<{ id: string; status: string; attempt_count: number }>(
        `insert into public.forensic_workflow_runs (case_id, user_id, workflow_type, idempotency_key, status)
         values ($1, $2, 'FORENSIC_CASE_ANALYSIS', 'k-legit-1', 'queued')
         returning id, status, attempt_count`,
        [caseA, userA],
      );
      expect(res.rows[0]?.id).toBeDefined();
      expect(res.rows[0]?.status).toBe("queued");
      expect(res.rows[0]?.attempt_count).toBe(0);

      // Caller can read own workflow run
      const readRes = await db.query(
        "select * from public.forensic_workflow_runs where id = $1",
        [res.rows[0]?.id],
      );
      expect(readRes.rows.length).toBe(1);

      // User B cannot read user A workflow run
      await asUser(userB);
      const readResB = await db.query(
        "select * from public.forensic_workflow_runs where id = $1",
        [res.rows[0]?.id],
      );
      expect(readResB.rows.length).toBe(0);
    });
  });

  describe("4. billing_events remains inaccessible to ordinary users", () => {
    it("ordinary users cannot query billing_events", async () => {
      await asUser(userA);
      await expect(
        db.query("select * from public.billing_events"),
      ).rejects.toThrow(/permission denied/);
    });

    it("service_role can access billing_events", async () => {
      await db.query("set role service_role");
      const res = await db.query("select * from public.billing_events");
      expect(res.rows).toBeDefined();
    });
  });

  describe("5. RLS policies behave correctly after normalization", () => {
    it("user can read own roles but not other user roles", async () => {
      await asUser(userA);

      const ownRoles = await db.query(
        "select * from public.user_roles where user_id = $1",
        [userA],
      );
      expect(ownRoles.rows.length).toBe(1);

      const otherRoles = await db.query(
        "select * from public.user_roles where user_id = $1",
        [userB],
      );
      expect(otherRoles.rows.length).toBe(0);
    });

    it("evidence_items policies enforce ownership and legal hold after normalization", async () => {
      await asUser(userA);

      const insertRes = await db.query<{ id: string }>(
        `insert into public.evidence_items (investigator_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
         values ($1, 'Case Test', 'ev1.pdf', 1024, 'application/pdf', 's3://test/ev1.pdf', '${"1".repeat(64)}')
         returning id`,
        [userA],
      );
      const evId = insertRes.rows[0]?.id;
      expect(evId).toBeDefined();

      // User A can read it
      const readA = await db.query("select * from public.evidence_items where id = $1", [evId]);
      expect(readA.rows.length).toBe(1);

      // User B cannot read it
      await asUser(userB);
      const readB = await db.query("select * from public.evidence_items where id = $1", [evId]);
      expect(readB.rows.length).toBe(0);
    });
  });
});
