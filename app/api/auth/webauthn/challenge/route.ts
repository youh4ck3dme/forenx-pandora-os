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
 * The challenge is stored in a short-lived (120s) HttpOnly SameSite=Strict cookie.
 * The response body contains PublicKeyCredentialRequestOptionsJSON for navigator.credentials.get().
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
  const rpId = getRpId(request);

  const options = await buildAuthenticationOptions(userId, request);
  const cookieValue = encodeChallengePayload(options.challenge);

  const isProd = process.env.NODE_ENV === "production" || request.url.startsWith("https:");

  const response = NextResponse.json({
    ...options,
    rpId,
  });

  response.cookies.set(CHALLENGE_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
    maxAge: CHALLENGE_TTL_SECONDS,
  });

  return response;
}
