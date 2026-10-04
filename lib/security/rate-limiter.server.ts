import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * P0-09 (N-04): zdieľaný rate limiting pre API routes.
 *
 * In-memory `Map` v jednom procese na serverless platforme neplatí naprieč
 * inštanciami — rozložením požiadaviek sa limit obíde. V produkcii preto
 * počítadlo žije v Postgrese (`rate_limit_hit`, spoločné pre všetky inštancie).
 * Pamäťová implementácia ostáva len pre vývoj a testy.
 *
 * Fail-closed: v produkcii bez konfigurácie alebo pri chybe DB sa požiadavka
 * nepustí (limit sa nedá overiť → odmietnutie), nikdy sa neprepne na pamäť.
 */

export type RateLimitDecision = {
  allowed: boolean;
  /** Zostávajúce požiadavky v okne (0 pri odmietnutí). */
  remaining: number;
  /** true = limit sa nedal overiť (chýba konfigurácia alebo zlyhala DB). */
  unavailable?: boolean;
};

export type RateLimitRule = {
  /** Názov limitu, napr. "csp-report". */
  bucket: string;
  /** Maximálny počet požiadaviek v okne. */
  limit: number;
  windowSeconds: number;
};

export interface RateLimiter {
  hit(rule: RateLimitRule, key: string): Promise<RateLimitDecision>;
}

/** SHA-256 kľúča — IP adresy ani ID používateľov sa neukladajú v čitateľnej forme. */
export function rateLimitKeyHash(bucket: string, key: string): string {
  return createHash("sha256").update(`${bucket}\u0000${key}`).digest("hex");
}

/** Posuvné okno v pamäti procesu — iba pre vývoj a testy. */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter & { reset(): void } {
  const hitsByKey = new Map<string, number[]>();
  return {
    async hit(rule, key) {
      const at = now();
      const id = `${rule.bucket}:${rateLimitKeyHash(rule.bucket, key)}`;
      const recent = (hitsByKey.get(id) ?? []).filter((t) => t > at - rule.windowSeconds * 1000);
      if (recent.length >= rule.limit) {
        hitsByKey.set(id, recent);
        return { allowed: false, remaining: 0 };
      }
      recent.push(at);
      hitsByKey.set(id, recent);
      return { allowed: true, remaining: rule.limit - recent.length };
    },
    reset() {
      hitsByKey.clear();
    },
  };
}

const RpcResultSchema = z.object({
  allowed: z.boolean(),
  remaining: z.number().int().nonnegative(),
});

type RpcCall = (
  fn: "rate_limit_hit",
  args: { _bucket: string; _key_hash: string; _limit: number; _window_seconds: number },
) => PromiseLike<{ data: unknown; error: unknown }>;

/** Zdieľané počítadlo v Postgrese cez service rolu (funkcia `rate_limit_hit`). */
export function createSupabaseRateLimiter(rpc: RpcCall): RateLimiter {
  return {
    async hit(rule, key) {
      try {
        const { data, error } = await rpc("rate_limit_hit", {
          _bucket: rule.bucket,
          _key_hash: rateLimitKeyHash(rule.bucket, key),
          _limit: rule.limit,
          _window_seconds: rule.windowSeconds,
        });
        const parsed = RpcResultSchema.safeParse(data);
        if (error || !parsed.success) return { allowed: false, remaining: 0, unavailable: true };
        return parsed.data;
      } catch {
        return { allowed: false, remaining: 0, unavailable: true };
      }
    },
  };
}

const unavailableLimiter: RateLimiter = {
  async hit() {
    return { allowed: false, remaining: 0, unavailable: true };
  },
};

let memoryLimiter: (RateLimiter & { reset(): void }) | null = null;
let sharedLimiter: RateLimiter | null = null;

/**
 * Limiter pre aktuálne prostredie: produkcia → zdieľaný v Supabase (bez
 * konfigurácie fail-closed), inak pamäťový.
 */
export function getRateLimiter(): RateLimiter {
  if (process.env.NODE_ENV !== "production") {
    memoryLimiter ??= createMemoryRateLimiter();
    return memoryLimiter;
  }
  if (sharedLimiter) return sharedLimiter;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return unavailableLimiter;
  // Zdieľaný admin klient: vie aj nové nepriehľadné kľúče `sb_secret_…`
  // (posiela ich ako `apikey`, nie ako Bearer JWT).
  sharedLimiter = createSupabaseRateLimiter(async (fn, args) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin.rpc(fn, args);
  });
  return sharedLimiter;
}

/** Test hook: vymaže pamäťový limiter a zabudne zdieľaného klienta. */
export function resetRateLimiterForTests(): void {
  memoryLimiter?.reset();
  sharedLimiter = null;
}
