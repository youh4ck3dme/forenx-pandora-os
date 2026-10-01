"use client";

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { syncAuthCookies } from "@/lib/auth/cookies";

/**
 * Background provider that keeps auth cookies in sync with Supabase Auth:
 * - Syncs existing session on mount via server bridge
 * - Sets HttpOnly server cookies when SIGNED_IN or TOKEN_REFRESHED occurs
 * - Clears cookies via DELETE /api/auth/session when SIGNED_OUT occurs
 */
export function AuthCookieSync() {
  useEffect(() => {
    // 1. Check existing session on mount
    supabase.auth.getSession().then(({ data }: { data: { session: any } }) => {
      if (data?.session) {
        syncAuthCookies(data.session);
      }
    });

    // 2. Listen to continuous auth state events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: string, session: any) => {
      if (
        event === "SIGNED_IN" ||
        event === "TOKEN_REFRESHED" ||
        (event === "INITIAL_SESSION" && session)
      ) {
        if (session) {
          syncAuthCookies(session);
        }
      } else if (event === "SIGNED_OUT") {
        syncAuthCookies(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
