/**
 * PANDORA / ForenX - Authentication & Authorization Middleware
 *
 * Centralized route protection for all application routes.
 * This middleware enforces authentication and authorization at the edge,
 * preventing unauthenticated access to protected pages and APIs.
 *
 * Security Principle: Never trust client-side state. Always validate
 * authentication server-side for protected routes.
 */

import { NextRequest, NextResponse, NextMiddleware } from 'next/server';
import { createClient, type Session, type User } from '@supabase/supabase-js';
import {
  PUBLIC_ROUTES,
  matchRoutePattern,
} from '@/lib/auth/route-policy';

// ============================================================================
// ROUTE CLASSIFICATION
// ============================================================================

/**
 * Route categories for access control.
 *
 * PUBLIC: Accessible without authentication
 * AUTHENTICATED: Requires valid Supabase session
 * PROJECT_REQUIRED: Requires authenticated user with case access
 * ROLE_REQUIRED: Requires specific role (admin, etc.)
 * SYSTEM: Internal system endpoints (machine-to-machine, cron, etc.)
 */

export type RouteCategory = 'PUBLIC' | 'AUTHENTICATED' | 'PROJECT_REQUIRED' | 'ROLE_REQUIRED' | 'SYSTEM';

/**
 * Route configuration: path pattern -> category
 *
 * Order matters: more specific patterns first.
 * Patterns are matched using the pathname (not full URL).
 */

// Helper to match path against pattern (supports exact, prefix, and wildcard)
const matchPathPattern = matchRoutePattern;

/**
 * Get the category for a given path.
 * First match wins, so order patterns from most specific to least specific.
 */
function getRouteCategory(pathname: string): { category: RouteCategory; pattern: string } {
  const routeConfig: Array<{ pattern: string; category: RouteCategory }> = [
    // ======================================================================
    // PUBLIC ROUTES - Accessible without authentication
    // ======================================================================
    ...PUBLIC_ROUTES.map((pattern) => ({
      pattern,
      category: 'PUBLIC' as const,
    })),

    // ======================================================================
    // SYSTEM ROUTES - Internal system endpoints
    // ======================================================================
    // Page-level health check
    { pattern: '/healthz', category: 'SYSTEM' },
    { pattern: '/healthz/*', category: 'SYSTEM' },
    // Machine-to-machine: cron job for evidence verification
    { pattern: '/api/vault/verify', category: 'SYSTEM' },
    { pattern: '/api/vault/verify/*', category: 'SYSTEM' },
    // Machine-to-machine: Edge Function requests presigned URL from Pandora
    { pattern: '/api/forenzx/presign-for-hub', category: 'SYSTEM' },
    { pattern: '/api/forenzx/presign-for-hub/*', category: 'SYSTEM' },
    // Standard system routes
    { pattern: '/.well-known/*', category: 'SYSTEM' },

    // ======================================================================
    // PROJECT_REQUIRED ROUTES - Requires authenticated user + case access
    // ======================================================================
    // Forza routes - main forensic application
    { pattern: '/forza', category: 'PROJECT_REQUIRED' },
    { pattern: '/forza/*', category: 'PROJECT_REQUIRED' },

    // ======================================================================
    // AUTHENTICATED ROUTES - Requires valid session
    // ======================================================================
    { pattern: '/browser', category: 'AUTHENTICATED' },
    { pattern: '/forge', category: 'AUTHENTICATED' },
    { pattern: '/forge/*', category: 'AUTHENTICATED' },
    { pattern: '/offline', category: 'AUTHENTICATED' },

    // API routes that need authentication
    { pattern: '/api/vault', category: 'AUTHENTICATED' },
    { pattern: '/api/vault/*', category: 'AUTHENTICATED' },
    { pattern: '/api/audit', category: 'AUTHENTICATED' },
    { pattern: '/api/audit/*', category: 'AUTHENTICATED' },
    { pattern: '/api/health/observe', category: 'AUTHENTICATED' },
    { pattern: '/api/fn', category: 'AUTHENTICATED' },
    { pattern: '/api/fn/*', category: 'AUTHENTICATED' },

    // ======================================================================
    // DEFAULT: Everything else is AUTHENTICATED
    // This includes any new /api/* routes not explicitly classified
    // ======================================================================
    { pattern: '/*', category: 'AUTHENTICATED' },
  ];

  for (const route of routeConfig) {
    if (matchPathPattern(pathname, route.pattern)) {
      return { category: route.category, pattern: route.pattern };
    }
  }

  // Fallback: if no match, default to AUTHENTICATED for safety
  return { category: 'AUTHENTICATED', pattern: '*' };
}

