// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCleanroomDatabase,
  asAuthenticated,
  asServiceRole,
  createTestUser,
  createTestCase,
  createTestEvidence,
} from "./cleanroom-harness";

describe("Regression Suite: 06 - Legal Hold Inviolability & Controlled Destruction", () => {
  it("prevents non-admins from releasing legal_hold on a case", async () => {
    const db = await createCleanroomDatabase();
    const owner = await createTestUser(db, "owner@test.local", false);
    const admin = await createTestUser(db, "admin@test.local", true);
    const caseId = await createTestCase(db, owner, "Protected Case", "draft");

    // Owner places case under legal_hold
    await asAuthenticated(db, owner, (tx) =>
      tx.query("SELECT public.set_case_status($1, 'legal_hold', 'Court order § 100')", [caseId])
    );

    // Regular owner attempts to release legal_hold -> REJECTED
    await expect(
      asAuthenticated(db, owner, (tx) =>
        tx.query("SELECT public.set_case_status($1, 'closed', 'Try release')", [caseId])
      )
    ).rejects.toThrow(/Zru\u0161enie legal hold vy\u017Eaduje schv\u00E1lenie administr\u00E1torom/);

    // Admin releases legal_hold -> SUCCEEDS
    await asAuthenticated(db, admin, async (tx) => {
      const res = await tx.query<{ set_case_status: string }>(
        "SELECT public.set_case_status($1, 'closed', 'Admin authorized')",
        [caseId]
      );
      expect(res.rows[0]?.set_case_status).toBe("closed");
    });
  }, 60_000);

  it("strictly prevents deletion of evidence under legal_hold", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "inv@test.local", false);
    const caseId = await createTestCase(db, investigator, "Evidence Hold Case", "draft");

    // Create evidence under legal_hold via service_role
    const evidenceId = await asServiceRole(db, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash, legal_hold
         ) VALUES (
           $1, $2, 'Case Name', 'weapon_log.pdf', 2048, 'application/pdf',
           's3://vault/weapon_log.pdf', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
           true
         ) RETURNING id`,
        [investigator, caseId]
      );
      return res.rows[0]?.id!;
    });

    // Calling delete_evidence_item_audited on held evidence -> REJECTED
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query("SELECT public.delete_evidence_item_audited($1, 'Lawyer requested')", [evidenceId])
      )
    ).rejects.toThrow(/D\u00F4kaz podlieha legal hold: vymazanie je pr\u00EDsne zak\u00E1zan\u00E9\./);
  }, 60_000);

  it("blocks case destruction if case is under legal_hold or active evidence exists", async () => {
    const db = await createCleanroomDatabase();
    const admin = await createTestUser(db, "admin@test.local", true);
    const owner = await createTestUser(db, "owner@test.local", false);
    const caseId = await createTestCase(db, owner, "Hold Dossier", "draft");

    // Place under legal_hold
    await asAuthenticated(db, owner, (tx) =>
      tx.query("SELECT public.set_case_status($1, 'legal_hold', 'Freeze')", [caseId])
    );

    // Admin attempts to destroy case under legal_hold -> REJECTED
    await expect(
      asAuthenticated(db, admin, (tx) =>
        tx.query("SELECT public.destroy_case($1, 'Decommission')", [caseId])
      )
    ).rejects.toThrow(/Spis pod legal hold nemo\u017Eno zni\u010Di\u0165\./);

    // Admin releases hold to closed -> archived
    await asAuthenticated(db, admin, async (tx) => {
      await tx.query("SELECT public.set_case_status($1, 'closed')", [caseId]);
      await tx.query("SELECT public.set_case_status($1, 'archived')", [caseId]);
    });

    // Attach an evidence item to the case
    await asServiceRole(db, (tx) =>
      tx.query(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash
         ) VALUES (
           $1, $2, 'Case Name', 'doc.pdf', 100, 'application/pdf',
           's3://vault/doc.pdf', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
         )`,
        [owner, caseId]
      )
    );

    // Admin attempts to destroy case with active evidence -> REJECTED
    await expect(
      asAuthenticated(db, admin, (tx) =>
        tx.query("SELECT public.destroy_case($1, 'Decommission')", [caseId])
      )
    ).rejects.toThrow(/Spis obsahuje evidovan\u00E9 d\u00F4kazy/);
  }, 60_000);

  it("successfully performs audited controlled destruction on eligible archived cases", async () => {
    const db = await createCleanroomDatabase();
    const admin = await createTestUser(db, "admin@test.local", true);
    const owner = await createTestUser(db, "owner@test.local", false);
    const caseId = await createTestCase(db, owner, "Archived Dossier", "draft");

    // Add child entities and events
    await asAuthenticated(db, owner, async (tx) => {
      await tx.query(
        "INSERT INTO public.case_entities (case_id, user_id, name, kind) VALUES ($1, $2, 'Entity 1', 'company')",
        [caseId, owner]
      );
      await tx.query(
        "INSERT INTO public.case_events (case_id, user_id, date, title) VALUES ($1, $2, '2026-01-01', 'Event 1')",
        [caseId, owner]
      );
    });

    // Transition draft -> closed -> archived
    await asAuthenticated(db, owner, async (tx) => {
      await tx.query("SELECT public.set_case_status($1, 'closed')", [caseId]);
      await tx.query("SELECT public.set_case_status($1, 'archived')", [caseId]);
    });

    // Admin executes destroy_case
    await asAuthenticated(db, admin, async (tx) => {
      const res = await tx.query<{ destroy_case: boolean }>(
        "SELECT public.destroy_case($1, 'Legitimate shredding § 15')",
        [caseId]
      );
      expect(res.rows[0]?.destroy_case).toBe(true);
    });

    // Verify case and child entities were cascaded
    const caseCheck = await db.query("SELECT * FROM public.cases WHERE id = $1", [caseId]);
    expect(caseCheck.rows.length).toBe(0);

    const entityCheck = await db.query("SELECT * FROM public.case_entities WHERE case_id = $1", [caseId]);
    expect(entityCheck.rows.length).toBe(0);

    // Verify audit log entry was written
    const auditRes = await db.query<{ action: string; changes: any }>(
      "SELECT action, changes FROM public.case_audit_log WHERE record_id = $1 AND action = 'case_destroyed'",
      [caseId]
    );
    expect(auditRes.rows[0]?.action).toBe("case_destroyed");
    expect(auditRes.rows[0]?.changes.reason).toBe("Legitimate shredding § 15");
  }, 60_000);

  it("preserves held evidence by failing closed on account deletion (referential restrict)", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "investigator@test.local");
    const caseId = await createTestCase(db, investigator, "Case A", "draft");

    // Add evidence
    await asServiceRole(db, (tx) =>
      tx.query(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash
         ) VALUES (
           $1, $2, 'Case A', 'record.pdf', 100, 'application/pdf',
           's3://vault/record.pdf', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
         )`,
        [investigator, caseId]
      )
    );

    // Attempting to delete investigator from auth.users must fail closed (violates evidence_items FK)
    await expect(
      db.query("DELETE FROM auth.users WHERE id = $1", [investigator])
    ).rejects.toThrow(/violates foreign key constraint/);
  }, 60_000);
});
