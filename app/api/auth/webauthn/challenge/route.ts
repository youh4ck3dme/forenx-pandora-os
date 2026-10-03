import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthenticationOptions,
  encodeChallengePayload,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  getRpId,
} from "@/lib/auth/webauthn.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/webauthn/challenge
 *
 * Issues a fresh cryptographic challenge for passkey authentication.
 * The challenge is stored in a short-lived (2 min) HttpOnly SameSite=Strict cookie.
 * The response body contains the full PublicKeyCredentialRequestOptionsJSON
 * for navigator.credentials.get().
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Optional hint: caller may pass ?userId=<uuid> to pre-filter allowCredentials
  const userId = request.nextUrl.searchParams.get("userId") ?? undefined;

  const options = await buildAuthenticationOptions(userId);

  const cookieValue = encodeChallengePayload(options.challenge);

  const response = NextResponse.json({
    ...options,
    rpId: getRpId(),
  });

  response.cookies.set(CHALLENGE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/auth/webauthn/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });

  return response;
}
