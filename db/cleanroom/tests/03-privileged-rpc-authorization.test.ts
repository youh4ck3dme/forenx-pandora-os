// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCleanroomDatabase,
  asAnon,
  asAuthenticated,
  asServiceRole,
  createTestUser,
  createTestCase,
  createTestEvidence,
} from "./cleanroom-harness";

describe("Regression Suite: 03 - Privileged RPC Role Authorization", () => {
  it("rejects anon execution of ALL privileged functions (permission denied)", async () => {
    const db = await createCleanroomDatabase();
    const dummyId = "00000000-0000-0000-0000-000000000001";

    // 1. Rate limits
    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM public.consume_rate_limit('k', 10, 60)"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM public.check_rate_limit('k', 10, 60)"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.cleanup_expired_rate_limits()"))
    ).rejects.toThrow(/permission denied/);

    // 2. Audit & Verification
    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.erase_user_audit_log($1)", [dummyId]))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.append_audit_event($1, $2, 'act', 'tbl', $3, '{}'::jsonb, 'c')", [
          dummyId,
          dummyId,
          dummyId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.record_evidence_verification($1, 'verified', 'hash', 1024, '')", [
          dummyId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    // 3. AI & Graph
    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.reserve_ai_call($1, $2, 'task', 'm', 'v1', 'r1', 100)", [
          dummyId,
          dummyId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.commit_ai_case_graph($1, $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)", [
          dummyId,
          dummyId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.commit_import($1, '{}'::jsonb, $2)", [dummyId, dummyId])
      )
    ).rejects.toThrow(/permission denied/);

    // 4. Case & Evidence Actions
    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.destroy_case($1, 'reason')", [dummyId]))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.set_case_status($1, 'closed')", [dummyId]))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) =>
        tx.query("SELECT public.delete_evidence_item_audited($1, 'reason')", [dummyId])
      )
    ).rejects.toThrow(/permission denied/);

    // 5. System Health Telemetry
    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.db_health_stats()"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) => tx.query("SELECT public.health_metrics()"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM public.assert_rls_enabled_on_all_tables()"))
    ).rejects.toThrow(/permission denied/);
  }, 60_000);

  it("rejects authenticated client execution of service_role-only RPCs", async () => {
    const db = await createCleanroomDatabase();
    const userId = await createTestUser(db, "regular@test.local", false);
    const dummyId = "00000000-0000-0000-0000-000000000001";

    // erase_user_audit_log must NEVER be callable by authenticated clients
    await expect(
      asAuthenticated(db, userId, (tx) => tx.query("SELECT public.erase_user_audit_log($1)", [userId]))
    ).rejects.toThrow(/permission denied/);

    // append_audit_event must NEVER be callable by authenticated clients
    await expect(
      asAuthenticated(db, userId, (tx) =>
        tx.query("SELECT public.append_audit_event($1, $2, 'a', 't', $3, '{}'::jsonb, 'c')", [
          userId,
          dummyId,
          dummyId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    // record_evidence_verification is server-only
    await expect(
      asAuthenticated(db, userId, (tx) =>
        tx.query("SELECT public.record_evidence_verification($1, 'verified', 'h', 1, '')", [dummyId])
      )
    ).rejects.toThrow(/permission denied/);

    // AI graph commits must be server-controlled
    await expect(
      asAuthenticated(db, userId, (tx) =>
        tx.query("SELECT public.commit_ai_case_graph($1, $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)", [
          dummyId,
          userId,
        ])
      )
    ).rejects.toThrow(/permission denied/);

    // Direct rate limiting RPCs are server-only
    await expect(
      asAuthenticated(db, userId, (tx) =>
        tx.query("SELECT * FROM public.consume_rate_limit('k', 10, 60)")
      )
    ).rejects.toThrow(/permission denied/);

    // System stats and assertion RPCs are server-only
    await expect(
      asAuthenticated(db, userId, (tx) => tx.query("SELECT public.db_health_stats()"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAuthenticated(db, userId, (tx) => tx.query("SELECT * FROM public.assert_rls_enabled_on_all_tables()"))
    ).rejects.toThrow(/permission denied/);
  }, 60_000);

  it("enforces admin-only guard inside destroy_case and health_metrics", async () => {
    const db = await createCleanroomDatabase();
    const regularUser = await createTestUser(db, "regular@test.local", false);
    const adminUser = await createTestUser(db, "admin@test.local", true);
    const caseId = await createTestCase(db, regularUser, "Dossier 1", "draft");

    // Regular user attempting destroy_case -> fails internal admin check (42501)
    await expect(
      asAuthenticated(db, regularUser, (tx) =>
        tx.query("SELECT public.destroy_case($1, 'Destroy reason')", [caseId])
      )
    ).rejects.toThrow(/Iba administr\u00E1tor smie vykona\u0165 riaden\u00FA skart\u00E1ciu/);

    // Regular user attempting health_metrics -> fails internal admin check (42501)
    await expect(
      asAuthenticated(db, regularUser, (tx) => tx.query("SELECT public.health_metrics()"))
    ).rejects.toThrow(/Pr\u00EDstup maj\u00FA iba administr\u00E1tori/);

    // Admin user calling health_metrics -> succeeds and returns operational telemetry
    await asAuthenticated(db, adminUser, async (tx) => {
      const res = await tx.query<{ health_metrics: any }>("SELECT public.health_metrics()");
      expect(res.rows[0]?.health_metrics).toBeDefined();
      expect(res.rows[0]?.health_metrics.window_hours).toBe(24);
    });
  }, 60_000);

  it("allows authenticated users to execute permitted client-facing RPCs", async () => {
    const db = await createCleanroomDatabase();
    const userA = await createTestUser(db, "userA@test.local", false);
    const caseId = await createTestCase(db, userA, "Case A", "draft");

    await asAuthenticated(db, userA, async (tx) => {
      // 1. owns_case
      const ownsRes = await tx.query<{ owns_case: boolean }>(
        "SELECT public.owns_case($1)",
        [caseId]
      );
      expect(ownsRes.rows[0]?.owns_case).toBe(true);

      // 2. set_case_status: transition draft -> closed
      const statusRes = await tx.query<{ set_case_status: string }>(
        "SELECT public.set_case_status($1, 'closed', 'Investigation finished')",
        [caseId]
      );
      expect(statusRes.rows[0]?.set_case_status).toBe("closed");

      // 3. log_case_access
      await tx.query(
        "SELECT public.log_case_access($1, 'view', 'Legal inquiry § 119', '127.0.0.1', 'Mozilla/5.0')",
        [caseId]
      );

      // 4. verify_audit_chain
      const chainRes = await tx.query<{ problem: string }>(
        "SELECT * FROM public.verify_audit_chain($1)",
        [userA]
      );
      expect(chainRes.rows.length).toBe(0); // Valid chain, 0 problems
    });
  }, 60_000);
});