// ============================================================================
// APPLICATION CONSTANTS
// ============================================================================

const SIGN_IN_ROUTE = '/auth/login';
const HOME_ROUTE = '/';

/**
 * Application internal paths - used for open redirect protection.
 * These are the only paths that can be used as redirect targets.
 */
const INTERNAL_PATH_PREFIXES = [
  '/',
  '/forza',
  '/prehlad',
  '/asistent',
  '/vztahy',
  '/workspace',
  '/cases',
  '/pripad',
  '/export',
  '/profile',
  '/settings',
  '/browser',
  '/forge',
  '/offline',
  '/auth',
  '/blog',
  '/healthz',
  '/api',
];

/**
 * Check if a path is an internal application path.
 * Used to prevent open redirect vulnerabilities.
 */
function isInternalPath(path: string): boolean {
  // Must be a relative path (not absolute URL)
  if (!path || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//')) {
    return false;
  }

  // Remove query string and hash for prefix matching
  const cleanPath = path.split('?')[0].split('#')[0];

  // Check if path starts with any internal prefix (case-insensitive)
  const lowerCleanPath = cleanPath.toLowerCase();
  for (const prefix of INTERNAL_PATH_PREFIXES) {
    const lowerPrefix = prefix.toLowerCase();
    if (lowerCleanPath === lowerPrefix || lowerCleanPath.startsWith(`${lowerPrefix}/`)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate and sanitize redirect target.
 * Returns the sanitized path or null if invalid.
 *
 * Security: Rejects absolute URLs, javascript:, data: URIs, and path traversal.
 */
function validateRedirectTarget(next: string | null): string | null {
  if (!next) return null;

  let trimmed = next.trim();
  if (!trimmed) return null;

  // Check for encoded slashes or other dangerous characters in the raw input
  if (trimmed.includes('%2F') || trimmed.includes('%5C') || trimmed.includes('\\') || trimmed.includes('%00')) {
    return null;
  }

  // Reject paths that are only query strings or fragments
  if (trimmed.startsWith('?') || trimmed.startsWith('#')) {
    return null;
  }

  // Reject absolute URLs (http, https, protocol-relative)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('//')) {
    return null;
  }

  // Reject javascript: and data: URLs
  if (trimmed.toLowerCase().startsWith('javascript:') || trimmed.toLowerCase().startsWith('data:')) {
    return null;
  }

  // Remove any query parameters or fragments
  try {
    const url = new URL(trimmed, 'http://dummy');
    const path = url.pathname + (url.search ? url.search : '');

    // Must be internal path
    if (!isInternalPath(path)) {
      return null;
    }

    // Must not contain dangerous patterns
    if (path.includes('..') || path.includes('//')) {
      return null;
    }

    return path;
  } catch {
    // If URL parsing fails, try simple path validation
    if (isInternalPath(trimmed)) {
      return trimmed;
    }
    return null;
  }
}

// ============================================================================
// SESSION VALIDATION
// ============================================================================

let _middlewareSupabase: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (_middlewareSupabase) return _middlewareSupabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[middleware] Supabase configuration missing');
    return null;
  }

  _middlewareSupabase = createClient(supabaseUrl, supabaseAnonKey);
  return _middlewareSupabase;
}

/**
 * Validate Supabase session from request cookies or headers.
 * Supports:
 * 1. `sb-access-token` cookie
 * 2. `Authorization: Bearer <token>` header
 * 3. Standard Supabase SSR cookie (`sb-*-auth-token`)
 * 4. Automatic token refresh if access token expired but `sb-refresh-token` is present
 */
