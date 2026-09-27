const MAX_REPORTS_PER_MINUTE = 10;
const reportsByUser = new Map<string, number[]>();

/** Test hook: vymaže in-memory rate limit okná (používa len test suite). */
export function resetReportRateLimiter(): void {
  reportsByUser.clear();
}

export function isObserveReportRateLimited(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (reportsByUser.get(userId) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_REPORTS_PER_MINUTE) {
    reportsByUser.set(userId, recent);
    return true;
  }
  recent.push(now);
  reportsByUser.set(userId, recent);
  return false;
}
