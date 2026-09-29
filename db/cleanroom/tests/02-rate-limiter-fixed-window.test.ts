// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createCleanroomDatabase, asServiceRole } from "./cleanroom-harness";

describe("Regression Suite: 02 - Fixed-Window Rate Limiter & Concurrency", () => {
  it("enforces exact fixed-window rate limiting: requests 1..N allowed, N+1 denied", async () => {
    const db = await createCleanroomDatabase();
    const key = "ip:192.168.1.100:login";
    const maxRequests = 3;
    const windowSeconds = 60;

    await asServiceRole(db, async (tx) => {
      // 1st request -> Allowed, remaining = 2
      const res1 = await tx.query<{ allowed: boolean; remaining: number; reset_at: string }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(res1.rows[0]?.allowed).toBe(true);
      expect(res1.rows[0]?.remaining).toBe(2);
      const resetAt1 = res1.rows[0]?.reset_at;

      // 2nd request -> Allowed, remaining = 1, reset_at unchanged (FIXED window)
      const res2 = await tx.query<{ allowed: boolean; remaining: number; reset_at: string }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(res2.rows[0]?.allowed).toBe(true);
      expect(res2.rows[0]?.allowed).toBe(true);
      expect(res2.rows[0]?.remaining).toBe(1);
      expect(new Date(res2.rows[0]?.reset_at!).getTime()).toBe(new Date(resetAt1!).getTime());

      // 3rd request -> Allowed, remaining = 0
      const res3 = await tx.query<{ allowed: boolean; remaining: number; reset_at: string }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(res3.rows[0]?.allowed).toBe(true);
      expect(res3.rows[0]?.remaining).toBe(0);
      expect(new Date(res3.rows[0]?.reset_at!).getTime()).toBe(new Date(resetAt1!).getTime());

      // 4th request (N+1) -> DENIED
      const res4 = await tx.query<{ allowed: boolean; remaining: number; reset_at: string }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(res4.rows[0]?.allowed).toBe(false);
      expect(res4.rows[0]?.remaining).toBe(0);
      expect(new Date(res4.rows[0]?.reset_at!).getTime()).toBe(new Date(resetAt1!).getTime());

      // 5th request -> Still DENIED
      const res5 = await tx.query<{ allowed: boolean; remaining: number; reset_at: string }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(res5.rows[0]?.allowed).toBe(false);
      expect(res5.rows[0]?.remaining).toBe(0);
    });
  }, 60_000);

  it("check_rate_limit does NOT consume quota or mutate rate_limits state", async () => {
    const db = await createCleanroomDatabase();
    const key = "user:42:status_check";
    const maxRequests = 5;
    const windowSeconds = 120;

    await asServiceRole(db, async (tx) => {
      // Check before any consume -> Allowed, remaining = 5
      const check1 = await tx.query<{ allowed: boolean; remaining: number }>(
        "SELECT * FROM public.check_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(check1.rows[0]?.allowed).toBe(true);
      expect(check1.rows[0]?.remaining).toBe(5);

      // Check again -> Still Allowed, remaining = 5 (zero consumption)
      const check2 = await tx.query<{ allowed: boolean; remaining: number }>(
        "SELECT * FROM public.check_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(check2.rows[0]?.allowed).toBe(true);
      expect(check2.rows[0]?.remaining).toBe(5);

      // Verify no row was inserted into rate_limits table
      const countRes = await tx.query<{ count: string }>(
        "SELECT count(*) FROM public.rate_limits WHERE key = $1",
        [key]
      );
      expect(parseInt(countRes.rows[0]?.count || "0", 10)).toBe(0);

      // Now consume 1 request
      const consume1 = await tx.query<{ allowed: boolean; remaining: number }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(consume1.rows[0]?.allowed).toBe(true);
      expect(consume1.rows[0]?.remaining).toBe(4);

      // Check again -> Now shows remaining = 4 without consuming further
      const check3 = await tx.query<{ allowed: boolean; remaining: number }>(
        "SELECT * FROM public.check_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(check3.rows[0]?.allowed).toBe(true);
      expect(check3.rows[0]?.remaining).toBe(4);
    });
  }, 60_000);

  it("resets window and starts a new quota cycle after expiration", async () => {
    const db = await createCleanroomDatabase();
    const key = "key:reset:test";
    const maxRequests = 2;
    const windowSeconds = 1; // 1-second window

    await asServiceRole(db, async (tx) => {
      // Exhaust quota
      await tx.query("SELECT * FROM public.consume_rate_limit($1, $2, $3)", [key, maxRequests, windowSeconds]);
      await tx.query("SELECT * FROM public.consume_rate_limit($1, $2, $3)", [key, maxRequests, windowSeconds]);
      
      const denied = await tx.query<{ allowed: boolean }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(denied.rows[0]?.allowed).toBe(false);

      // Fast-forward timestamp artificially by updating window_start
      await tx.query(
        "UPDATE public.rate_limits SET window_start = NOW() - INTERVAL '10 seconds' WHERE key = $1",
        [key]
      );

      // Now next request should start a new window
      const freshRes = await tx.query<{ allowed: boolean; remaining: number }>(
        "SELECT * FROM public.consume_rate_limit($1, $2, $3)",
        [key, maxRequests, windowSeconds]
      );
      expect(freshRes.rows[0]?.allowed).toBe(true);
      expect(freshRes.rows[0]?.remaining).toBe(1);
    });
  }, 60_000);

  it("rejects invalid input parameters with code 22023", async () => {
    const db = await createCleanroomDatabase();

    await expect(
      asServiceRole(db, (tx) => tx.query("SELECT * FROM public.consume_rate_limit(NULL, 10, 60)"))
    ).rejects.toThrow(/Invalid rate limit key/);

    await expect(
      asServiceRole(db, (tx) => tx.query("SELECT * FROM public.consume_rate_limit('', 10, 60)"))
    ).rejects.toThrow(/Invalid rate limit key/);

    await expect(
      asServiceRole(db, (tx) => tx.query("SELECT * FROM public.consume_rate_limit('test', 0, 60)"))
    ).rejects.toThrow(/Invalid max requests/);

    await expect(
      asServiceRole(db, (tx) => tx.query("SELECT * FROM public.consume_rate_limit('test', 10, -5)"))
    ).rejects.toThrow(/Invalid window seconds/);
  }, 60_000);

  it("cleans up expired rate limit records via cleanup_expired_rate_limits()", async () => {
    const db = await createCleanroomDatabase();

    await asServiceRole(db, async (tx) => {
      // Insert an expired record and an active record
      await tx.query(
        `INSERT INTO public.rate_limits (key, count, window_start, expires_at)
         VALUES 
           ('expired_key', 5, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),
           ('active_key', 2, NOW(), NOW() + INTERVAL '1 hour')`
      );

      const cleaned = await tx.query<{ cleanup_expired_rate_limits: string }>(
        "SELECT public.cleanup_expired_rate_limits()"
      );
      expect(parseInt(cleaned.rows[0]?.cleanup_expired_rate_limits || "0", 10)).toBe(1);

      const remaining = await tx.query<{ key: string }>(
        "SELECT key FROM public.rate_limits"
      );
      expect(remaining.rows.map((r) => r.key)).toEqual(["active_key"]);
    });
  }, 60_000);
});
