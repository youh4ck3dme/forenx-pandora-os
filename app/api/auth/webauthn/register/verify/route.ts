import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  consumeChallengeOnce,
  decodeChallengePayload,
  verifyPasskeyRegistrationResponse,
  REG_CHALLENGE_COOKIE,
  type PasskeyRegistrationInput,
} from "@/lib/auth/webauthn.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RegistrationPayloadSchema: z.ZodType<PasskeyRegistrationInput & { friendlyName?: string }> = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    transports: z
      .array(
        z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]),
      )
      .optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
  authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
  clientExtensionResults: z.record(z.unknown()).optional(),
  type: z.literal("public-key"),
  friendlyName: z.string().optional(),
});

/**
 * POST /api/auth/webauthn/register/verify
 *
 * Verifies a passkey registration response and persists the credential into DB.
 * Requires authenticated session.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const rawCookie = request.cookies.get(REG_CHALLENGE_COOKIE)?.value;
  if (!rawCookie) {
    const res = NextResponse.json({ error: "Registration challenge missing or expired." }, { status: 401 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  const challengePayload = decodeChallengePayload(rawCookie);
  if (!challengePayload) {
    const res = NextResponse.json({ error: "Registration challenge invalid or expired." }, { status: 401 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  const consumed = await consumeChallengeOnce("reg", challengePayload.challenge, challengePayload.issuedAt);
  if (consumed !== "consumed") {
    const res =
      consumed === "replayed"
        ? NextResponse.json({ error: "Registration challenge already used." }, { status: 401 })
        : NextResponse.json({ error: "Challenge verification is temporarily unavailable." }, { status: 503 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const res = NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  const parsed = RegistrationPayloadSchema.safeParse(body);
  if (!parsed.success) {
    const res = NextResponse.json({ error: "Invalid registration response structure." }, { status: 400 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  const { friendlyName, ...registrationResponse } = parsed.data;

  const result = await verifyPasskeyRegistrationResponse(
    registrationResponse,
    challengePayload.challenge,
    userData.user.id,
    friendlyName,
    request,
  );

  if (!result.ok) {
    const res = NextResponse.json({ error: result.reason }, { status: 400 });
    res.cookies.delete(REG_CHALLENGE_COOKIE);
    return res;
  }

  const response = NextResponse.json({
    success: true,
    ok: true,
    credentialId: result.credentialId,
  });

  // Consume registration challenge cookie
  response.cookies.delete(REG_CHALLENGE_COOKIE);

  return response;
}
