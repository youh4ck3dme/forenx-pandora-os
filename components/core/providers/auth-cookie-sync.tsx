"use client";

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { setAuthCookies, clearAuthCookies } from "@/lib/auth/cookies";

/**
 * Background provider that keeps document.cookie in sync with Supabase Auth:
 * - Syncs existing session on mount
 * - Sets cookies when SIGNED_IN or TOKEN_REFRESHED occurs
 * - Clears cookies when SIGNED_OUT occurs
 */
export function AuthCookieSync() {
  useEffect(() => {
    // 1. Check existing session on mount
    supabase.auth.getSession().then(({ data }: { data: { session: any } }) => {
      if (data?.session) {
        setAuthCookies(data.session);
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
          setAuthCookies(session);
        }
      } else if (event === "SIGNED_OUT") {
        clearAuthCookies();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
