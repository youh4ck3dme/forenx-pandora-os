// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRateLimiter,
  createSupabaseRateLimiter,
  getRateLimiter,
  rateLimitKeyHash,
  resetRateLimiterForTests,
} from "@/lib/security/rate-limiter.server";

const RULE = { bucket: "test", limit: 3, windowSeconds: 60 };

afterEach(() => {
  vi.unstubAllEnvs();
  resetRateLimiterForTests();
});

describe("P0-09 — rate limiter", () => {
  it("pamäťový limiter: posuvné okno, nezávislé kľúče", async () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter(() => now);
    expect((await limiter.hit(RULE, "a")).allowed).toBe(true);
    expect((await limiter.hit(RULE, "a")).allowed).toBe(true);
    expect(await limiter.hit(RULE, "a")).toEqual({ allowed: true, remaining: 0 });
    expect((await limiter.hit(RULE, "a")).allowed).toBe(false);
    expect((await limiter.hit(RULE, "b")).allowed).toBe(true);
    now += 60_001;
    expect((await limiter.hit(RULE, "a")).allowed).toBe(true);
  });

  it("hash kľúča je deterministický, oddelený podľa bucketu a neobsahuje vstup", () => {
    const hash = rateLimitKeyHash("csp-report", "203.0.113.7");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(rateLimitKeyHash("csp-report", "203.0.113.7"));
    expect(hash).not.toBe(rateLimitKeyHash("health-observe", "203.0.113.7"));
  });

  it("zdieľaný limiter posiela do DB len hash a preberá rozhodnutie", async () => {
    const rpc = vi.fn(async () => ({ data: { allowed: false, remaining: 0 }, error: null }));
    const limiter = createSupabaseRateLimiter(rpc);
    expect(await limiter.hit(RULE, "user-1")).toEqual({ allowed: false, remaining: 0 });
    expect(rpc).toHaveBeenCalledWith("rate_limit_hit", {
      _bucket: "test",
      _key_hash: rateLimitKeyHash("test", "user-1"),
      _limit: 3,
      _window_seconds: 60,
    });
  });

  it("zdieľaný limiter je fail-closed pri chybe, výnimke aj nečakanej odpovedi", async () => {
    const failing = [
      async () => ({ data: null, error: { message: "db down" } }),
      async () => {
        throw new Error("network");
      },
      async () => ({ data: { allowed: "yes" }, error: null }),
    ];
    for (const rpc of failing) {
      const decision = await createSupabaseRateLimiter(rpc).hit(RULE, "k");
      expect(decision).toEqual({ allowed: false, remaining: 0, unavailable: true });
    }
  });

  it("produkcia bez konfigurácie nikdy nepoužije pamäťový limiter", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const decision = await getRateLimiter().hit(RULE, "k");
    expect(decision).toEqual({ allowed: false, remaining: 0, unavailable: true });
  });
});
