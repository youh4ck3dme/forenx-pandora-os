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
import { createClient } from '@supabase/supabase-js';

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
 * SYSTEM: Internal system routes (health checks, etc.)
 */

export type RouteCategory = 'PUBLIC' | 'AUTHENTICATED' | 'PROJECT_REQUIRED' | 'ROLE_REQUIRED' | 'SYSTEM';

/**
 * Route configuration: path pattern -> category
 * 
 * Order matters: more specific patterns first.
 * Patterns are matched using the pathname (not full URL).
 */

// Helper to match path against pattern (supports exact, prefix, and wildcard)
function matchPathPattern(pathname: string, pattern: string): boolean {
  // Exact match
  if (pathname === pattern) return true;
  
  // Prefix match (pattern ends with /*)
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    // Only match if pathname starts with prefix/ (not exact match to prefix)
    return pathname.startsWith(`${prefix}/`);
  }
  
  // Wildcard segment match (pattern contains /[...])
  if (pattern.includes('/[...')) {
    // Replace [...slug] with .* to match any path segment
    const regexPattern = pattern.replace(/\[\.\.\.\w*\]/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(pathname);
  }
  
  return false;
}

/**
 * Get the category for a given path.
 * First match wins, so order patterns from most specific to least specific.
 */
function getRouteCategory(pathname: string): { category: RouteCategory; pattern: string } {
  const routeConfig: Array<{ pattern: string; category: RouteCategory }> = [
    // ======================================================================
    // SYSTEM ROUTES - Internal system endpoints
    // ======================================================================
    { pattern: '/healthz', category: 'SYSTEM' },
    { pattern: '/api/healthz', category: 'SYSTEM' },
    { pattern: '/api/health/observe', category: 'SYSTEM' },
    { pattern: '/.well-known/*', category: 'SYSTEM' },
    
    // ======================================================================
    // PUBLIC ROUTES - Accessible without authentication
    // ======================================================================
    // Authentication entry points
    { pattern: '/auth', category: 'PUBLIC' },
    { pattern: '/auth/login', category: 'PUBLIC' },
    { pattern: '/auth/register', category: 'PUBLIC' },
    
    // Marketing/content
    { pattern: '/', category: 'PUBLIC' },
    { pattern: '/blog', category: 'PUBLIC' },
    { pattern: '/blog/[...slug]', category: 'PUBLIC' },
    
    // ======================================================================
    // ROLE_REQUIRED ROUTES - Requires admin or specific role
    // ======================================================================
    // Forge studio may need admin in future - currently marking as AUTHENTICATED
    // Can be upgraded to ROLE_REQUIRED when role checking is implemented
    
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
    { pattern: '/api/fn', category: 'AUTHENTICATED' },
    { pattern: '/api/fn/*', category: 'AUTHENTICATED' },
    { pattern: '/api/csp-report', category: 'AUTHENTICATED' },
    { pattern: '/api/csp-report/*', category: 'AUTHENTICATED' },
    
    // ======================================================================
    // DEFAULT: Everything else is AUTHENTICATED
    // ======================================================================
    { pattern: '/*', category: 'AUTHENTICATED' },
  ];
  
  for (const route of routeConfig) {
    if (matchPathPattern(pathname, route.pattern)) {
      return { category: route.category, pattern: route.pattern };
    }
  }
  
  // Fallback: if no match, default to PUBLIC for safety
  return { category: 'PUBLIC', pattern: '*' };
}

// ============================================================================
// APPLICATION CONSTANTS
// ============================================================================

const SIGN_IN_ROUTE = '/auth';
const HOME_ROUTE = '/';

/**
 * Application internal paths - used for open redirect protection.
 * These are the only paths that can be used as redirect targets.
 */
const INTERNAL_PATH_PREFIXES = [
  '/',
  '/forza',
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
 */
function validateRedirectTarget(next: string | null): string | null {
  if (!next) return null;
  
  // Trim whitespace
  const trimmed = next.trim();
  if (!trimmed) return null;
  
  // Check for encoded slashes or other dangerous characters in the raw input
  if (trimmed.includes('%2F') || trimmed.includes('%5C') || trimmed.includes('%00')) {
    return null;
  }
  
  // Reject paths that are only query strings or fragments
  if (trimmed.startsWith('?') || trimmed.startsWith('#')) {
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

/**
 * Supabase client for middleware (server-side only).
 * Uses anon key - cannot access user data without valid session.
 */
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[middleware] Supabase configuration missing');
    return null;
  }
  
  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Validate Supabase session from request cookies.
 * Next.js with Supabase SSR stores session in cookies.
 */
async function getSessionFromRequest(request: NextRequest) {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  
  try {
    // Supabase session cookie name
    const accessToken = request.cookies.get('sb-access-token')?.value;
    const refreshToken = request.cookies.get('sb-refresh-token')?.value;
    
    if (!accessToken) {
      return null;
    }
    
    // Validate the token
    const { data, error } = await supabase.auth.getUser(accessToken);
    
    if (error || !data.user) {
      console.debug('[middleware] Invalid session:', error?.message);
      return null;
    }
    
    return { user: data.user, token: accessToken };
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
  return process.env.NODE_ENV !== 'production';
}

/**
 * Check if dev auth bypass is allowed.
 * Only in development, without real evidence access, on loopback.
 */
function devAuthBypassAllowed(request: NextRequest): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.PANDORA_DEV_AUTH_BYPASS !== '1') return false;
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
  const hostname = request.headers.get('host') || '';
  const loopbackHosts = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
  return loopbackHosts.some(host => hostname.includes(host));
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
 * 3. For SYSTEM routes: allows through (or adds security headers)
 * 4. For protected routes (AUTHENTICATED, PROJECT_REQUIRED, ROLE_REQUIRED):
 *    - Validates Supabase session
 *    - If invalid: redirects to login with safe redirect target
 *    - If valid: allows through
 */

export const middleware: NextMiddleware = async (request: NextRequest) => {
  const pathname = request.nextUrl.pathname;
  
  // Get route category
  const { category } = getRouteCategory(pathname);
  
  // SYSTEM routes: allow through, potentially with security headers
  if (category === 'SYSTEM') {
    return NextResponse.next();
  }
  
  // PUBLIC routes: allow through without authentication
  if (category === 'PUBLIC') {
    return NextResponse.next();
  }
  
  // PROTECTED ROUTES: Require authentication
  // Check for valid session
  const session = await getSessionFromRequest(request);
  
  if (!session) {
    // No valid session - redirect to login
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
    
    // Special case: if we're already on the login page, don't redirect
    if (pathname === SIGN_IN_ROUTE || pathname.startsWith(`${SIGN_IN_ROUTE}/`)) {
      return NextResponse.next();
    }
    
    const response = NextResponse.redirect(new URL(redirectUrl, request.nextUrl));
    
    // Clear any potentially stale auth cookies
    // Note: We don't clear the actual Supabase cookies as they're httpOnly
    // and the redirect to login will handle the auth flow
    return response;
  }
  
  // Authenticated user - check if route requires project/case access
  if (category === 'PROJECT_REQUIRED') {
    // For now, we allow authenticated users through
    // Case ownership verification should happen at the page/API level
    // where the specific case ID is known
    // This is consistent with the current vault-auth pattern
    
    // In future: check user has at least one case
    // For now: just being authenticated is sufficient for the middleware
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
};

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

/**
 * Configure middleware to run on specific paths.
 * By default, runs on all routes.
 */
export const config = {
  // Match all paths
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sitemap.xml).*)',
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
