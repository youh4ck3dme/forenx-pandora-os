// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCleanroomDatabase,
  asAuthenticated,
  asAnon,
  asServiceRole,
  createTestUser,
  createTestCase,
  createTestEvidence,
} from "./cleanroom-harness";

describe("Regression Suite: 04 - RLS Multi-Tenant Isolation & Table Hardening", () => {
  it("unconditionally denies direct client access on public.rate_limits table", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "user@test.local");

    // Insert a record as service_role
    await asServiceRole(db, (tx) =>
      tx.query("INSERT INTO public.rate_limits (key, count, window_start, expires_at) VALUES ('secret_key', 1, NOW(), NOW() + INTERVAL '1 hour')")
    );

    // 1. Direct SELECT: anon and authenticated get permission denied (table privilege revoked)
    await expect(
      asAnon(db, (tx) => tx.query("SELECT * FROM public.rate_limits"))
    ).rejects.toThrow(/permission denied/);

    await expect(
      asAuthenticated(db, user, (tx) => tx.query("SELECT * FROM public.rate_limits"))
    ).rejects.toThrow(/permission denied/);

    // 2. Direct INSERT: blocked by permission denied
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query(
          "INSERT INTO public.rate_limits (key, count, window_start, expires_at) VALUES ('hacked', 1, NOW(), NOW() + INTERVAL '1 hour')"
        )
      )
    ).rejects.toThrow(/permission denied/);

    // 3. Direct UPDATE: blocked by permission denied
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query("UPDATE public.rate_limits SET count = 0 WHERE key = 'secret_key'")
      )
    ).rejects.toThrow(/permission denied/);

    // 4. Direct DELETE: blocked by permission denied
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query("DELETE FROM public.rate_limits WHERE key = 'secret_key'")
      )
    ).rejects.toThrow(/permission denied/);
  }, 60_000);

  it("strictly isolates cases and graph entities between tenants (User A vs User B)", async () => {
    const db = await createCleanroomDatabase();
    const userA = await createTestUser(db, "userA@test.local");
    const userB = await createTestUser(db, "userB@test.local");

    // User A creates a case and an entity
    const caseA = await asAuthenticated(db, userA, async (tx) => {
      const cRes = await tx.query<{ id: string }>(
        "INSERT INTO public.cases (user_id, name) VALUES ($1, 'Case A') RETURNING id",
        [userA]
      );
      const cid = cRes.rows[0]?.id!;
      await tx.query(
        "INSERT INTO public.case_entities (case_id, user_id, name, kind) VALUES ($1, $2, 'Target Corp', 'company')",
        [cid, userA]
      );
      return cid;
    });

    // User B tries to SELECT User A's case -> 0 rows
    await asAuthenticated(db, userB, async (tx) => {
      const caseRes = await tx.query("SELECT * FROM public.cases WHERE id = $1", [caseA]);
      expect(caseRes.rows.length).toBe(0);

      const entityRes = await tx.query("SELECT * FROM public.case_entities WHERE case_id = $1", [caseA]);
      expect(entityRes.rows.length).toBe(0);
    });

    // User B tries to UPDATE User A's case -> 0 affected rows
    await asAuthenticated(db, userB, async (tx) => {
      const updateRes = await tx.query(
        "UPDATE public.cases SET name = 'Hijacked' WHERE id = $1",
        [caseA]
      );
      expect((updateRes as any).affectedRows).toBe(0);
    });

    // User B tries to DELETE User A's case -> 0 affected rows
    await asAuthenticated(db, userB, async (tx) => {
      const delRes = await tx.query("DELETE FROM public.cases WHERE id = $1", [caseA]);
      expect((delRes as any).affectedRows).toBe(0);
    });

    // Verify User A still owns their pristine data
    await asAuthenticated(db, userA, async (tx) => {
      const checkRes = await tx.query<{ name: string }>(
        "SELECT name FROM public.cases WHERE id = $1",
        [caseA]
      );
      expect(checkRes.rows[0]?.name).toBe("Case A");
    });
  }, 60_000);

  it("blocks direct DELETE on evidence_items via RLS and trigger guard", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "investigator@test.local");
    const caseId = await createTestCase(db, investigator, "Evidence Case", "draft");

    // Insert evidence as investigator
    const evidenceId = await asAuthenticated(db, investigator, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash
         ) VALUES (
           $1, $2, 'Case Name', 'contract.pdf', 2048, 'application/pdf',
           's3://vault/contract.pdf', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
         ) RETURNING id`,
        [investigator, caseId]
      );
      return res.rows[0]?.id!;
    });

    // Investigator tries direct DELETE -> blocked by table-level privilege denial
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query("DELETE FROM public.evidence_items WHERE id = $1", [evidenceId])
      )
    ).rejects.toThrow(/permission denied/);

    // Even if RLS were bypassed by service_role, direct DELETE triggers evidence_items_delete_guard
    await expect(
      asServiceRole(db, (tx) => tx.query("DELETE FROM public.evidence_items WHERE id = $1", [evidenceId]))
    ).rejects.toThrow(/Direct DELETE of evidence_items is prohibited\. Use audited delete procedure\./);
  }, 60_000);

  it("asserts RLS is enabled on 100% of public tables via assert_rls_enabled_on_all_tables()", async () => {
    const db = await createCleanroomDatabase();

    await asServiceRole(db, async (tx) => {
      const res = await tx.query<{ table_name: string; is_secure: boolean }>(
        "SELECT * FROM public.assert_rls_enabled_on_all_tables()"
      );

      expect(res.rows.length).toBe(21);
      for (const row of res.rows) {
        expect(row.is_secure, `Table ${row.table_name} must have rowsecurity = true`).toBe(true);
      }
    });
  }, 60_000);
});
