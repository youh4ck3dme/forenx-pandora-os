/**
 * Server-side WebAuthn helpers for PANDORA / ForenX passkey authentication.
 *
 * Invariants:
 * - Challenge TTL: 2 minutes (CHALLENGE_TTL_SECONDS = 120).
 * - rpId and origin are verified strictly; fail-closed on mismatch.
 * - An expired, invalid or missing challenge returns 401 fail-closed.
 * - counter/sign_count must advance (cloned authenticator replay protection).
 * - No sensitive keys, raw credentials or raw signatures logged.
 */
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const CHALLENGE_COOKIE = "webauthn_auth_challenge";
export const LEGACY_CHALLENGE_COOKIE = "wa_challenge";
export const REG_CHALLENGE_COOKIE = "webauthn_reg_challenge";
export const CHALLENGE_TTL_SECONDS = 120; // 2 minutes

type HostSource = Request | { headers: Headers } | undefined;

/** Derive rpId dynamically from env, request host, or fallback. */
export function getRpId(request?: HostSource): string {
  const envRpId = (process.env.NEXT_PUBLIC_RP_ID ?? process.env.RP_ID ?? "").trim();
  if (envRpId) return envRpId;

  if (request) {
    const hostHeader =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      "";
    if (hostHeader) {
      const hostname = hostHeader.split(":")[0]?.trim();
      if (hostname) return hostname;
    }
  }

  return "localhost";
}

/** Derive strict allowed origins list. */
export function getExpectedOrigins(request?: HostSource): string[] {
  const origins = new Set<string>();

  if (process.env.NEXT_PUBLIC_APP_URL) {
    origins.add(process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/$/, ""));
  }

  // Canonical production and local environments
  origins.add("https://pandora.whoiswho.at");
  origins.add("http://localhost:3000");
  origins.add("http://127.0.0.1:3000");
  origins.add("http://localhost:3001");

  const rpId = getRpId(request);
  if (rpId && rpId !== "localhost" && rpId !== "127.0.0.1") {
    origins.add(`https://${rpId}`);
  }

  if (request) {
    const originHeader = request.headers.get("origin");
    if (originHeader) {
      try {
        const parsed = new URL(originHeader);
        if (
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === rpId ||
          parsed.hostname === "pandora.whoiswho.at"
        ) {
          origins.add(parsed.origin);
        }
      } catch {
        // Ignore unparseable origin header
      }
    }
  }

  return Array.from(origins);
}

/** Backward-compatible single expected origin. */
export function getExpectedOrigin(): string {
  const origins = getExpectedOrigins();
  return origins[0] ?? "https://pandora.whoiswho.at";
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
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.challenge !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    const challenge = parsed.challenge;
    const issuedAt = parsed.issuedAt;
    const age = Math.floor(Date.now() / 1000) - issuedAt;
    if (age > CHALLENGE_TTL_SECONDS || age < 0) return null;
    return { challenge, issuedAt };
  } catch {
    return null;
  }
}

export type WebAuthnCredentialRow = {
  id: string;
  user_id: string;
  credential_id: string;
  public_key_cbor: string;
  public_key?: string | null;
  sign_count: number;
  counter?: number | null;
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

  const publicKey = data.public_key_cbor || "";
  const counterVal = typeof data.sign_count === "number" ? data.sign_count : 0;

  return {
    id: data.id,
    user_id: data.user_id,
    credential_id: data.credential_id,
    public_key_cbor: publicKey,
    public_key: publicKey,
    sign_count: counterVal,
    counter: counterVal,
    transports: data.transports,
  };
}

/** Update sign_count / counter and last_used_at after successful verification. */
export async function updateSignCount(rowId: string, newCount: number): Promise<void> {
  await supabaseAdmin
    .from("webauthn_credentials")
    .update({
      sign_count: newCount,
      last_used_at: new Date().toISOString(),
    })
    .eq("id", rowId);
}

