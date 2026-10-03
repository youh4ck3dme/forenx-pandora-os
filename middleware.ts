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
  type RouteCategory,
} from '@/lib/auth/route-policy';
import {
  isInternalPath,
  validateRedirectTarget,
} from '@/lib/auth/redirect';

// ============================================================================
// ROUTE CLASSIFICATION
// ============================================================================

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
    // Machine-to-machine: cron drains the ForenZX dispatch outbox
    { pattern: '/api/forenzx/dispatch-outbox', category: 'SYSTEM' },
    { pattern: '/api/forenzx/dispatch-outbox/*', category: 'SYSTEM' },
    // Standard system routes
    { pattern: '/.well-known/*', category: 'SYSTEM' },

    // ======================================================================
    // AUTHENTICATED ROUTES - Requires valid session
    // ======================================================================
    // Forza routes - main forensic application
    { pattern: '/forza', category: 'AUTHENTICATED' },
    { pattern: '/forza/*', category: 'AUTHENTICATED' },
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

const SIGN_IN_ROUTE = '/auth/login/';

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
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-correlation-id', correlationId);

  const respond = (res: NextResponse): NextResponse => {
    res.headers.set('x-correlation-id', correlationId);
    return res;
  };

  const next = (): NextResponse => {
    return respond(NextResponse.next({ request: { headers: requestHeaders } }));
  };

  const pathname = request.nextUrl.pathname;

  // 1. Root route: directed navigation according to blueprint invariant
  // - Neprihlásený vstup na / smeruje na /auth/login/?next=%2Fbrowser%2F
  // - Prihlásený vstup na / smeruje na /browser/
  if (pathname === '/') {
    const session = await getSessionFromRequest(request);
    if (session) {
      return respond(NextResponse.redirect(new URL('/browser/', request.nextUrl)));
    }
    return respond(NextResponse.redirect(new URL('/auth/login/?next=%2Fbrowser%2F', request.nextUrl)));
  }

  // Get route category
  const { category } = getRouteCategory(pathname);

  // PUBLIC routes: allow through without authentication
  if (category === 'PUBLIC') {
    return next();
  }

  // SYSTEM routes: allow through (they have their own auth mechanisms)
  if (category === 'SYSTEM') {
    return next();
  }

  // PROTECTED ROUTES: Require authentication
  // Check for valid session
  const session = await getSessionFromRequest(request);

  if (!session) {
    if (devAuthBypassAllowed(request)) {
      return next();
    }

    // Determine if this is an API route or page route
    const isApiRoute = pathname.startsWith('/api/');

    if (isApiRoute) {
      // API routes: return 401 JSON, never redirect to HTML login
      // This prevents open redirect vulnerabilities and provides clean API errors
      return respond(
        NextResponse.json(
          { error: 'Unauthorized: Authentication required' },
          { status: 401 }
        )
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
      return next();
    }

    const response = NextResponse.redirect(new URL(redirectUrl, request.nextUrl));

    // Clear any potentially stale auth cookies
    // Note: We don't clear the actual Supabase cookies as they're httpOnly
    // and the redirect to login will handle the auth flow
    return respond(response);
  }

  // If session was refreshed during validation, persist new tokens in response cookies
  const refreshedSession = session.refreshedSession;
  if (refreshedSession) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    const isProd = process.env.NODE_ENV === 'production' || request.url.startsWith('https:');
    response.cookies.set('sb-access-token', refreshedSession.access_token, {
      path: '/',
      maxAge: refreshedSession.expires_in || 3600,
      sameSite: 'lax',
      secure: isProd,
      httpOnly: true,
    });
    if (refreshedSession.refresh_token) {
      response.cookies.set('sb-refresh-token', refreshedSession.refresh_token, {
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
        sameSite: 'lax',
        secure: isProd,
        httpOnly: true,
      });
    }
    return respond(response);
  }

  // AUTHENTICATED routes with valid session
  return next();
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
  devAuthBypassAllowed,
  type RouteCategory,
};

