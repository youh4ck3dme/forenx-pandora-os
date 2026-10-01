/**
 * PANDORA / ForenX - Client Auth Cookie Synchronization
 *
 * Bridges Supabase client session (stored in localStorage) to HTTP cookies
 * expected by Next.js middleware and server-side route guards:
 * - `sb-access-token`
 * - `sb-refresh-token`
 */

import type { Session } from "@supabase/supabase-js";

export interface SessionCookiePayload {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  expires_at?: number | null;
}

/**
 * Write session tokens to document.cookie so that subsequent HTTP / RSC
 * requests include the required auth cookies for middleware verification.
 */
export function setAuthCookies(session: SessionCookiePayload | Session | null | undefined): void {
  if (typeof document === "undefined" || !session?.access_token) return;

  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";

  // Calculate max-age for access token (default 1 hour = 3600 seconds)
  let maxAge = 3600;
  if (typeof session.expires_in === "number" && session.expires_in > 0) {
    maxAge = session.expires_in;
  } else if (typeof session.expires_at === "number" && session.expires_at > 0) {
    const remaining = session.expires_at - Math.floor(Date.now() / 1000);
    if (remaining > 0) maxAge = remaining;
  }

  // Set sb-access-token cookie
  document.cookie = `sb-access-token=${encodeURIComponent(
    session.access_token,
  )}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureFlag}`;

  // Set sb-refresh-token cookie (30 days lifespan)
  if (session.refresh_token) {
    const refreshMaxAge = 60 * 60 * 24 * 30; // 30 days
    document.cookie = `sb-refresh-token=${encodeURIComponent(
      session.refresh_token,
    )}; Path=/; Max-Age=${refreshMaxAge}; SameSite=Lax${secureFlag}`;
  }
}

/**
 * Remove auth cookies from document.cookie on sign out or invalid session.
 */
export function clearAuthCookies(): void {
  if (typeof document === "undefined") return;

  const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
  const secureFlag = isSecure ? "; Secure" : "";

  document.cookie = `sb-access-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secureFlag}`;
  document.cookie = `sb-refresh-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secureFlag}`;
}

/**
 * Synchronize cookies based on whether a valid session is present.
 */
export function syncAuthCookies(session: SessionCookiePayload | Session | null | undefined): void {
  if (session?.access_token) {
    setAuthCookies(session);
  } else {
    clearAuthCookies();
  }
}
