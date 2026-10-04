/**
 * Client-side WebAuthn passkey authentication & registration flows.
 * Uses @simplewebauthn/browser for standards-compliant WebAuthn API handling.
 */
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/types";

export type PasskeyLoginResult =
  | { ok: true; redirectUrl: string; next: string }
  | { ok: false; reason: string };

export type PasskeyRegisterResult =
  | { ok: true; credentialId: string }
  | { ok: false; reason: string };

/** Check if WebAuthn / Passkeys are supported in this browser. */
export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof window.navigator?.credentials !== "undefined"
  );
}

/**
 * Full passkey authentication flow:
 * 1. GET /api/auth/webauthn/challenge -> get challenge & options
 * 2. Invoke native browser authenticator via startAuthentication()
 * 3. POST /api/auth/webauthn/verify -> verify cryptographic signature & set HttpOnly session
 */
export async function loginWithPasskey(
  redirectNext?: string,
): Promise<PasskeyLoginResult> {
  if (!isPasskeySupported()) {
    return { ok: false, reason: "Váš prehliadač nepodporuje Passkey / WebAuthn." };
  }

  // Step 1: Fetch challenge and options from server
  let options: PublicKeyCredentialRequestOptionsJSON;
  try {
    const challengeRes = await fetch("/api/auth/webauthn/challenge/", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!challengeRes.ok) {
      return { ok: false, reason: "Nepodarilo sa získať autentifikačnú výzvu zo servera." };
    }

    options = (await challengeRes.json()) as PublicKeyCredentialRequestOptionsJSON;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Chyba siete pri získavaní výzvy.",
    };
  }

  // Step 2: Invoke native browser authenticator
  let authResponse;
  try {
    authResponse = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "NotAllowedError") {
        return { ok: false, reason: "Passkey prihlásenie bolo zrušené používateľom alebo vypršalo." };
      }
      if (err.name === "InvalidStateError") {
        return { ok: false, reason: "Tento kľúč už nie je platný pre danú doménu." };
      }
      return { ok: false, reason: err.message };
    }
    return { ok: false, reason: "Passkey overenie v prehliadači zlyhalo." };
  }

  // Step 3: Send signed response to server for cryptographic verification
  try {
    const verifyRes = await fetch("/api/auth/webauthn/verify/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        ...authResponse,
        next: redirectNext,
        redirectTo: redirectNext,
      }),
    });

    if (!verifyRes.ok) {
      const body = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
      const rawError = typeof body.error === "string" ? body.error : "Overenie passkey kľúča zlyhalo.";
      const friendlyError =
        rawError === "Credential not found."
          ? "Tento Passkey nie je priradený k žiadnemu účtu v systéme. Prihláste sa najprv pomocou e-mailu a hesla."
          : rawError;
      return {
        ok: false,
        reason: friendlyError,
      };
    }

    const data = (await verifyRes.json()) as {
      success?: boolean;
      ok?: boolean;
      redirectUrl?: string;
      next?: string;
    };

    const target = data.redirectUrl || data.next || "/dashboard";
    return { ok: true, redirectUrl: target, next: target };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Chyba komunikácie so serverom pri overovaní.",
    };
  }
}

/**
 * Full passkey registration flow (enroll a new credential for logged-in user):
 * 1. GET /api/auth/webauthn/register/options -> get creation options
 * 2. Invoke browser authenticator via startRegistration()
 * 3. POST /api/auth/webauthn/register/verify -> store credential in database
 */
export async function registerPasskey(
  friendlyName?: string,
): Promise<PasskeyRegisterResult> {
  if (!isPasskeySupported()) {
    return { ok: false, reason: "Váš prehliadač nepodporuje Passkey / WebAuthn." };
  }

  // Step 1: Fetch creation options from server
  let options: PublicKeyCredentialCreationOptionsJSON;
  try {
    const optionsRes = await fetch("/api/auth/webauthn/register/options/", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });

    if (!optionsRes.ok) {
      const body = (await optionsRes.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: false,
        reason: typeof body.error === "string" ? body.error : "Nepodarilo sa pripraviť registráciu kľúča.",
      };
    }

    options = (await optionsRes.json()) as PublicKeyCredentialCreationOptionsJSON;
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Chyba siete pri príprave registrácie.",
    };
  }

  // Step 2: Invoke native browser authenticator for registration
  let regResponse;
  try {
    regResponse = await startRegistration({ optionsJSON: options });
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "NotAllowedError") {
        return { ok: false, reason: "Registrácia passkey bola zrušená alebo vypršala." };
      }
      return { ok: false, reason: err.message };
    }
    return { ok: false, reason: "Registrácia passkey v prehliadači zlyhalo." };
  }

  // Step 3: Send registration response to server for verification and storage
  try {
    const verifyRes = await fetch("/api/auth/webauthn/register/verify/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        ...regResponse,
        friendlyName,
      }),
    });

    if (!verifyRes.ok) {
      const body = (await verifyRes.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        ok: false,
        reason: typeof body.error === "string" ? body.error : "Uloženie kľúča na serveri zlyhalo.",
      };
    }

    const data = (await verifyRes.json()) as { credentialId: string };
    return { ok: true, credentialId: data.credentialId };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Chyba komunikácie pri registrácii kľúča.",
    };
  }
}
