/**
 * PANDORA / ForenX - Server-Side Authentication Helpers
 * 
 * Centralized authentication utilities for server components and API routes.
 * 
 * These helpers ensure consistent authentication checking across all
 * server-side code paths.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Authenticated user context
 */
export interface AuthContext {
  user: User;
  token: string;
  claims: Record<string, unknown>;
}

/**
 * Result of authentication check
 */
export interface AuthCheckResult {
  /** Whether the request is authenticated */
  authenticated: boolean;
  /** The auth context if authenticated */
  context: AuthContext | null;
  /** Error message if authentication failed */
  error?: string;
  /** HTTP status code for error */
  status?: number;
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

/**
 * Get Supabase client for authentication checks.
 * Uses publishable/anon key - respects RLS policies.
 */
function getAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration missing');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

// ============================================================================
// TOKEN VALIDATION
// ============================================================================

/**
 * Extract Bearer token from Authorization header
 */
export function extractBearerToken(request: NextRequest | Request): string | null {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader) return null;
  
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.slice(7).trim();
  
  // Basic JWT validation - must have 3 parts separated by dots
  if (token.split('.').length !== 3) {
    return null;
  }
  
  return token;
}

/**
 * Extract token from cookies (for SSR/Next.js pages)
 */
export function extractTokenFromCookies(request: NextRequest): string | null {
  // Supabase stores session in cookies
  let accessToken = request.cookies.get('sb-access-token')?.value;
  
  if (accessToken) {
    accessToken = decodeURIComponent(accessToken);
    if (accessToken.split('.').length === 3) {
      return accessToken;
    }
  }

  // Fallback to standard Supabase auth cookie (e.g. sb-<project-ref>-auth-token)
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith('sb-') && cookie.name.endsWith('-auth-token')) {
      try {
        const raw = decodeURIComponent(cookie.value);
        const parsed = raw.startsWith('base64-')
          ? JSON.parse(Buffer.from(raw.slice(7), 'base64').toString('utf-8'))
          : JSON.parse(raw);
        if (parsed?.access_token && parsed.access_token.split('.').length === 3) {
          return parsed.access_token;
        }
      } catch {
        // ignore malformed cookie
      }
    }
  }
  
  return null;
}

// ============================================================================
// AUTHENTICATION CHECKS
// ============================================================================

/**
 * Validate a Supabase JWT token and return the user information.
 * 
 * @param token - The JWT token to validate
 * @returns Promise resolving to user info or null if invalid
 */
async function validateSupabaseToken(token: string): Promise<{ user: User; claims: Record<string, unknown> } | null> {
  try {
    const supabase = getAuthClient();
    
    // Get user from token
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !userData.user) {
      console.debug('[auth] Token validation failed:', userError?.message);
      return null;
    }
    
    // Get claims from token
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.debug('[auth] Claims retrieval failed:', claimsError?.message);
      return null;
    }

    return {
      user: userData.user,
      claims: claimsData!.claims,
    };
  } catch (err) {
    console.error('[auth] Token validation error:', err);
    return null;
  }
}

/**
 * Authenticate a request using Bearer token.
 * 
 * @param request - The NextRequest object
 * @returns Promise resolving to AuthCheckResult
 */
export async function authenticateRequest(request: NextRequest): Promise<AuthCheckResult> {
  // Try to extract token from Authorization header first
  let token = extractBearerToken(request);
  
  // Fall back to cookies (for pages that use cookie-based sessions)
  if (!token) {
    token = extractTokenFromCookies(request);
  }
  
  if (!token) {
    return {
      authenticated: false,
      context: null,
      error: 'No authorization token provided',
      status: 401,
    };
  }
  
  const validated = await validateSupabaseToken(token);
  
  if (!validated) {
    return {
      authenticated: false,
      context: null,
      error: 'Invalid or expired token',
      status: 401,
    };
  }
  
  return {
    authenticated: true,
    context: {
      user: validated.user,
      token,
      claims: validated.claims,
    },
  };
}

/**
 * Require authentication for a request.
 * Returns the auth context if authenticated, or throws an error.
 * 
 * @param request - The NextRequest object
 * @returns Promise resolving to AuthContext
 * @throws Error if not authenticated
 */
export async function requireAuthentication(request: NextRequest): Promise<AuthContext> {
  const result = await authenticateRequest(request);
  
  if (!result.authenticated || !result.context) {
    throw new Error(result.error || 'Unauthorized');
  }
  
  return result.context;
}

