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

export * from './cookies';
export * from './redirect';
export {
    PUBLIC_ROUTES,
    isPublicRoutePattern,
    matchRoutePattern
} from './route-policy';
export type { PublicRoute } from './route-policy';

export type { RouteCategory } from './route-policy';

/**
 * Re-export route classification from route-policy for use in other contexts
 */
import type { RouteCategory } from './route-policy';

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
import {
    PUBLIC_ROUTES,
    matchRoutePattern,
} from './route-policy';

/**
 * Check if a path is in the public routes list
 */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => matchRoutePattern(path, route));
}

/**
 * Get the appropriate auth level for a route
 */
export function getRouteAuthLevel(path: string): RouteCategory {
  if (isPublicRoute(path)) return 'PUBLIC';
  return 'AUTHENTICATED';
}
