// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase } from "./harness";

let db: PGlite;

beforeAll(async () => {
  db = await freshDatabase();
}, 120_000);

afterEach(async () => {
  await db.query("reset role");
});

const HASH = "a".repeat(64);

type Decision = { allowed: boolean; remaining: number; reset_at: string };

async function hit(bucket: string, keyHash: string, limit: number): Promise<Decision> {
  const res = await db.query<{ r: Decision }>(
    "select public.rate_limit_hit($1, $2, $3, 60) as r",
    [bucket, keyHash, limit],
  );
  return res.rows[0]!.r;
}

describe("P0-09 — rate_limit_hit (zdieľané počítadlo)", () => {
  it("počíta atomicky a po prekročení limitu odmieta", async () => {
    await db.query("set role service_role");
    expect(await hit("csp-report", HASH, 2)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await hit("csp-report", HASH, 2)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await hit("csp-report", HASH, 2)).toMatchObject({ allowed: false, remaining: 0 });
    // Iný bucket s rovnakým kľúčom má vlastné počítadlo.
    expect(await hit("health-observe", HASH, 2)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("odmietne neplatné parametre (napr. surovú IP namiesto hashu)", async () => {
    await db.query("set role service_role");
    await expect(hit("csp-report", "203.0.113.7", 2)).rejects.toThrow(/invalid rate limit parameters/);
    await expect(hit("csp-report", HASH, 0)).rejects.toThrow(/invalid rate limit parameters/);
  });

  it("anon ani authenticated funkciu nevolajú a tabuľku nečítajú", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.query(`set role ${role}`);
      await expect(hit("csp-report", "b".repeat(64), 5)).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.rate_limit_counters")).rejects.toThrow(/permission denied/);
      await db.query("reset role");
    }
  });
});
