// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { freshDatabase } from "./harness";

const SCRIPT = path.resolve(__dirname, "../verify/evidence_items_rls.sql");

describe("supabase/verify/evidence_items_rls.sql", () => {
  it("runs on a freshly migrated database, reports every check and leaves no data behind", async () => {
    const db = await freshDatabase();
    const results = await db.exec(fs.readFileSync(SCRIPT, "utf8"));
    const rows = (results.at(-1)?.rows ?? []) as {
      check_name: string;
      status: string;
      detail: string;
    }[];

    const byName = Object.fromEntries(rows.map((row) => [row.check_name, row.status]));
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(rows.filter((row) => row.status === "FAIL")).toEqual([]);
    // Current policies: isolation and legal hold hold, but the ledger itself is mutable.
    expect(byName["Nemennosť hashu a S3 kľúča"]).toBe("FINDING");
    expect(byName["Zmazanie dôkazu bez legal hold"]).toBe("FINDING");

    const leftovers = await db.query<{ n: number }>(
      "select (select count(*) from public.evidence_items)::int + (select count(*) from auth.users where email like 'rls-check-%')::int as n",
    );
    expect(leftovers.rows[0]?.n).toBe(0);
    const role = await db.query<{ r: string }>("select current_user as r");
    expect(role.rows[0]?.r).toBe("postgres");
    await db.close();
  }, 120_000);
});

describe("RLS verification script — negative control", () => {
  it("reports FAIL when a policy leaks rows to other investigators", async () => {
    const db = await freshDatabase();
    await db.exec(
      `create policy "leak" on public.evidence_items for select to authenticated using (true);`,
    );
    const results = await db.exec(fs.readFileSync(SCRIPT, "utf8"));
    const rows = (results.at(-1)?.rows ?? []) as { check_name: string; status: string }[];
    const failed = rows.filter((row) => row.status === "FAIL").map((row) => row.check_name);
    expect(failed).toEqual(
      expect.arrayContaining(["Počet politík", "Žiadna politika USING (true)", "Cudzí používateľ nevidí dôkazy"]),
    );
    await db.close();
  }, 120_000);
});
