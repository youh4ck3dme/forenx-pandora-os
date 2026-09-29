// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCleanroomDatabase,
  asAuthenticated,
  asServiceRole,
  createTestUser,
  createTestCase,
} from "./cleanroom-harness";

describe("Regression Suite: 07 - Cryptographic Audit Hash-Chain Integrity", () => {
  it("enforces immutable SHA-256 hash chaining on case_audit_log inserts", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "auditor@test.local");
    const caseId = await createTestCase(db, user, "Audit Dossier", "draft");

    // Insert 3 consecutive audit events
    await asServiceRole(db, async (tx) => {
      await tx.query(
        "SELECT public.append_audit_event($1, $2, 'case_created', 'cases', $3, '{\"note\":\"init\"}'::jsonb, 'c-1')",
        [user, caseId, caseId]
      );
      await tx.query(
        "SELECT public.append_audit_event($1, $2, 'evidence_added', 'evidence_items', $3, '{\"file\":\"f1.pdf\"}'::jsonb, 'c-2')",
        [user, caseId, caseId]
      );
      await tx.query(
        "SELECT public.append_audit_event($1, $2, 'case_exported', 'cases', $3, '{\"format\":\"pdf\"}'::jsonb, 'c-3')",
        [user, caseId, caseId]
      );
    });

    // Inspect the chain
    const rows = await db.query<{
      chain_seq: number;
      previous_event_hash: string;
      event_hash: string;
      action: string;
    }>(
      "SELECT chain_seq, previous_event_hash, event_hash, action FROM public.case_audit_log WHERE user_id = $1 ORDER BY chain_seq ASC",
      [user]
    );

    expect(rows.rows.length).toBe(3);

    // Event 1: genesis event has 64 zeros as previous hash
    expect(rows.rows[0]?.chain_seq).toBe(1);
    expect(rows.rows[0]?.previous_event_hash).toBe("0".repeat(64));
    expect(rows.rows[0]?.event_hash).toMatch(/^[0-9a-f]{64}$/);

    // Event 2: chained to Event 1's hash
    expect(rows.rows[1]?.chain_seq).toBe(2);
    expect(rows.rows[1]?.previous_event_hash).toBe(rows.rows[0]?.event_hash);
    expect(rows.rows[1]?.event_hash).toMatch(/^[0-9a-f]{64}$/);

    // Event 3: chained to Event 2's hash
    expect(rows.rows[2]?.chain_seq).toBe(3);
    expect(rows.rows[2]?.previous_event_hash).toBe(rows.rows[1]?.event_hash);
    expect(rows.rows[2]?.event_hash).toMatch(/^[0-9a-f]{64}$/);

    // verify_audit_chain must report 0 problems
    const verifyRes = await asAuthenticated(db, user, (tx) =>
      tx.query("SELECT * FROM public.verify_audit_chain($1)", [user])
    );
    expect(verifyRes.rows.length).toBe(0);
  }, 60_000);

  it("detects tampering when an event hash or payload is modified", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "auditor@test.local");
    const caseId = await createTestCase(db, user, "Audit Case", "draft");

    // Create 2 events
    await asServiceRole(db, async (tx) => {
      await tx.query(
        "SELECT public.append_audit_event($1, $2, 'login', 'profiles', $3, '{}'::jsonb, 'c-1')",
        [user, caseId, user]
      );
      await tx.query(
        "SELECT public.append_audit_event($1, $2, 'export', 'cases', $3, '{}'::jsonb, 'c-2')",
        [user, caseId, caseId]
      );
    });

    // Tamper with event_hash of event 1 (simulating direct DB admin tampering with triggers disabled)
    await db.query("ALTER TABLE public.case_audit_log DISABLE TRIGGER USER");
    await db.query(
      "UPDATE public.case_audit_log SET event_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE user_id = $1 AND chain_seq = 1",
      [user]
    );
    await db.query("ALTER TABLE public.case_audit_log ENABLE TRIGGER USER");

    // verify_audit_chain must detect event_hash_mismatch
    const verifyRes = await asAuthenticated(db, user, (tx) =>
      tx.query<{ chain_seq: number; problem: string }>(
        "SELECT chain_seq, problem FROM public.verify_audit_chain($1)",
        [user]
      )
    );
    expect(verifyRes.rows.length).toBeGreaterThan(0);
    expect(verifyRes.rows[0]?.problem).toBe("event_hash_mismatch");
    expect(verifyRes.rows[0]?.chain_seq).toBe(1);
  }, 60_000);

  it("unconditionally rejects direct UPDATE, DELETE, and TRUNCATE on case_audit_log", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "user@test.local");
    const caseId = await createTestCase(db, user, "Case 1", "draft");

    await asServiceRole(db, (tx) =>
      tx.query("SELECT public.append_audit_event($1, $2, 'event1', 'cases', $3, '{}'::jsonb, 'c-1')", [
        user,
        caseId,
        caseId,
      ])
    );

    // Direct UPDATE is blocked by trigger
    await expect(
      asServiceRole(db, (tx) =>
        tx.query("UPDATE public.case_audit_log SET action = 'tampered' WHERE user_id = $1", [user])
      )
    ).rejects.toThrow(/case_audit_log is strictly append-only \(UPDATE rejected\)/);

    // Direct DELETE is blocked (without forenx.audit_erasure GUC)
    await expect(
      asServiceRole(db, (tx) =>
        tx.query("DELETE FROM public.case_audit_log WHERE user_id = $1", [user])
      )
    ).rejects.toThrow(/case_audit_log is strictly append-only \(DELETE rejected\)/);

    // TRUNCATE defense layer 1: service_role has TRUNCATE privilege revoked
    await expect(
      asServiceRole(db, (tx) => tx.query("TRUNCATE TABLE public.case_audit_log"))
    ).rejects.toThrow(/permission denied for table case_audit_log/);

    // TRUNCATE defense layer 2: superuser is blocked by BEFORE TRUNCATE trigger
    await expect(
      db.query("TRUNCATE TABLE public.case_audit_log")
    ).rejects.toThrow(/case_audit_log is strictly append-only \(TRUNCATE rejected\)/);
  }, 60_000);

  it("permits atomic complete erasure only via privileged erase_user_audit_log() RPC", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "gdpr@test.local");
    const caseId = await createTestCase(db, user, "GDPR Case", "draft");

    await asServiceRole(db, async (tx) => {
      await tx.query("SELECT public.append_audit_event($1, $2, 'e1', 'cases', $3, '{}'::jsonb, 'c-1')", [
        user,
        caseId,
        caseId,
      ]);
      await tx.query("SELECT public.append_audit_event($1, $2, 'e2', 'cases', $3, '{}'::jsonb, 'c-2')", [
        user,
        caseId,
        caseId,
      ]);
    });

    // Erase as service_role
    const erased = await asServiceRole(db, async (tx) => {
      const res = await tx.query<{ erase_user_audit_log: number }>(
        "SELECT public.erase_user_audit_log($1)",
        [user]
      );
      return res.rows[0]?.erase_user_audit_log;
    });

    expect(erased).toBe(2);

    const check = await db.query<{ count: string }>(
      "SELECT count(*) FROM public.case_audit_log WHERE user_id = $1",
      [user]
    );
    expect(parseInt(check.rows[0]?.count || "0", 10)).toBe(0);
  }, 60_000);
});
