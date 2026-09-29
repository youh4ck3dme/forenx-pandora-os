/**
 * PANDORA / ForenX - Open Redirect Protection
 * 
 * Utilities for safe redirect handling to prevent open redirect vulnerabilities.
 * 
 * Security Principle: Only allow redirects to known internal application paths.
 * Never trust user-provided redirect targets without validation.
 */

/**
 * Application internal path prefixes.
 * These define which paths are considered "internal" and safe for redirects.
 */
const INTERNAL_PATHS = [
  '/',
  '/forza',
  '/browser',
  '/forge',
  '/offline',
  '/auth',
] as const;

/**
 * Check if a path string represents an internal application path.
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
  
  // Reject absolute URLs
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('//')) {
    return false;
  }
  
  // Parse the path to extract just the pathname (ignore query and hash)
  try {
    // Try to parse as URL to extract pathname
    const url = new URL(path, 'http://dummy.example');
    path = url.pathname;
  } catch {
    // If URL parsing fails, use the path as-is
    // This handles paths that might have query strings
  }
  
  // Remove query string and hash if present
  const cleanPath = path.split('?')[0].split('#')[0];
  
  // Check against internal path prefixes
  for (const internalPath of INTERNAL_PATHS) {
    if (cleanPath === internalPath || cleanPath.startsWith(`${internalPath}/`)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Validate and sanitize a redirect target URL.
 * 
 * @param next - The redirect target to validate
 * @returns The sanitized path if valid, or null if invalid
 * 
 * @example
 * validateRedirect('/forza/pripady') // '/forza/pripady'
 * validateRedirect('/forza/pripady?tab=1') // '/forza/pripady?tab=1'
 * validateRedirect('https://evil.com') // null
 * validateRedirect('javascript:alert(1)') // null
 * validateRedirect('/auth?next=https://evil.com') // '/auth'
 */
export function validateRedirectTarget(next: string | null | undefined): string | null {
  if (!next) return null;
  
  // Reject absolute URLs
  if (next.startsWith('http://') || next.startsWith('https://') || next.startsWith('//')) {
    return null;
  }
  
  // Reject javascript: and data: URLs
  if (next.toLowerCase().startsWith('javascript:') || next.toLowerCase().startsWith('data:')) {
    return null;
  }
  
  // Parse the path
  try {
    const url = new URL(next, 'http://dummy.example');
    const pathname = url.pathname;
    const search = url.search;
    const hash = url.hash;
    
    // Validate the pathname is internal
    if (!isInternalPath(pathname)) {
      return null;
    }
    
    // Check for path traversal attempts
    if (pathname.includes('..') || pathname.includes('//')) {
      return null;
    }
    
    // Reconstruct the path (pathname + search + hash)
    return `${pathname}${search}${hash}`;
  } catch {
    // If URL parsing fails, check if it's a simple path
    const cleanNext = next.split('?')[0].split('#')[0];
    
    if (isInternalPath(cleanNext)) {
      // It's an internal path, allow it as-is
      return next;
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
