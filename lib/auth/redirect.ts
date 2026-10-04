/**
 * PANDORA / ForenX - Open Redirect Protection
 * 
 * Utilities for safe redirect handling to prevent open redirect vulnerabilities.
 * 
 * Security Principle: Only allow redirects to known internal application paths.
 * Never trust user-provided redirect targets without validation.
 */

/**
 * Canonical list of internal application path prefixes.
 * Used for open-redirect protection in both middleware and client-side redirects.
 * Keep in sync with the route table in middleware.ts.
 */
export const INTERNAL_PATH_PREFIXES = [
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
  '/dashboard',
  '/healthz',
  '/api',
] as const;

/**
 * Check if a path string represents an internal application path.
 * Used to prevent open redirect vulnerabilities.
 * 
 * @param path - The path to validate
 * @returns true if the path is internal, false otherwise
 * 
 * @example
 * isInternalPath('/forza/pripady') // true
 * isInternalPath('/forza/pripady?tab=1') // true
 * isInternalPath('/') // true
 * isInternalPath('https://evil.com') // false
 * isInternalPath('//evil.com') // false
 * isInternalPath('/auth?next=https://evil.com') // true (path is internal, query ignored)
 */
export function isInternalPath(path: string | null | undefined): boolean {
  if (!path) return false;
  
  // Must be a relative path (not absolute URL or protocol-relative)
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//')) {
    return false;
  }
  
  // Remove query string and hash for prefix matching
  const cleanPath = path.split('?')[0].split('#')[0];

  // Case-insensitive prefix check (paths like /FORZA/pripady are valid)
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
 * Validate and sanitize a redirect target URL.
 * Returns the sanitized path or null if invalid.
 * 
 * Security: Rejects absolute URLs, javascript:, data: URIs, and path traversal.
 * 
 * @param next - The redirect target to validate
 * @returns The sanitized path if valid, or null if invalid
 * 
 * @example
 * validateRedirectTarget('/forza/pripady') // '/forza/pripady'
 * validateRedirectTarget('/forza/pripady?tab=1') // '/forza/pripady?tab=1'
 * validateRedirectTarget('https://evil.com') // null
 * validateRedirectTarget('javascript:alert(1)') // null
 */
export function validateRedirectTarget(next: string | null | undefined): string | null {
  if (!next) return null;
  
  const trimmed = next.trim();
  if (!trimmed) return null;

  // Reject dangerous characters like backslashes, encoded slashes, and null bytes
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

  // Check for path traversal or double slashes
  if (trimmed.includes('..') || trimmed.includes('//')) {
    return null;
  }

  // Parse path and preserve query parameters and fragments if the pathname is an internal path
  try {
    const url = new URL(trimmed, 'http://dummy.example');
    const path = url.pathname + (url.search ? url.search : '') + (url.hash ? url.hash : '');

    // Must be internal path
    if (!isInternalPath(url.pathname)) {
      return null;
    }

    return path;
  } catch {
    // If URL parsing fails, check if it's a simple path
    const cleanNext = trimmed.split('?')[0].split('#')[0];
    if (isInternalPath(cleanNext)) {
      return trimmed;
    }
    return null;
  }
}

/**
 * Safe redirect URL construction.
 * 
 * @param next - The intended redirect target
 * @param fallback - Fallback path if next is invalid (optional, no default)
 * @returns A safe redirect path
 */
export function getSafeRedirectTarget(
  next: string | null | undefined,
  fallback?: string,
): string | null {
  const validated = validateRedirectTarget(next);
  if (validated) {
    return validated;
  }
  return fallback ?? null;
}

/**
 * Create a redirect URL to the login page with an optional safe next parameter.
 * 
 * @param next - The path to redirect back to after login
 * @param baseUrl - Base URL for the login page (defaults to '/auth')
 * @returns The login URL with safe redirect parameter
 */
export function getLoginRedirectUrl(
  next: string | null | undefined,
  baseUrl: string = '/auth',
): string {
  const safeNext = getSafeRedirectTarget(next);
  
  if (!safeNext || safeNext === '/') {
    return baseUrl;
  }
  
  // Manually construct the URL to avoid URL encoding of forward slashes
  // We still need to encode other special characters
  const encodedNext = safeNext
    .replace(/[^a-zA-Z0-9\-_~:\.\/]/g, (char) => encodeURIComponent(char));
  
  return `${baseUrl}?next=${encodedNext}`;
}

/**
 * Check if the current request is a redirect from a protected route.
 * 
 * @param request - The NextRequest object
 * @returns The original target path if redirected, or null
 */
export function getRedirectTargetFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const nextParam = url.searchParams.get('next');
  
  if (!nextParam) return null;
  
  return validateRedirectTarget(nextParam);
}
