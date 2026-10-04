import {
  getRateLimiter,
  resetRateLimiterForTests,
  type RateLimitDecision,
  type RateLimitRule,
} from "@/lib/security/rate-limiter.server";

/** 10 hlásení / používateľ / minúta — zdieľané naprieč inštanciami (P0-09). */
export const OBSERVE_REPORT_RATE_LIMIT: RateLimitRule = {
  bucket: "health-observe",
  limit: 10,
  windowSeconds: 60,
};

/** Test hook: vymaže pamäťový limiter (používa len test suite). */
export function resetReportRateLimiter(): void {
  resetRateLimiterForTests();
}

export function checkObserveReportRateLimit(userId: string): Promise<RateLimitDecision> {
  return getRateLimiter().hit(OBSERVE_REPORT_RATE_LIMIT, userId);
}
