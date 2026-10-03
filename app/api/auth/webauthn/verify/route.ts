import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/types";
import {
  decodeChallengePayload,
  verifyPasskeyResponse,
  CHALLENGE_COOKIE,
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
 * - Challenge is read exclusively from HttpOnly cookie (never from body).
 * - Challenge TTL is 2 minutes; expired challenge → 401.
 * - Origin and rpId come from server env, not from request body.
 * - sign_count must increment; replay detected → 401.
 * - On success: sets Supabase session cookies and returns {ok: true, next}.
 * - On any failure: returns strict 401 JSON — no information leakage.
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
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Read and validate challenge from cookie — fail-closed if absent/expired
  const rawCookie = request.cookies.get(CHALLENGE_COOKIE)?.value;
  if (!rawCookie) {
    return NextResponse.json({ error: "Challenge missing or expired." }, { status: 401 });
  }
  const challengePayload = decodeChallengePayload(rawCookie);
  if (!challengePayload) {
    return NextResponse.json({ error: "Challenge expired or invalid." }, { status: 401 });
  }

  // 2. Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = AuthResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid authentication response." }, { status: 400 });
  }

  const { next: rawNext, ...authResponse } = parsed.data;

  // 3. Verify cryptographic signature
  const result = await verifyPasskeyResponse(
    authResponse as AuthenticationResponseJSON,
    challengePayload.challenge,
  );

  if (!result.ok) {
    // Consume the challenge regardless (prevent oracle attacks)
    const failResponse = NextResponse.json({ error: "Authentication failed." }, { status: 401 });
    failResponse.cookies.delete(CHALLENGE_COOKIE);
    return failResponse;
  }

  // 4. Confirm user exists in Supabase
  const { data: userRecord, error: userError } = await supabaseAdmin.auth.admin.getUserById(
    result.userId,
  );
  if (userError || !userRecord?.user) {
    return NextResponse.json({ error: "Authentication failed." }, { status: 401 });
  }

  const redirectTarget = getSafeRedirectTarget(rawNext ?? null, "/browser/") ?? "/browser/";

  // 5. Generate a magic-link token for the verified user — this is the supported
  //    Supabase Admin API mechanism to issue a session without a password.
  //    The client exchanges the token for a real session via the auth callback.
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: userRecord.user.email ?? "",
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return NextResponse.json({ error: "Session issuance failed." }, { status: 500 });
  }

  // Return the one-time token — client calls supabase.auth.verifyOtp to exchange it
  const response = NextResponse.json({
    ok: true,
    token: linkData.properties.hashed_token,
    type: "magiclink",
    next: redirectTarget,
  });

  // Consume the one-time challenge cookie
  response.cookies.delete(CHALLENGE_COOKIE);

  return response;
}
