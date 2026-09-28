import {
  getRateLimiter,
  resetRateLimiterForTests,
  type RateLimitDecision,
  type RateLimitRule,
} from "@/lib/security/rate-limiter.server";

export const MAX_BODY_BYTES = 8 * 1024;

/** 20 reportov / IP / minúta — zdieľané naprieč inštanciami (P0-09). */
export const CSP_REPORT_RATE_LIMIT: RateLimitRule = {
  bucket: "csp-report",
  limit: 20,
  windowSeconds: 60,
};

/** Test hook: vymaže pamäťový limiter (používa len test suite). */
export function resetCspReportRateLimiter(): void {
  resetRateLimiterForTests();
}

export function checkCspReportRateLimit(ip: string): Promise<RateLimitDecision> {
  return getRateLimiter().hit(CSP_REPORT_RATE_LIMIT, ip);
}