/**
 * Create an unauthorized response.
 * 
 * @param message - Error message
 * @param status - HTTP status code (default: 401)
 * @returns NextResponse with error
 */
export function createUnauthorizedResponse(
  message: string = 'Unauthorized: Authentication required',
  status: number = 401,
): NextResponse {
  return NextResponse.json(
    { error: message, status },
    { status },
  );
}

/**
 * Create a forbidden response.
 * 
 * @param message - Error message
 * @returns NextResponse with error
 */
export function createForbiddenResponse(
  message: string = 'Forbidden: Insufficient permissions',
): NextResponse {
  return NextResponse.json(
    { error: message, status: 403 },
    { status: 403 },
  );
}

// ============================================================================
// MIDDLEWARE-STYLE HANDLERS
// ============================================================================

/**
 * Middleware-style authentication checker.
 * Use this in route handlers to protect API routes.
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const auth = await withAuth(request);
 *   if (!auth) {
 *     return createUnauthorizedResponse();
 *   }
 *   // Use auth.context.user, auth.context.token, etc.
 * }
 * ```
 */
export async function withAuth(
  request: NextRequest,
): Promise<AuthCheckResult> {
  return authenticateRequest(request);
}

/**
 * Middleware-style handler that requires authentication.
 * Returns the auth context or redirects to login.
 * 
 * @example
 * ```typescript
 * export async function GET(request: NextRequest) {
 *   const auth = await requireAuth(request);
 *   // auth is guaranteed to be valid
 *   return NextResponse.json({ user: auth.user });
 * }
 * ```
 */
export async function requireAuth(
  request: NextRequest,
): Promise<AuthContext> {
  const result = await authenticateRequest(request);
  
  if (!result.authenticated || !result.context) {
    const loginUrl = new URL('/auth/login', request.nextUrl);
    // Preserve the original path as the redirect target
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search);
    
    throw new NextResponse(null, {
      status: 307, // Temporary Redirect
      headers: {
        Location: loginUrl.toString(),
      },
    });
  }
  
  return result.context;
}

// ============================================================================
// DEVELOPMENT BYPASS
// ============================================================================

/**
 * Check if development authentication bypass is allowed.
 * 
 * This is used in development environments where Supabase may not be
 * configured or to allow local testing without real authentication.
 * 
 * WARNING: This should NEVER be allowed in production with real data access.
 */
export function isDevAuthBypassAllowed(request?: NextRequest): boolean {
  // Never in production
  if (process.env.NODE_ENV === 'production') return false;
  
  // Require explicit bypass flag
  if (process.env.PANDORA_DEV_AUTH_BYPASS !== '1') return false;
  
  // Not in Vercel environments
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  
  // Check for real data access keys - if present, never bypass
  const hasRealAccess = Boolean(
    process.env.S3_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  
  if (hasRealAccess) return false;
  
  // If a request is provided, check it's loopback
  if (request) {
    const hostname = request.headers.get('host') || '';
    const loopbackHosts = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
    if (!loopbackHosts.some(host => hostname.includes(host))) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get a development mock user.
 * Used when dev bypass is allowed.
 */
export function getDevMockUser(): { user: User; claims: Record<string, unknown> } {
  const mockUser: User = {
    id: 'dev-user-001',
    aud: 'authenticated',
    created_at: new Date().toISOString(),
    email: 'dev@forendo.local',
    email_confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'dev' },
    user_metadata: { name: 'Dev User' },
    is_anonymous: false,
  };
  
  const mockClaims: Record<string, unknown> = {
    sub: mockUser.id,
    email: mockUser.email,
    role: 'authenticated',
  };
  
  return { user: mockUser, claims: mockClaims };
}

/**
 * Authenticate with development bypass support.
 * 
 * @param request - The NextRequest object
 * @returns Promise resolving to AuthCheckResult
 */
export async function authenticateWithDevBypass(
  request: NextRequest,
): Promise<AuthCheckResult> {
  // Try normal authentication first
  const result = await authenticateRequest(request);
  
  if (result.authenticated) {
    return result;
  }
  
  // Check if dev bypass is allowed
  if (isDevAuthBypassAllowed(request)) {
    const mock = getDevMockUser();
    
    return {
      authenticated: true,
      context: {
        user: mock.user,
        token: '', // No real token in dev bypass
        claims: mock.claims,
      },
    };
  }
  
  return result;
}
