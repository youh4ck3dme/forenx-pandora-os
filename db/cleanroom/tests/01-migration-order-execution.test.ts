// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  asAnon,
  asServiceRole,
  createCleanroomDatabase,
  createTestUser,
} from "./cleanroom-harness";

describe("Regression Suite: 01 - Migration Order & Execution", () => {
  it("executes all cleanroom files from an empty database in exact sequence without errors", async () => {
    const db = await createCleanroomDatabase();
    expect(db).toBeDefined();

    // Verify all 23 public tables exist
    const EXPECTED_TABLES = [
      "user_roles",
      "profiles",
      "subscriptions",
      "billing_events",
      "billing_payment_methods",
      "billing_payment_attempts",
      "deletion_requests",
      "error_logs",
      "cases",
      "case_entities",
      "case_events",
      "case_relations",
      "case_transactions",
      "case_weapons",
      "case_imports",
      "company_registry_profiles",
      "cross_border_analyses",
      "source_snapshots",
      "evidence_items",
      "case_audit_log",
      "ai_usage",
      "ai_feature_logs",
      "rate_limits",
    ];

    const tablesRes = await db.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const foundTables = tablesRes.rows.map((r) => r.tablename);

    for (const expectedTable of EXPECTED_TABLES) {
      expect(foundTables, `Missing table: public.${expectedTable}`).toContain(expectedTable);
    }

    // Verify every public table has row-level security enabled
    const rlsRes = await db.query<{ tablename: string; rowsecurity: boolean }>(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`
    );
    for (const row of rlsRes.rows) {
      expect(row.rowsecurity, `Table ${row.tablename} must have RLS enabled`).toBe(true);
    }

    // Verify core RPC functions exist
    const EXPECTED_FUNCTIONS = [
      "has_role",
      "current_plan",
      "claim_sumup_due_subscriptions",
      "owns_case",
      "set_case_status",
      "destroy_case",
      "source_snapshots_immutable",
      "evidence_items_worm_guard",
      "evidence_items_delete_guard",
      "delete_evidence_item_audited",
      "record_evidence_verification",
      "audit_event_hash",
      "case_audit_log_chain",
      "case_audit_log_append_only",
      "verify_audit_chain",
      "erase_user_audit_log",
      "log_case_access",
      "log_evidence_upload",
      "append_audit_event",
      "reserve_ai_call",
      "commit_ai_case_graph",
      "commit_import",
      "cleanup_expired_rate_limits",
      "consume_rate_limit",
      "check_rate_limit",
      "db_health_stats",
      "health_metrics",
      "assert_rls_enabled_on_all_tables",
    ];

    const funcsRes = await db.query<{ proname: string }>(
      `SELECT p.proname 
       FROM pg_proc p 
       JOIN pg_namespace n ON n.oid = p.pronamespace 
       WHERE n.nspname = 'public'`
    );
    const foundFuncs = funcsRes.rows.map((r) => r.proname);

    for (const expectedFunc of EXPECTED_FUNCTIONS) {
      expect(foundFuncs, `Missing function: public.${expectedFunc}`).toContain(expectedFunc);
    }

    // Verify storage bucket exists
    const bucketRes = await db.query<{ id: string }>(
      `SELECT id FROM storage.buckets WHERE id = 'avatars'`
    );
    expect(bucketRes.rows[0]?.id).toBe("avatars");
  }, 60_000);

  it("upgrades the previous billing schema with the SumUp migration and filters legacy Stripe entitlements", async () => {
    const db = await createCleanroomDatabase();
    await db.exec?.(`
      DROP FUNCTION public.claim_sumup_due_subscriptions(text, integer);
      DROP TABLE public.billing_payment_attempts;
      DROP TABLE public.billing_payment_methods;
      ALTER TABLE public.subscriptions
        DROP COLUMN renewal_claimed_at,
        DROP COLUMN renewal_next_attempt_at,
        DROP COLUMN trial_used,
        DROP COLUMN recurring_consent_at,
        DROP COLUMN recurring_consent_version,
        DROP COLUMN renewal_attempt_count,
        ALTER COLUMN provider SET DEFAULT 'stripe';
      ALTER TABLE public.billing_events ALTER COLUMN provider SET DEFAULT 'stripe';
    `);

    const migration = await import("node:fs/promises").then(({ readFile }) =>
      readFile("supabase/migrations/20261015090000_sumup_billing.sql", "utf8"),
    );
    await db.exec?.(migration);

    const userId = await createTestUser(db, "sumup-migration@test.local");
    await db.query(
      `INSERT INTO public.subscriptions (user_id, environment, provider, plan, status, current_period_end)
       VALUES ($1, 'sandbox', 'stripe', 'pro', 'active', NOW() + INTERVAL '30 days')`,
      [userId],
    );
    const legacyPlan = await db.query<{ current_plan: string }>(
      "SELECT public.current_plan($1) AS current_plan",
      [userId],
    );
    expect(legacyPlan.rows[0]?.current_plan).toBe("free");

    const dueUserId = await createTestUser(db, "sumup-due@test.local");
    await db.query(
      `INSERT INTO public.subscriptions (user_id, environment, provider, plan, status, current_period_end)
       VALUES ($1, 'sandbox', 'sumup', 'pro', 'trialing', NOW() - INTERVAL '1 day')`,
      [dueUserId],
    );
    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM public.claim_sumup_due_subscriptions('sandbox', 50)")),
    ).rejects.toThrow(/permission denied/);
    const claimed = await asServiceRole(db, (tx) =>
      tx.query<{ user_id: string; renewal_attempt_count: number }>(
        "SELECT user_id, renewal_attempt_count FROM public.claim_sumup_due_subscriptions('sandbox', 50)",
      ),
    );
    expect(claimed.rows).toEqual([{ user_id: dueUserId, renewal_attempt_count: 1 }]);
  }, 60_000);
});
