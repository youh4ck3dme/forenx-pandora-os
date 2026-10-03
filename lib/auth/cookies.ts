/**
 * PANDORA / ForenX - Client Auth Cookie Synchronization
 *
 * Bridges Supabase client session to server-managed HttpOnly cookies via:
 * - POST /api/auth/session
 * - DELETE /api/auth/session
 *
 * Invariant: Never write cookies directly via document.cookie.
 * Server must validate session with Supabase before issuing HttpOnly cookies.
 */

import type { Session } from "@supabase/supabase-js";

export interface SessionCookiePayload {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  expires_at?: number | null;
}

/**
 * Call server-side session bridge to set HttpOnly cookies.
 */
export async function setAuthCookies(
  session: SessionCookiePayload | Session | null | undefined,
): Promise<boolean> {
  if (typeof window === "undefined" || !session?.access_token) return false;

  let expiresIn = 3600;
  if (typeof session.expires_in === "number" && session.expires_in > 0) {
    expiresIn = session.expires_in;
  } else if (typeof session.expires_at === "number" && session.expires_at > 0) {
    const remaining = session.expires_at - Math.floor(Date.now() / 1000);
    if (remaining > 0) expiresIn = remaining;
  }

  try {
    const response = await fetch("/api/auth/session/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token ?? undefined,
        expires_in: expiresIn,
      }),
      credentials: "same-origin",
    });

    return response.ok;
  } catch (err) {
    console.error("[setAuthCookies] Session bridge error:", err);
    return false;
  }
}

/**
 * Call server-side session bridge to clear HttpOnly cookies on logout.
 */
export async function clearAuthCookies(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    const response = await fetch("/api/auth/session/", {
      method: "DELETE",
      credentials: "same-origin",
    });

    return response.ok;
  } catch (err) {
    console.error("[clearAuthCookies] Session clear error:", err);
    return false;
  }
}

/**
 * Synchronize cookies based on whether a valid session is present.
 */
export async function syncAuthCookies(
  session: SessionCookiePayload | Session | null | undefined,
): Promise<boolean> {
  if (session?.access_token) {
    return await setAuthCookies(session);
  } else {
    return await clearAuthCookies();
  }
}

/** Alias for setAuthCookies to match server-side bridge terminology */
export const syncSessionWithServer = setAuthCookies;

