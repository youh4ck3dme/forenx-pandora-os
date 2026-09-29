/**
 * PANDORA / ForenX - Authentication Library
 * 
 * Centralized authentication utilities for the application.
 * 
 * This library provides:
 * - Session validation helpers
 * - Route classification
 * - Authorization guards
 * - Open redirect protection
 * 
 * Security Principles:
 * 1. Never trust client-side state for authorization
 * 2. Always validate authentication server-side
 * 3. Use centralized guards to avoid duplication
 * 4. Fail closed - deny access on any uncertainty
 */

export * from './redirect';

export type { RouteCategory } from '@/middleware';

/**
 * Re-export route classification from middleware for use in other contexts
 */
import type { RouteCategory } from '@/middleware';

/**
 * User session information extracted from Supabase JWT
 */
export interface AuthSession {
  userId: string;
  email?: string;
  role?: string;
  claims: Record<string, unknown>;
}

/**
 * Result of authentication check
 */
export interface AuthResult {
  authenticated: boolean;
  session: AuthSession | null;
  error?: string;
}

/**
 * Standard response for unauthorized access
 */
export const UNAUTHORIZED_RESPONSE = {
  error: 'Unauthorized: Authentication required',
  status: 401,
} as const;

export const FORBIDDEN_RESPONSE = {
  error: 'Forbidden: Insufficient permissions',
  status: 403,
} as const;

/**
 * Public routes that don't require authentication.
 * These are explicitly allowed without a session.
 */
export const PUBLIC_ROUTES = [
  '/',
  '/auth',
  '/auth/login',
  '/auth/register',
  '/blog',
  '/blog/[...slug]',
  '/healthz',
  '/api/healthz',
  '/api/health/observe',
] as const;

/**
 * Check if a path is in the public routes list
 */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some(route => {
    if (route === path) return true;
    if (route.endsWith('/*')) {
      const prefix = route.slice(0, -2);
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    if (route.includes('[...')) {
      // Convert route pattern to regex
      const pattern = route.replace(/\/\[\.\.\.\]/g, '/.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(path);
    }
    return false;
  });
}

/**
 * Routes that require project/case access
 */
export const PROJECT_REQUIRED_ROUTES = [
  '/forza',
  '/forza/*',
  '/api/vault',
  '/api/vault/*',
  '/api/audit/access',
] as const;

/**
 * Check if a path requires project/case access
 */
export function isProjectRequiredRoute(path: string): boolean {
  return PROJECT_REQUIRED_ROUTES.some(route => {
    if (route === path) return true;
    if (route.endsWith('/*')) {
      const prefix = route.slice(0, -2);
      return path === prefix || path.startsWith(`${prefix}/`);
    }
    if (route.includes('[...')) {
      const pattern = route.replace(/\/\[\.\.\.\]/g, '/.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(path);
    }
    return false;
  });
}

/**
 * Routes that require specific roles
 */
export const ROLE_REQUIRED_ROUTES: Record<string, string[]> = {
  // Format: path -> [required roles]
  // Currently none defined, but structure is in place for future use
};

/**
 * Get the appropriate auth level for a route
 */
export function getRouteAuthLevel(path: string): RouteCategory {
  if (isPublicRoute(path)) return 'PUBLIC';
  if (isProjectRequiredRoute(path)) return 'PROJECT_REQUIRED';
  if (ROLE_REQUIRED_ROUTES[path]) return 'ROLE_REQUIRED';
  return 'AUTHENTICATED';
}
