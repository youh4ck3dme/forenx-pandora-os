import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthenticationOptions,
  encodeChallengePayload,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
  getRpId,
  isChallengeSecretConfigured,
  CHALLENGE_SECRET_MISSING_ERROR,
} from "@/lib/auth/webauthn.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/auth/webauthn/challenge
 *
 * Issues a fresh cryptographic challenge for passkey authentication.
 * The challenge is stored in a short-lived (120s) HttpOnly SameSite=Strict cookie.
 * The response body contains PublicKeyCredentialRequestOptionsJSON for navigator.credentials.get().
 *
 * Fail-closed: without a challenge HMAC secret in production → 503 JSON,
 * checked before any options are built or the DB is read; no cookie is set.
 */
function notConfigured(): NextResponse {
  return NextResponse.json({ ok: false, error: CHALLENGE_SECRET_MISSING_ERROR }, { status: 503 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isChallengeSecretConfigured()) return notConfigured();

  const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
  const rpId = getRpId(request);

  const options = await buildAuthenticationOptions(userId, request);
  let cookieValue: string;
  try {
    cookieValue = encodeChallengePayload(options.challenge);
  } catch {
    return notConfigured();
  }

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
