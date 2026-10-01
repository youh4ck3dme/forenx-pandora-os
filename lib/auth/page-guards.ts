/**
 * PANDORA / ForenX - Page-Level Authentication Guards
 * 
 * Guards for protecting Next.js server components/pages.
 * 
 * These can be used in:
 * - Layout components
 * - Page components (Server Components)
 * - Loading components
 * 
 * Usage patterns:
 * 
 * 1. In layout.tsx:
 * ```typescript
 * import { requirePageAuth } from '@/lib/auth/page-guards';
 * 
 * export default async function ProtectedLayout({ children }) {
 *   await requirePageAuth();
 *   return <>{children}</>;
 * }
 * ```
 * 
 * 2. In page.tsx:
 * ```typescript
 * import { getPageSession, redirectToLogin } from '@/lib/auth/page-guards';
 * 
 * export default async function ProtectedPage() {
 *   const session = await getPageSession();
 *   if (!session) {
 *     redirectToLogin();
 *   }
 *   // ...
 * }
 * ```
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Page session information
 */
export interface PageSession {
  user: User;
  token: string;
  claims: Record<string, unknown>;
}

// ============================================================================
// COOKIE/HEADER ACCESS
// ============================================================================

/**
 * Get Supabase client for page-level auth
 */
function getPageAuthClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration missing');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

/**
 * Extract token from cookies in server components
 */
export async function getTokenFromCookies(): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    let accessToken = cookieStore.get('sb-access-token')?.value;
    
    if (accessToken) {
      accessToken = decodeURIComponent(accessToken);
      if (accessToken.split('.').length === 3) {
        return accessToken;
      }
    }

    // Fallback to standard Supabase auth cookie
    for (const cookie of cookieStore.getAll()) {
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
          // ignore
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header in server components
 */
export async function getTokenFromHeaders(): Promise<string | null> {
  try {
    const headersList = await headers();
    const authHeader = headersList.get('authorization');
    
    if (!authHeader) return null;
    
    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }
    
    const token = authHeader.slice(7).trim();
    
    if (token.split('.').length !== 3) {
      return null;
    }
    
    return token;
  } catch {
    return null;
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Get the current session in a server component.
 * 
 * @returns Promise resolving to PageSession or null
 */
export async function getPageSession(): Promise<PageSession | null> {
  // Try cookies first (Supabase default)
  let token = await getTokenFromCookies();

  // Fall back to headers
  if (!token) {
    token = await getTokenFromHeaders();
  }
  
  if (!token) {
    return null;
  }
  
  try {
    const supabase = getPageAuthClient();
    
    // Validate token and get user
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !userData.user) {
      console.debug('[page-guards] Token validation failed:', userError?.message);
      return null;
    }
    
    // Get claims
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    
    if (claimsError || !claimsData?.claims) {
      console.debug('[page-guards] Claims retrieval failed:', claimsError?.message);
      return null;
    }

    return {
      user: userData.user,
      token,
      claims: claimsData!.claims,
    };
  } catch (err) {
    console.error('[page-guards] Session retrieval error:', err);
    return null;
  }
}

// ============================================================================
// GUARDS
// ============================================================================

/**
 * Require authentication for a page.
 * Throws redirect if not authenticated.
 * 
 * @param fallbackUrl - URL to redirect to (default: /auth/login)
 */
export async function requirePageAuth(fallbackUrl: string = '/auth/login'): Promise<PageSession> {
  const session = await getPageSession();
  
  if (!session) {
    redirect(fallbackUrl);
  }
  
  return session;
}

/**
 * Require authentication with redirect back to original page.
 * 
 * @param requestUrl - The original request URL (can be obtained from usePathname in client, but for server components we need it passed)
 */
export async function requirePageAuthWithRedirect(requestPath?: string): Promise<PageSession> {
  const session = await getPageSession();
  
  if (!session) {
    const loginUrl = requestPath ? `/auth/login?next=${encodeURIComponent(requestPath)}` : '/auth/login';
    redirect(loginUrl);
  }
  
  return session;
}

/**
 * Check if user is authenticated without throwing.
 * 
 * @returns Promise resolving to PageSession or null
 */
export async function checkPageAuth(): Promise<PageSession | null> {
  return getPageSession();
}

// ============================================================================
// REDIRECT HELPERS
// ============================================================================

/**
 * Redirect to login page
 */
export function redirectToLogin(next?: string): never {
  const url = next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login';
  redirect(url);
}

/**
 * Redirect to home
 */
export function redirectToHome(): never {
  redirect('/');
}

/**
 * Redirect to a specific path
 */
export function redirectTo(path: string): never {
  redirect(path);
}

// ============================================================================
// DEVELOPMENT BYPASS
// ============================================================================

/**
 * Check if dev bypass is allowed for page-level auth
 */
export function isPageDevBypassAllowed(): boolean {
  // Never in production
  if (process.env.NODE_ENV === 'production') return false;
  
  // Require explicit bypass flag
  if (process.env.PANDORA_DEV_AUTH_BYPASS !== '1') return false;
  
  // Not in Vercel
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  
  // Check for real data access
  const hasRealAccess = Boolean(
    process.env.S3_ACCESS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  
  if (hasRealAccess) return false;
  
  return true;
}

/**
 * Mock user for dev bypass
 */
export function getPageDevMockUser(): PageSession {
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
  
  return {
    user: mockUser,
    token: '',
    claims: {
      sub: mockUser.id,
      email: mockUser.email,
      role: 'authenticated',
    },
  };
}

/**
 * Require auth with dev bypass support for pages
 */
export async function requirePageAuthWithDevBypass(): Promise<PageSession> {
  const session = await getPageSession();
  
  if (session) {
    return session;
  }
  
  if (isPageDevBypassAllowed()) {
    return getPageDevMockUser();
  }
  
  redirectToLogin();
}