/** Save a newly registered credential. */
export async function saveCredential(params: {
  userId: string;
  credentialId: string;
  publicKeyCbor: string;
  signCount: number;
  aaguid?: string;
  deviceType?: string;
  backedUp?: boolean;
  transports?: AuthenticatorTransportFuture[];
  friendlyName?: string;
}): Promise<void> {
  await supabaseAdmin.from("webauthn_credentials").insert({
    user_id: params.userId,
    credential_id: params.credentialId,
    public_key_cbor: params.publicKeyCbor,
    sign_count: params.signCount,
    aaguid: params.aaguid ?? null,
    device_type: params.deviceType ?? null,
    backed_up: params.backedUp ?? false,
    transports: params.transports ?? null,
    friendly_name: params.friendlyName ?? null,
  });
}

/** Generate authentication options and return options JSON for navigator.credentials.get(). */
export async function buildAuthenticationOptions(userId?: string, request?: HostSource) {
  const allowCredentials = userId ? await getUserCredentials(userId) : [];
  const options = await generateAuthenticationOptions({
    rpID: getRpId(request),
    userVerification: "required",
    allowCredentials: allowCredentials.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    timeout: 60_000,
  });
  return options;
}

/** Generate registration options JSON for navigator.credentials.create(). */
export async function buildRegistrationOptions(
  userId: string,
  userEmail: string,
  userDisplayName?: string,
  request?: HostSource,
) {
  const userCredentials = await getUserCredentials(userId);
  const rpId = getRpId(request);

  const options = await generateRegistrationOptions({
    rpName: "PANDORA / ForenX OS",
    rpID: rpId,
    userID: Buffer.from(userId),
    userName: userEmail,
    userDisplayName: userDisplayName || userEmail,
    attestationType: "none",
    excludeCredentials: userCredentials.map((c) => ({
      id: c.credential_id,
      transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
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

  if (!data) return [];

  return data.map((item) => {
    const pk = item.public_key_cbor || "";
    const cnt = typeof item.sign_count === "number" ? item.sign_count : 0;
    return {
      id: item.id,
      user_id: item.user_id,
      credential_id: item.credential_id,
      public_key_cbor: pk,
      public_key: pk,
      sign_count: cnt,
      counter: cnt,
      transports: item.transports,
    };
  });
}

export type VerifyResult =
  | { ok: true; userId: string; newSignCount: number }
  | { ok: false; reason: string };

/** Verify an authentication response against stored credential and challenge. */
export async function verifyPasskeyResponse(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
  request?: HostSource,
): Promise<VerifyResult> {
  const cred = await loadCredential(response.id);
  if (!cred) return { ok: false, reason: "Credential not found." };

  const publicKeyBytes = Buffer.from(cred.public_key_cbor, "base64url");
  const origins = getExpectedOrigins(request);
  const rpId = getRpId(request);

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
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

  // Cloned authenticator / replay detection
  // If stored counter > 0, the new counter must be strictly greater than the stored counter
  if (cred.sign_count > 0 && newCount <= cred.sign_count) {
    return {
      ok: false,
      reason: "Potential cloned authenticator detected: signature counter did not advance.",
    };
  }

  await updateSignCount(cred.id, newCount);

  return { ok: true, userId: cred.user_id, newSignCount: newCount };
}

export type PasskeyRegistrationInput = {
  id: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    authenticatorData?: string;
    transports?: AuthenticatorTransportFuture[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
  };
  authenticatorAttachment?: "cross-platform" | "platform";
  clientExtensionResults?: Record<string, unknown>;
  type: "public-key";
};

/** Verify a registration response and persist the new passkey credential in DB. */
export async function verifyPasskeyRegistrationResponse(
  response: RegistrationResponseJSON | PasskeyRegistrationInput,
  expectedChallenge: string,
  userId: string,
  friendlyName?: string,
  request?: HostSource,
): Promise<{ ok: true; credentialId: string } | { ok: false; reason: string }> {
  const origins = getExpectedOrigins(request);
  const rpId = getRpId(request);

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Registration verification failed.",
    };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "Registration verification failed." };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const credentialIdBase64 = credential.id;
  const publicKeyBase64 = Buffer.from(credential.publicKey).toString("base64url");

  await saveCredential({
    userId,
    credentialId: credentialIdBase64,
    publicKeyCbor: publicKeyBase64,
    signCount: credential.counter,
    aaguid: verification.registrationInfo.aaguid,
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    transports: response.response.transports as AuthenticatorTransportFuture[] | undefined,
    friendlyName,
  });

  return { ok: true, credentialId: credentialIdBase64 };
}
