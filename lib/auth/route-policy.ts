/**
 * Single source of truth for routes that are intentionally public.
 *
 * Keep this module free of framework imports: it is consumed by both the
 * request middleware and server-side auth helpers.
 */
export const PUBLIC_ROUTES = [
  "/",
  "/auth",
  "/auth/login",
  "/auth/register",
  "/blog",
  "/blog/[...slug]",
  "/api/csp-report",
  "/api/csp-report/*",
  "/api/healthz",
  "/api/healthz/*",
  "/api/health/public",
  "/api/health/public/",
  "/forza/stav",
  "/forza/stav/",
] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/** Match exact, prefix (`/*`) and catch-all (`/[...param]`) route patterns. */
export function matchRoutePattern(pathname: string, pattern: string): boolean {
  if (pathname === pattern) return true;

  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return pathname.startsWith(`${prefix}/`);
  }

  const catchAllIndex = pattern.indexOf("/[...");
  if (catchAllIndex >= 0) {
    return pathname.startsWith(`${pattern.slice(0, catchAllIndex)}/`);
  }

  return false;
}

export function isPublicRoutePattern(pathname: string): boolean {
  return PUBLIC_ROUTES.some((pattern) => matchRoutePattern(pathname, pattern));
}
