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

const KEY = "b".repeat(64);
const OTHER_KEY = "c".repeat(64);

function expiresIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function consume(key: string, expiresAt: string): Promise<boolean> {
  const res = await db.query<{ ok: boolean }>(
    "select public.webauthn_consume_challenge($1, $2::timestamptz) as ok",
    [key, expiresAt],
  );
  return res.rows[0]!.ok;
}

describe("WebAuthn single-use challenges (webauthn_consume_challenge)", () => {
  it("accepts a challenge once and rejects every later use of it", async () => {
    await db.query("set role service_role");
    const expiry = expiresIn(120);
    expect(await consume(KEY, expiry)).toBe(true);
    expect(await consume(KEY, expiry)).toBe(false);
    // Re-minting the cookie with a later expiry does not reopen the challenge.
    expect(await consume(KEY, expiresIn(240))).toBe(false);
  });

  it("tracks each challenge independently", async () => {
    await db.query("set role service_role");
    expect(await consume(OTHER_KEY, expiresIn(120))).toBe(true);
  });

  it("rejects malformed parameters", async () => {
    await db.query("set role service_role");
    await expect(consume("not-a-hash", expiresIn(120))).rejects.toThrow(/invalid challenge parameters/);
  });

  it("is not callable by anon or authenticated clients", async () => {
    await db.query("set role authenticated");
    await expect(consume("d".repeat(64), expiresIn(120))).rejects.toThrow(/permission denied/);
    await db.query("set role anon");
    await expect(consume("d".repeat(64), expiresIn(120))).rejects.toThrow(/permission denied/);
  });

  it("keeps the spent-challenge table unreadable to client roles", async () => {
    await db.query("set role authenticated");
    await expect(db.query("select count(*) from public.webauthn_spent_challenges")).rejects.toThrow(
      /permission denied/,
    );
  });
});
