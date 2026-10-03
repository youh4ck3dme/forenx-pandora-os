/**
 * Single source of truth for routes that are intentionally public.
 *
 * Keep this module free of framework imports: it is consumed by both the
 * request middleware and server-side auth helpers.
 */

/**
 * Route categories for access control. Defined here (not in middleware.ts) so
 * lib/auth can use the type without creating a circular import.
 */
export type RouteCategory = 'PUBLIC' | 'AUTHENTICATED' | 'SYSTEM';

export const PUBLIC_ROUTES = [
  "/",
  "/auth",
  "/auth/",
  "/auth/login",
  "/auth/login/",
  "/auth/register",
  "/auth/register/",
  "/blog",
  "/blog/",
  "/blog/[...slug]",
  "/api/csp-report",
  "/api/csp-report/*",
  "/api/healthz",
  "/api/healthz/*",
  "/api/health/public",
  "/api/health/public/",
] as const;

export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

/** Match exact, prefix (`/*`) and catch-all (`/[...param]`) route patterns. */
export function matchRoutePattern(pathname: string, pattern: string): boolean {
  if (pathname === pattern) return true;

  // Exact normalized match ignoring trailing slashes (e.g. /auth/login/ matches /auth/login)
  const normPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const normPattern = pattern.length > 1 && pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  if (normPath === normPattern) return true;

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
