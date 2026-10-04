/**
 * Resolves the Court Pack signing context from the validated environment.
 *
 * All court-grade requirements (kid, key reference, keyring, keyring version,
 * local AI endpoint) are already enforced fail-closed by `config/env.ts`, so by
 * the time this runs in court-grade the fields are present. The private key
 * itself is never read here — only the reference is passed to the provider,
 * which loads the key lazily at signing time.
 */
import { env } from "@/config/env";
import {
  parseKeyring,
  parseRevokedKeyIds,
  resolveSigningKeyProvider,
  type Keyring,
  type SigningKeyProvider,
} from "@/lib/court/signing";

export type CourtSigningContext = {
  kid: string;
  keyRef: string;
  keyring: Keyring;
  revoked: Set<string>;
  provider: SigningKeyProvider;
  tsaUrl: string | null;
};

export function courtGradeEnabled(): boolean {
  return env.FORENZX_COURT_GRADE === true;
}

export function getCourtSigningContext(): CourtSigningContext {
  if (!env.FORENZX_COURT_GRADE) {
    throw new Error("Court Pack signing requires FORENZX_COURT_GRADE=true");
  }
  const kid = env.FORENZX_SIGNING_KEY_ID;
  const keyRef = env.FORENZX_SIGNING_PRIVATE_KEY_REF;
  const keysJson = env.FORENZX_TRUSTED_PUBLIC_KEYS;
  const keyringVersion = env.FORENZX_KEYRING_VERSION;
  if (!kid || !keyRef || !keysJson || !keyringVersion) {
    // Defense in depth; env.superRefine should already guarantee these.
    throw new Error("Court-grade signing configuration is incomplete");
  }

  // Reject group/world-readable key files in production (POSIX hosts only).
  const enforcePermissions = process.env.NODE_ENV === "production" && process.platform !== "win32";
  const provider: SigningKeyProvider = resolveSigningKeyProvider(keyRef, { enforcePermissions });

  return {
    kid,
    keyRef,
    keyring: parseKeyring(keysJson, keyringVersion),
    revoked: parseRevokedKeyIds(env.FORENZX_REVOKED_KEY_IDS),
    provider,
    tsaUrl: env.FORENZX_TSA_URL ?? null,
  };
}
