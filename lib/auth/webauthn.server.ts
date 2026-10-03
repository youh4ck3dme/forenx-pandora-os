/**
 * Server-side WebAuthn helpers for PANDORA / ForenX passkey authentication.
 *
 * Invariants:
 * - Challenge TTL: 2 minutes (CHALLENGE_TTL_SECONDS).
 * - rpId and origin are derived from env, never from caller input.
 * - An expired or missing challenge returns 401 fail-closed.
 * - sign_count must be strictly greater than the stored value (replay protection).
 */
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CHALLENGE_COOKIE = "wa_challenge";
export const CHALLENGE_TTL_SECONDS = 120; // 2 minutes

/** Derive rpId from env; never accept it from caller. */
export function getRpId(): string {
  return (process.env.NEXT_PUBLIC_RP_ID ?? process.env.RP_ID ?? "localhost").trim();
}

/** Derive expected origin from env or rpId. */
export function getExpectedOrigin(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/$/, "");
  }
  const rpId = getRpId();
  return rpId === "localhost" ? "http://localhost:3000" : `https://${rpId}`;
}

export type ChallengePayload = {
  challenge: string;
  issuedAt: number; // Unix seconds
};

/** Encode challenge payload into a short-lived cookie value. */
export function encodeChallengePayload(challenge: string): string {
  const payload: ChallengePayload = { challenge, issuedAt: Math.floor(Date.now() / 1000) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Decode and validate challenge cookie; returns null if expired or malformed. */
export function decodeChallengePayload(raw: string): ChallengePayload | null {
  try {
    const payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as ChallengePayload).challenge !== "string" ||
      typeof (payload as ChallengePayload).issuedAt !== "number"
    ) {
      return null;
    }
    const p = payload as ChallengePayload;
    const age = Math.floor(Date.now() / 1000) - p.issuedAt;
    if (age > CHALLENGE_TTL_SECONDS || age < 0) return null;
    return p;
  } catch {
    return null;
  }
}

export type WebAuthnCredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key_cbor: string;
  sign_count: number;
  transports: string[] | null;
};

/** Load a credential row by base64url credentialId (server-to-server only). */
export async function loadCredential(
  credentialId: string,
): Promise<WebAuthnCredentialRow | null> {
  const { data, error } = await supabaseAdmin
    .from("webauthn_credentials")
    .select("id, user_id, credential_id, public_key_cbor, sign_count, transports")
    .eq("credential_id", credentialId)
    .maybeSingle();
  if (error || !data) return null;
  return data as WebAuthnCredentialRow;
}

/** Update sign_count and last_used_at after successful verification. */
export async function updateSignCount(rowId: string, newCount: number): Promise<void> {
  await supabaseAdmin
    .from("webauthn_credentials")
    .update({ sign_count: newCount, last_used_at: new Date().toISOString() })
    .eq("id", rowId);
}

/** Save a newly registered credential. */
export async function saveCredential(params: {
  userId: string;
  credentialId: string;
  publicKeyCbor: string;
  signCount: number;
  aaguid: string;
  deviceType: string;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[];
}): Promise<void> {
  await supabaseAdmin.from("webauthn_credentials").insert({
    user_id: params.userId,
    credential_id: params.credentialId,
    public_key_cbor: params.publicKeyCbor,
    sign_count: params.signCount,
    aaguid: params.aaguid,
    device_type: params.deviceType,
    backed_up: params.backedUp,
    transports: params.transports,
  });
}

/** Generate authentication options and return base64url challenge string. */
export async function buildAuthenticationOptions(userId?: string) {
  const allowCredentials = userId ? await getUserCredentials(userId) : [];
  const options = await generateAuthenticationOptions({
    rpID: getRpId(),
    userVerification: "required",
    allowCredentials: allowCredentials.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    timeout: 60_000,
  });
  return options;
}

async function getUserCredentials(userId: string): Promise<WebAuthnCredentialRow[]> {
  const { data } = await supabaseAdmin
    .from("webauthn_credentials")
    .select("id, user_id, credential_id, public_key_cbor, sign_count, transports")
    .eq("user_id", userId)
    .order("last_used_at", { ascending: false });
  return (data ?? []) as WebAuthnCredentialRow[];
}

export type VerifyResult =
  | { ok: true; userId: string; newSignCount: number }
  | { ok: false; reason: string };

/** Verify an authentication response against stored credential and challenge. */
export async function verifyPasskeyResponse(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<VerifyResult> {
  const cred = await loadCredential(response.id);
  if (!cred) return { ok: false, reason: "Credential not found." };

  const publicKeyBytes = Buffer.from(cred.public_key_cbor, "base64url");

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: getExpectedOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: cred.credential_id,
        publicKey: publicKeyBytes,
        counter: cred.sign_count,
        transports: (cred.transports ?? []) as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Verification failed.",
    };
  }

  if (!verification.verified) return { ok: false, reason: "Signature verification failed." };

  const newCount = verification.authenticationInfo.newCounter;
  await updateSignCount(cred.id, newCount);

  return { ok: true, userId: cred.user_id, newSignCount: newCount };
}
