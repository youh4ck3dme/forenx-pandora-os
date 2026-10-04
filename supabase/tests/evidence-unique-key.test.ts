// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createCase, createUser, freshDatabase } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

function evidenceRow(investigatorId: string, caseId: string, s3Key: string) {
  return [
    "insert into public.evidence_items (investigator_id, case_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)",
    "values ($1, $2, 'Case A', 'zmluva.pdf', 1024, 'application/pdf', $3, $4)",
    "returning id",
  ].join(" ");
}

describe("P0-03 — unique index na s3_object_key (transakčná perzistencia)", () => {
  it("druhý zápis toho istého S3 objektu je atomicky odmietnutý", async () => {
    const user = await createUser(db, "owner@evidence.test");
    const caseId = await createCase(db, user);
    const key = "cases/CASE-1/evidence/" + "a".repeat(64) + "-zmluva.pdf";
    const sha = "a".repeat(64);

    const first = await db.query<{ id: string }>(evidenceRow(user, caseId, key), [
      user,
      caseId,
      key,
      sha,
    ]);
    expect(first.rows).toHaveLength(1);

    let duplicateBlocked = false;
    try {
      await db.query(evidenceRow(user, caseId, key), [user, caseId, key, sha]);
    } catch (error) {
      duplicateBlocked = true;
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toMatch(/duplicate|unique/i);
    }
    expect(duplicateBlocked).toBe(true);

    // V ledgeri zostáva presne jeden záznam objektu.
    const count = await db.query<{ n: number }>(
      "select count(*)::int as n from public.evidence_items where s3_object_key = $1",
      [key],
    );
    expect(count.rows[0]?.n).toBe(1);
  });

  it("rozdielne objekty (rôzne kľúče) sa zapisujú neobmedzene", async () => {
    const user = await createUser(db, "owner2@evidence.test");
    const caseId = await createCase(db, user);
    for (let i = 0; i < 3; i += 1) {
      const key = `cases/CASE-2/evidence/${"b".repeat(64)}-${i}.pdf`;
      const res = await db.query(evidenceRow(user, caseId, key), [
        user,
        caseId,
        key,
        "b".repeat(64),
      ]);
      expect(res.rows).toHaveLength(1);
    }
  });
});
