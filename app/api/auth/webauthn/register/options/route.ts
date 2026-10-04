import { NextRequest, NextResponse } from "next/server";
import {
  buildRegistrationOptions,
  encodeChallengePayload,
  REG_CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
} from "@/lib/auth/webauthn.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/webauthn/register/options
 *
 * Generates WebAuthn registration options for enrolling a new passkey.
 * Requires authenticated session (Bearer token or sb-access-token cookie).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    request.cookies.get("sb-access-token")?.value;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized: session required." }, { status: 401 });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized: invalid session." }, { status: 401 });
  }

  const user = userData.user;
  const userEmail = user.email || `user-${user.id.slice(0, 8)}@pandora.os`;
  const displayName = (user.user_metadata?.["name"] as string | undefined) || userEmail;

  const options = await buildRegistrationOptions(user.id, userEmail, displayName, request);
  const cookieValue = encodeChallengePayload(options.challenge);

  const isProd = process.env.NODE_ENV === "production" || request.url.startsWith("https:");

  const response = NextResponse.json(options);

  response.cookies.set(REG_CHALLENGE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });

  return response;
}
