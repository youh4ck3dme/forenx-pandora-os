const MAX_REPORTS_PER_MINUTE = 20;
export const MAX_BODY_BYTES = 8 * 1024;
const reportsByIp = new Map<string, number[]>();

/** Test hook: vymaže in-memory rate limit okná (používa len test suite). */
export function resetCspReportRateLimiter(): void {
  reportsByIp.clear();
}

export function isCspReportRateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (reportsByIp.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_REPORTS_PER_MINUTE) {
    reportsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  reportsByIp.set(ip, recent);
  return false;
}