async function getSessionFromRequest(request: NextRequest): Promise<{
  user: User;
  token: string;
  refreshedSession?: Session;
} | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  try {
    // 1. Explicit Bearer token MUST have precedence (Blueprint line 61).
    // If a Bearer token is provided, verify it. If invalid, FAIL IMMEDIATELY.
    // Invariant: "ak je neplatný, požiadavka nesmie potichu prejsť cez inú identitu"
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const bearerToken = authHeader.slice(7).trim();
      if (!bearerToken) return null;

      const cleanToken = decodeURIComponent(bearerToken);
      const { data, error } = await supabase.auth.getUser(cleanToken);

      if (!error && data?.user) {
        return { user: data.user, token: cleanToken };
      }

      console.debug('[middleware] Invalid explicit Bearer token:', error?.message);
      return null; // Do NOT fall back to cookies!
    }

    // 2. Check sb-access-token cookie
    let accessToken = request.cookies.get('sb-access-token')?.value;
    const refreshToken = request.cookies.get('sb-refresh-token')?.value;

    // 3. Check standard Supabase auth cookie (e.g. sb-<project-ref>-auth-token)
    if (!accessToken) {
      for (const cookie of request.cookies.getAll()) {
        if (cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')) {
          try {
            const raw = decodeURIComponent(cookie.value);
            const parsed = raw.startsWith('base64-')
              ? JSON.parse(Buffer.from(raw.slice(7), 'base64').toString('utf-8'))
              : JSON.parse(raw);
            if (parsed?.access_token) {
              accessToken = parsed.access_token;
              break;
            }
          } catch {
            // ignore malformed cookie
          }
        }
      }
    }

    if (accessToken) {
      const cleanToken = decodeURIComponent(accessToken);
      const { data, error } = await supabase.auth.getUser(cleanToken);

      if (!error && data?.user) {
        return { user: data.user, token: cleanToken };
      }
      console.debug('[middleware] Invalid session:', error?.message);
    }

    // 4. Token refresh fallback: if access token is expired or missing, try refresh token
    if (refreshToken) {
      const cleanRefreshToken = decodeURIComponent(refreshToken);
      const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession({
        refresh_token: cleanRefreshToken,
      });

      if (!refreshError && refreshData?.session && refreshData?.user) {
        return {
          user: refreshData.user,
          token: refreshData.session.access_token,
          refreshedSession: refreshData.session,
        };
      }
      console.debug('[middleware] Refresh session failed:', refreshError?.message);
    }

    return null;
  } catch (err) {
    console.error('[middleware] Session validation error:', err);
    return null;
  }
}

/**
 * Check if request is from a development environment.
 * In development, we allow more permissive behavior for local testing.
 */
function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Check if dev auth bypass is allowed.
 * Only in development, without real evidence access, on loopback.
 */
function devAuthBypassAllowed(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (process.env.ALLOW_DEV_AUTH_BYPASS !== 'true') return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;

  // Check for real evidence access keys
  const hasRealAccess = Boolean(
    process.env.S3_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (hasRealAccess) return false;

  // Check if it's a loopback request
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  if (!new Set(['localhost', '127.0.0.1', '::1']).has(hostname)) return false;

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(':')[0];
  if (forwardedHost && !new Set(['localhost', '127.0.0.1', '::1']).has(forwardedHost)) {
    return false;
  }
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const loopbackIps = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
    if (!forwardedFor.split(',').map((hop) => hop.trim()).every((hop) => loopbackIps.has(hop))) {
      return false;
    }
  }
  return true;
}

// ============================================================================
// MIDDLEWARE IMPLEMENTATION
// ============================================================================

/**
 * Main authentication middleware.
 *
 * This middleware:
 * 1. Classifies the route being accessed
 * 2. For PUBLIC routes: allows through
 * 3. For SYSTEM routes: allows through (they have their own auth)
 * 4. For protected routes (AUTHENTICATED, PROJECT_REQUIRED, ROLE_REQUIRED):
 *    - Validates Supabase session
 *    - If invalid API route: returns 401 JSON
 *    - If invalid page route: redirects to login with safe redirect target
 *    - If valid: allows through
 */

