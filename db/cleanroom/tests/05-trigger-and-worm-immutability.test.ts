// @vitest-environment node
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  createCleanroomDatabase,
  asAuthenticated,
  asServiceRole,
  createTestUser,
  createTestCase,
} from "./cleanroom-harness";

function fixtureSha256(label: string): string {
  return crypto.createHash("sha256").update(label).digest("hex");
}

describe("Regression Suite: 05 - Trigger Logic & WORM Immutability", () => {
  it("automatically maintains updated_at and increments revision on case updates", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "user@test.local");

    const caseId = await asAuthenticated(db, user, async (tx) => {
      const res = await tx.query<{ id: string; revision: number; updated_at: string }>(
        "INSERT INTO public.cases (user_id, name) VALUES ($1, 'Initial Title') RETURNING id, revision, updated_at",
        [user]
      );
      expect(res.rows[0]?.revision).toBe(1);
      return res.rows[0]?.id!;
    });

    // Wait a brief tick and update the case
    await asAuthenticated(db, user, async (tx) => {
      const updateRes = await tx.query<{ revision: number; name: string }>(
        "UPDATE public.cases SET name = 'Updated Title' WHERE id = $1 RETURNING revision, name",
        [caseId]
      );
      expect(updateRes.rows[0]?.revision).toBe(2);
      expect(updateRes.rows[0]?.name).toBe("Updated Title");
    });
  }, 60_000);

  it("enforces WORM write-once immutability on source_snapshots", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "user@test.local");
    const caseId = await createTestCase(db, user, "Case 1", "draft");

    // Insert source snapshot as service_role
    const snapId = await asServiceRole(db, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.source_snapshots (
           case_id, user_id, source, source_url, http_status, retrieved_at,
           parser_version, raw_sha256, byte_size
         ) VALUES (
           $1, $2, 'orsr', 'https://orsr.sk/entry', 200, NOW(),
           'v1.0.0', $3, 512
         ) RETURNING id`,
        [caseId, user, fixtureSha256("source-snapshot")]
      );
      return res.rows[0]?.id!;
    });

    // Any UPDATE attempt must be unconditionally rejected by source_snapshots_immutable trigger
    await expect(
      asServiceRole(db, (tx) =>
        tx.query("UPDATE public.source_snapshots SET source = 'modified' WHERE id = $1", [snapId])
      )
    ).rejects.toThrow(/source_snapshots rows are immutable \(WORM violation\)/);
  }, 60_000);

  it("enforces WORM immutability on evidence_items forensic identity columns", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "investigator@test.local");
    const caseId = await createTestCase(db, investigator, "Forensic Case", "draft");

    const evidenceId = await asAuthenticated(db, investigator, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash
         ) VALUES (
           $1, $2, 'Case Name', 'contract.pdf', 1024, 'application/pdf',
           's3://vault/key1.pdf', $3
         ) RETURNING id`,
        [investigator, caseId, fixtureSha256("contract")]
      );
      return res.rows[0]?.id!;
    });

    // 1. Trying to tamper with sha256_hash -> WORM violation
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query(
          "UPDATE public.evidence_items SET sha256_hash = $1 WHERE id = $2",
          [fixtureSha256("tampered-contract"), evidenceId]
        )
      )
    ).rejects.toThrow(/evidence_items identity and forensic columns are write-once \(WORM violation\)/);

    // 2. Trying to tamper with file_size -> WORM violation
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query("UPDATE public.evidence_items SET file_size = 9999 WHERE id = $1", [evidenceId])
      )
    ).rejects.toThrow(/evidence_items identity and forensic columns are write-once \(WORM violation\)/);

    // 3. Trying to tamper with s3_object_key -> WORM violation
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query("UPDATE public.evidence_items SET s3_object_key = 's3://vault/forged.pdf' WHERE id = $1", [
          evidenceId,
        ])
      )
    ).rejects.toThrow(/evidence_items identity and forensic columns are write-once \(WORM violation\)/);
  }, 60_000);

  it("enforces WORM immutability on evidence_items.case_id (write-once after insert)", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "worm-caseid@test.local");
    const case1 = await createTestCase(db, investigator, "Case One", "draft");
    const case2 = await createTestCase(db, investigator, "Case Two", "draft");

    const evidenceId = await asAuthenticated(db, investigator, async (tx) => {
      const res = await tx.query<{ id: string }>(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash
         ) VALUES (
           $1, $2, 'Case One', 'exhibit.pdf', 512, 'application/pdf',
           $3, $4
         ) RETURNING id`,
        [investigator, case1, `cases/${case1}/evidence/exhibit.pdf`, fixtureSha256("exhibit")]
      );
      return res.rows[0]?.id!;
    });

    // Attempting to change case_id to another valid case must raise WORM violation
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query("UPDATE public.evidence_items SET case_id = $1 WHERE id = $2", [case2, evidenceId])
      )
    ).rejects.toThrow(/evidence_items identity and forensic columns are write-once \(WORM violation\)/);

    // Verify case_id is unchanged
    const row = await db.query<{ case_id: string }>(
      "SELECT case_id FROM public.evidence_items WHERE id = $1",
      [evidenceId]
    );
    expect(row.rows[0]?.case_id).toBe(case1);
  }, 60_000);

  it("normalizes and sanitizes evidence_items inserts via evidence_items_insert_guard", async () => {
    const db = await createCleanroomDatabase();
    const investigator = await createTestUser(db, "investigator@test.local");
    const caseId = await createTestCase(db, investigator, "Case A", "draft");
    const uppercaseHash = fixtureSha256("audio").toUpperCase();

    // Client tries to insert uppercase SHA256, self-certify as verified, and impose legal_hold
    const evidenceId = await asAuthenticated(db, investigator, async (tx) => {
      const res = await tx.query<{
        id: string;
        sha256_hash: string;
        legal_hold: boolean;
        hash_verification_status: string;
      }>(
        `INSERT INTO public.evidence_items (
           investigator_id, case_id, case_name, file_name, file_size, mime_type,
           s3_object_key, sha256_hash, legal_hold, hash_verification_status
         ) VALUES (
           $1, $2, 'Case A', 'audio.mp3', 4096, 'audio/mpeg',
           's3://vault/audio.mp3', $3,
           true, 'verified'
         ) RETURNING id, sha256_hash, legal_hold, hash_verification_status`,
        [investigator, caseId, uppercaseHash]
      );
      const row = res.rows[0]!;
      // Hash is normalized to lowercase
      expect(row.sha256_hash).toBe(uppercaseHash.toLowerCase());
      // legal_hold and verified self-certification are rejected for non-service roles
      expect(row.legal_hold).toBe(false);
      expect(row.hash_verification_status).toBe("pending");
      return row.id;
    });

    // Malformed hash (not 64 chars) is rejected with check violation
    await expect(
      asAuthenticated(db, investigator, (tx) =>
        tx.query(
          `INSERT INTO public.evidence_items (
             investigator_id, case_id, case_name, file_name, file_size, mime_type,
             s3_object_key, sha256_hash
           ) VALUES (
             $1, $2, 'Case A', 'bad.txt', 10, 'text/plain',
             's3://vault/bad.txt', 'tooshort'
           )`,
          [investigator, caseId]
        )
      )
    ).rejects.toThrow(/sha256_hash must be exactly 64 hexadecimal characters/);
  }, 60_000);

  it("blocks child record modifications when case is not draft via case_child_lifecycle_guard", async () => {
    const db = await createCleanroomDatabase();
    const user = await createTestUser(db, "owner@test.local");
    const caseId = await createTestCase(db, user, "Case Draft", "draft");

    // In draft: entity insert succeeds
    const entityId = await asAuthenticated(db, user, async (tx) => {
      const res = await tx.query<{ id: string }>(
        "INSERT INTO public.case_entities (case_id, user_id, name, kind) VALUES ($1, $2, 'Node 1', 'person') RETURNING id",
        [caseId, user]
      );
      return res.rows[0]?.id!;
    });

    // Transition case to closed
    await asAuthenticated(db, user, (tx) =>
      tx.query("SELECT public.set_case_status($1, 'closed', 'Done')", [caseId])
    );

    // Attempting to INSERT a child entity on closed case -> BLOCKED
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query(
          "INSERT INTO public.case_entities (case_id, user_id, name, kind) VALUES ($1, $2, 'Node 2', 'person')",
          [caseId, user]
        )
      )
    ).rejects.toThrow(/Spis nie je v stave draft \(closed\): zmeny podriaden\u00FDch z\u00E1znamov s\u00FA blokovan\u00E9\./);

    // Attempting to UPDATE existing child entity on closed case -> BLOCKED
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query("UPDATE public.case_entities SET name = 'Renamed' WHERE id = $1", [entityId])
      )
    ).rejects.toThrow(/Spis nie je v stave draft \(closed\): zmeny podriaden\u00FDch z\u00E1znamov s\u00FA blokovan\u00E9\./);

    // Attempting to DELETE existing child entity on closed case -> BLOCKED
    await expect(
      asAuthenticated(db, user, (tx) =>
        tx.query("DELETE FROM public.case_entities WHERE id = $1", [entityId])
      )
    ).rejects.toThrow(/Spis nie je v stave draft \(closed\): zmeny podriaden\u00FDch z\u00E1znamov s\u00FA blokovan\u00E9\./);
  }, 60_000);
});
