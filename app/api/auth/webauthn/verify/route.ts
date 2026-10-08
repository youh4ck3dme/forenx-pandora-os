import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  consumeChallengeOnce,
  decodeChallengePayload,
  verifyPasskeyResponse,
  CHALLENGE_COOKIE,
  LEGACY_CHALLENGE_COOKIE,
} from "@/lib/auth/webauthn.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getSafeRedirectTarget } from "@/lib/auth/redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/auth/webauthn/verify
 *
 * Verifies a passkey authentication response.
 * Security invariants:
 * - Challenge is read exclusively from HttpOnly cookie and immediately consumed (one-time use).
 * - Challenge TTL is 120s; expired challenge -> strict 401.
 * - Origin and rpId are verified strictly against request host / env.
 * - sign_count / counter must advance; replay detected -> strict 401.
 * - On success: sets Supabase HttpOnly session cookies and returns { success: true, redirectUrl }.
 * - On any failure: returns strict 401 JSON — no information leakage.
 * - Zero sensitive keys or raw signatures in logs.
 */

const AuthResponseSchema = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().nullable().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.unknown()).optional(),
  type: z.literal("public-key"),
  next: z.string().optional(),
  redirectTo: z.string().optional(),
  redirect_to: z.string().optional(),
});

interface AdminWithSession {
  createSession?: (params: { userId: string }) => Promise<{
    data: { session: { access_token: string; refresh_token?: string; expires_in?: number } | null } | null;
    error: Error | null;
  }>;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read and validate challenge from cookie — fail-closed if absent/expired
  const rawCookie =
    request.cookies.get(CHALLENGE_COOKIE)?.value ??
    request.cookies.get(LEGACY_CHALLENGE_COOKIE)?.value;

  if (!rawCookie) {
    const res = NextResponse.json({ error: "Challenge missing or expired." }, { status: 401 });
    res.cookies.delete(CHALLENGE_COOKIE);
    res.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return res;
  }

  const challengePayload = decodeChallengePayload(rawCookie);
  if (!challengePayload) {
    const res = NextResponse.json({ error: "Challenge expired or invalid." }, { status: 401 });
    res.cookies.delete(CHALLENGE_COOKIE);
    res.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return res;
  }

  // One-time use enforced server-side: deleting the cookie does not stop a
  // client that kept a copy from replaying it within the TTL window.
  const consumed = await consumeChallengeOnce("auth", challengePayload.challenge, challengePayload.issuedAt);
  if (consumed !== "consumed") {
    const res =
      consumed === "replayed"
        ? NextResponse.json({ error: "Challenge already used." }, { status: 401 })
        : NextResponse.json({ error: "Challenge verification is temporarily unavailable." }, { status: 503 });
    res.cookies.delete(CHALLENGE_COOKIE);
    res.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return res;
  }

  // 2. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    res.cookies.delete(CHALLENGE_COOKIE);
    res.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return res;
  }

  const parsed = AuthResponseSchema.safeParse(body);
  if (!parsed.success) {
    const res = NextResponse.json({ error: "Invalid authentication response structure." }, { status: 400 });
    res.cookies.delete(CHALLENGE_COOKIE);
    res.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return res;
  }

  const {
    next: rawNext,
    redirectTo: rawRedirectTo,
    redirect_to: rawRedirectUnderscore,
    ...authResponse
  } = parsed.data;

  // 3. Verify cryptographic signature & counter with simplewebauthn
  const result = await verifyPasskeyResponse(
    authResponse as AuthenticationResponseJSON,
    challengePayload.challenge,
    request,
  );

  if (!result.ok) {
    // Consume challenge immediately to prevent oracle/replay attacks
    const failResponse = NextResponse.json(
      { error: result.reason || "Authentication failed." },
      { status: 401 },
    );
    failResponse.cookies.delete(CHALLENGE_COOKIE);
    failResponse.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return failResponse;
  }

  // 4. Look up Supabase user to ensure active account
  const { data: userRecord, error: userError } = await supabaseAdmin.auth.admin.getUserById(
    result.userId,
  );
  if (userError || !userRecord?.user) {
    const failResponse = NextResponse.json({ error: "User account not found." }, { status: 401 });
    failResponse.cookies.delete(CHALLENGE_COOKIE);
    failResponse.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return failResponse;
  }

  // 5. Generate a valid Supabase session for the verified user
  let session: { access_token: string; refresh_token?: string; expires_in?: number } | null = null;

  const adminExt = supabaseAdmin.auth.admin as AdminWithSession;
  if (typeof adminExt.createSession === "function") {
    const sessionRes = await adminExt.createSession({ userId: result.userId });
    if (sessionRes?.data?.session) {
      session = sessionRes.data.session;
    }
  }

  if (!session && userRecord.user.email) {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: userRecord.user.email,
    });

    if (!linkError && linkData?.properties?.hashed_token) {
      const { data: otpData, error: otpError } = await supabaseAdmin.auth.verifyOtp({
        token_hash: linkData.properties.hashed_token,
        type: "magiclink",
      });

      if (!otpError && otpData?.session) {
        session = otpData.session;
      }
    }
  }

  if (!session) {
    const failResponse = NextResponse.json({ error: "Session creation failed." }, { status: 500 });
    failResponse.cookies.delete(CHALLENGE_COOKIE);
    failResponse.cookies.delete(LEGACY_CHALLENGE_COOKIE);
    return failResponse;
  }

  const requestedTarget = rawNext ?? rawRedirectTo ?? rawRedirectUnderscore ?? "/dashboard";
  const redirectTarget = getSafeRedirectTarget(requestedTarget, "/dashboard") ?? "/dashboard";

  const isProd = process.env.NODE_ENV === "production" || request.url.startsWith("https:");

  const response = NextResponse.json(
    {
      success: true,
      ok: true,
      redirectUrl: redirectTarget,
      next: redirectTarget,
      user: {
        id: userRecord.user.id,
        email: userRecord.user.email,
      },
    },
    { status: 200 },
  );

  // Set HttpOnly auth cookies directly on the response (matching session bridge specification)
  response.cookies.set("sb-access-token", session.access_token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: session.expires_in ?? 3600,
  });

  if (session.refresh_token) {
    response.cookies.set("sb-refresh-token", session.refresh_token, {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  // Consume one-time challenge cookies completely
  response.cookies.delete(CHALLENGE_COOKIE);
  response.cookies.delete(LEGACY_CHALLENGE_COOKIE);

  return response;
}