export async function middleware(
  request: NextRequest,
  _event?: any
): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname;

  // 1. Root route: directed navigation according to blueprint invariant
  // - Neprihlásený vstup na / smeruje na /auth/login/?next=%2Fbrowser%2F
  // - Prihlásený vstup na / smeruje na /browser/
  if (pathname === '/') {
    const session = await getSessionFromRequest(request);
    if (session) {
      return NextResponse.redirect(new URL('/browser/', request.nextUrl));
    }
    return NextResponse.redirect(new URL('/auth/login/?next=%2Fbrowser%2F', request.nextUrl));
  }

  // Get route category
  const { category } = getRouteCategory(pathname);

  // PUBLIC routes: allow through without authentication
  if (category === 'PUBLIC') {
    return NextResponse.next();
  }

  // SYSTEM routes: allow through (they have their own auth mechanisms)
  if (category === 'SYSTEM') {
    return NextResponse.next();
  }

  // PROTECTED ROUTES: Require authentication
  // Check for valid session
  const session = await getSessionFromRequest(request);

  if (!session) {
    // Determine if this is an API route or page route
    const isApiRoute = pathname.startsWith('/api/');

    if (isApiRoute) {
      // API routes: return 401 JSON, never redirect to HTML login
      // This prevents open redirect vulnerabilities and provides clean API errors
      return NextResponse.json(
        { error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    // Page routes: redirect to login with safe redirect target
    // Check if there's a redirect target in the URL
    const nextParam = request.nextUrl.searchParams.get('next');
    const searchParams = new URLSearchParams();

    // Only preserve internal redirect targets
    if (nextParam) {
      const validatedNext = validateRedirectTarget(nextParam);
      if (validatedNext) {
        searchParams.set('next', validatedNext);
      }
    } else {
      // If no next param, redirect back to the requested path
      const validatedNext = validateRedirectTarget(pathname + request.nextUrl.search);
      if (validatedNext) {
        searchParams.set('next', validatedNext);
      }
    }

    // If we have a valid redirect target, use it
    const redirectUrl = searchParams.size > 0
      ? `${SIGN_IN_ROUTE}?${searchParams.toString()}`
      : SIGN_IN_ROUTE;

    // Special case: if we're already on the login page or an auth page, don't redirect
    if (pathname === '/auth' || pathname.startsWith('/auth/')) {
      return NextResponse.next();
    }

    const response = NextResponse.redirect(new URL(redirectUrl, request.nextUrl));

    // Clear any potentially stale auth cookies
    // Note: We don't clear the actual Supabase cookies as they're httpOnly
    // and the redirect to login will handle the auth flow
    return response;
  }

  // If session was refreshed during validation, persist new tokens in response cookies
  const refreshedSession = session.refreshedSession;
  if (refreshedSession) {
    const response = NextResponse.next();
    const isProd = process.env.NODE_ENV === 'production';
    response.cookies.set('sb-access-token', refreshedSession.access_token, {
      path: '/',
      maxAge: refreshedSession.expires_in || 3600,
      sameSite: 'lax',
      secure: isProd,
    });
    if (refreshedSession.refresh_token) {
      response.cookies.set('sb-refresh-token', refreshedSession.refresh_token, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
        secure: isProd,
      });
    }
    return response;
  }

  // Authenticated user - check if route requires project/case access
  if (category === 'PROJECT_REQUIRED') {
    // For now, we allow authenticated users through
    // Case ownership verification should happen at the page/API level
    // where the specific case ID is known
    // This is consistent with the current vault-auth pattern
    return NextResponse.next();
  }

  // ROLE_REQUIRED: Placeholder for future role checking
  if (category === 'ROLE_REQUIRED') {
    // For now, treat same as AUTHENTICATED
    // Future: check user role from session
    return NextResponse.next();
  }

  // AUTHENTICATED routes with valid session
  return NextResponse.next();
}

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

/**
 * Configure middleware to run on specific paths.
 * By default, runs on all routes.
 */
export const config = {
  // Match all paths EXCEPT static assets
  // API routes (/api/*) are now processed for baseline auth protection
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml).*)',
  ],
};

// ============================================================================
// EXPORTS FOR TESTING
// ============================================================================

// Export helper functions for testing
export {
  getRouteCategory,
  matchPathPattern,
  isInternalPath,
  validateRedirectTarget,
  isDevelopment,
  devAuthBypassAllowed,
};

