import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "supabase/migrations/20261004130000_evidence_case_id_transition_guard.sql",
  ),
  "utf8",
);

describe("evidence_items case_id transition guard", () => {
  it("inventories legacy NULL case relationships without assigning a guessed case", () => {
    expect(migration).toContain("evidence_items_legacy_unresolved");
    expect(migration).toMatch(/WHERE case_id IS NULL/i);
    expect(migration).not.toMatch(/SET case_id\s*=\s*.*case_name/i);
  });

  it("rejects every new evidence insert without case_id at the database boundary", () => {
    expect(migration).toMatch(/IF NEW\.case_id IS NULL THEN/i);
    expect(migration).toMatch(/RAISE EXCEPTION 'case_id is required for new evidence_items records/i);
    expect(migration).toMatch(/USING errcode = '23502'/i);
  });
});
