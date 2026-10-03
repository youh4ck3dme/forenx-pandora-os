/**
 * Client-side WebAuthn passkey authentication flow.
 * Uses @simplewebauthn/browser for browser API calls.
 */
import { startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/types";

export type PasskeyLoginResult =
  | { ok: true; next: string }
  | { ok: false; reason: string };

/**
 * Full passkey authentication flow:
 * 1. Fetch challenge from /api/auth/webauthn/challenge
 * 2. Prompt browser for passkey via navigator.credentials.get
 * 3. POST the signed response to /api/auth/webauthn/verify
 */
export async function loginWithPasskey(
  redirectNext?: string,
): Promise<PasskeyLoginResult> {
  // Step 1: Get challenge and options from server
  const challengeRes = await fetch("/api/auth/webauthn/challenge", {
    method: "GET",
    credentials: "same-origin",
  });
  if (!challengeRes.ok) {
    return { ok: false, reason: "Nepodarilo sa získať výzvu zo servera." };
  }

  const options = (await challengeRes.json()) as PublicKeyCredentialRequestOptionsJSON;

  // Step 2: Invoke native browser authenticator
  let authResponse;
  try {
    authResponse = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "NotAllowedError") {
        return { ok: false, reason: "Passkey výzva bola zrušená alebo vypršala." };
      }
      return { ok: false, reason: err.message };
    }
    return { ok: false, reason: "Passkey prihlásenie zlyhalo." };
  }

  // Step 3: Send signed response to server for verification
  const verifyRes = await fetch("/api/auth/webauthn/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ ...authResponse, next: redirectNext }),
  });

  if (!verifyRes.ok) {
    const body = await verifyRes.json().catch(() => ({})) as Record<string, unknown>;
    return {
      ok: false,
      reason: typeof body.error === "string" ? body.error : "Overenie passkey zlyhalo.",
    };
  }

  const data = (await verifyRes.json()) as {
    ok: boolean;
    next?: string;
    token?: string;
    type?: string;
  };

  // Exchange the one-time magiclink token for a real Supabase session
  if (data.token && data.type === "magiclink") {
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (supabaseUrl && supabaseAnonKey) {
      const client = createClient(supabaseUrl, supabaseAnonKey);
      const { data: session, error } = await client.auth.verifyOtp({
        token_hash: data.token,
        type: "magiclink",
      });
      if (error || !session?.session) {
        return { ok: false, reason: "Výmena tokenu zlyhala. Skúste znova." };
      }
      // Sync the session to server-side HttpOnly cookies
      const { setAuthCookies } = await import("@/lib/auth/cookies");
      await setAuthCookies(session.session);
    }
  }

  return { ok: true, next: data.next ?? "/browser/" };
}
