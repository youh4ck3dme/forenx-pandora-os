// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCleanroomDatabase, CLEANROOM_FILES } from "./cleanroom-harness";

describe("Regression Suite: 01 - Migration Order & Execution", () => {
  it("executes all cleanroom files from an empty database in exact sequence without errors", async () => {
    const db = await createCleanroomDatabase();
    expect(db).toBeDefined();

    // Verify all 21 public tables exist
    const EXPECTED_TABLES = [
      "user_roles",
      "profiles",
      "subscriptions",
      "billing_events",
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

    // Verify all 21 tables have row-level security enabled
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
});
