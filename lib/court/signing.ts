/**
 * Court Pack — Ed25519 signing over the canonical manifest.
 *
 * Security contract (court-grade):
 *  - The private key is NEVER stored in env as plaintext. `config/env.ts` holds
 *    only a reference (`FORENZX_SIGNING_PRIVATE_KEY_REF`, e.g. `file:/…`). A
 *    `SigningKeyProvider` resolves the reference; `file:` is the MVP backend and
 *    `vault:` / `kms:` can be added later WITHOUT changing the manifest,
 *    signature or verifier format.
 *  - The private key (and its PEM bytes) is never logged or returned to callers.
 *    It is read only at signing time and used to produce a signature.
 *  - The signing key is validated to be Ed25519 and to correspond to the active
 *    public-key record for the given `kid` (version / status / valid-from /
 *    revoked-at). A revoked or unknown `kid` cannot produce a valid pack.
 *  - The offline verifier needs ONLY the public key + kid — never this module.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  canonicalManifestBytes,
  sha256Hex,
  type CourtPackManifest,
} from "./manifest";

export type KeyStatus = "active" | "pending" | "revoked";

export type PublicKeyRecord = {
  kid: string;
  version: number;
  status: KeyStatus;
  validFrom: string; // ISO-8601
  revokedAt?: string | null;
  publicKeyPem: string; // SPKI PEM
};

export type SignatureKeyRecord = {
  version: number;
  status: KeyStatus;
  validFrom: string; // ISO-8601
  revokedAt: string | null; // ISO-8601 when the key was revoked, else null
};

export type CourtPackSignature = {
  algorithm: "Ed25519";
  kid: string;
  keyringVersion: string;
  publicKeyPem: string; // travels with the pack so verification is fully offline
  keyRecord: SignatureKeyRecord; // full trust metadata so the pack self-describes revocation
  manifestSha256: string; // hex, over the canonical manifest bytes
  signature: string; // base64
  signedAt: string; // ISO-8601, SELF-ASSERTED sign time (not a trusted clock)
};

/** Pluggable resolver for a private-key reference. `file:` is the first backend. */
export interface SigningKeyProvider {
  readonly scheme: string;
  /** Returns the PEM private key for `ref`. MUST NOT log the key or its bytes. */
  loadPrivateKeyPem(ref: string): string;
}

export type FileProviderOptions = {
  /** Reject group/world-readable key files. Enable in production (POSIX hosts). */
  enforcePermissions: boolean;
};

export class FileSigningKeyProvider implements SigningKeyProvider {
  readonly scheme = "file";
  constructor(private readonly options: FileProviderOptions) {}

  loadPrivateKeyPem(ref: string): string {
    if (!ref.startsWith("file:")) {
      throw new Error(`FileSigningKeyProvider cannot handle reference scheme: ${ref.split(":", 1)[0]}:`);
    }
    const path = ref.slice("file:".length);
    let stat;
    try {
      stat = statSync(path);
    } catch {
      // Do not echo the path content; the path itself is safe to name.
      throw new Error(`Signing private key not found at ${path}`);
    }
    if (this.options.enforcePermissions) {
      const mode = stat.mode & 0o777;
      if ((mode & 0o077) !== 0) {
        throw new Error(
          `Signing private key ${path} is group/world-readable (mode 0${mode.toString(8)}); require 0600`,
        );
      }
    }
    return readFileSync(path, "utf8");
  }
}

/** Selects a provider from a reference scheme. vault:/kms: are reserved stubs. */
export function resolveSigningKeyProvider(
  ref: string,
  fileOptions: FileProviderOptions,
): SigningKeyProvider {
  const scheme = ref.split(":", 1)[0];
  switch (scheme) {
    case "file":
      return new FileSigningKeyProvider(fileOptions);
    case "vault":
    case "kms":
      throw new Error(
        `Signing key provider "${scheme}:" is not implemented yet. ` +
          `Use file: for now; the signing/verifier format is backend-agnostic.`,
      );
    default:
      throw new Error(`Unsupported signing key reference scheme: ${scheme}:`);
  }
}

export type Keyring = {
  version: string;
  keys: PublicKeyRecord[];
};

export function parseKeyring(json: string, version: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("FORENZX_TRUSTED_PUBLIC_KEYS is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("FORENZX_TRUSTED_PUBLIC_KEYS must be a JSON array of key records");
  }
  const keys: PublicKeyRecord[] = parsed.map((raw, index) => {
    const record = raw as Partial<PublicKeyRecord>;
    if (!record || typeof record.kid !== "string" || !record.kid) {
      throw new Error(`Keyring entry ${index} is missing a kid`);
    }
    if (typeof record.publicKeyPem !== "string" || !record.publicKeyPem.includes("BEGIN PUBLIC KEY")) {
      throw new Error(`Keyring entry ${record.kid} is missing a valid SPKI publicKeyPem`);
    }
    const status = record.status;
    if (status !== "active" && status !== "pending" && status !== "revoked") {
      throw new Error(`Keyring entry ${record.kid} has an invalid status`);
    }
    return {
      kid: record.kid,
      version: typeof record.version === "number" ? record.version : 1,
      status,
      validFrom: typeof record.validFrom === "string" ? record.validFrom : "1970-01-01T00:00:00Z",
      revokedAt: record.revokedAt ?? null,
      publicKeyPem: record.publicKeyPem,
    };
  });
  return { version, keys };
}

export function parseRevokedKeyIds(csv: string | undefined): Set<string> {
  return new Set(
    (csv ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/** Returns the active key record for `kid`, or throws a precise reason. */
export function requireActiveKey(
  keyring: Keyring,
  kid: string,
  revoked: Set<string>,
  now: Date,
): PublicKeyRecord {
  const record = keyring.keys.find((key) => key.kid === kid);
  if (!record) {
    throw new Error(`Unknown signing kid: ${kid}`);
  }
  if (revoked.has(kid) || record.status === "revoked" || record.revokedAt) {
    throw new Error(`Signing kid is revoked: ${kid}`);
  }
  if (record.status !== "active") {
    throw new Error(`Signing kid is not active (status=${record.status}): ${kid}`);
  }
  if (new Date(record.validFrom).getTime() > now.getTime()) {
    throw new Error(`Signing kid is not yet valid (validFrom=${record.validFrom}): ${kid}`);
  }
  return record;
}

function publicKeyMatches(privateKey: KeyObject, expectedPublicPem: string): boolean {
  const derivedDer = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  const expectedDer = createPublicKey(expectedPublicPem).export({ type: "spki", format: "der" }) as Buffer;
  return derivedDer.length === expectedDer.length && derivedDer.equals(expectedDer);
}

export type SignOptions = {
  manifest: CourtPackManifest;
  kid: string;
  keyRef: string;
  keyring: Keyring;
  revoked: Set<string>;
  provider: SigningKeyProvider;
  now?: Date;
};

export function signCourtPackManifest(options: SignOptions): CourtPackSignature {
  const now = options.now ?? new Date();
  const record = requireActiveKey(options.keyring, options.kid, options.revoked, now);

  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey(options.provider.loadPrivateKeyPem(options.keyRef));
  } catch (error) {
    // Never include key material in the error; surface only the cause message.
    throw new Error(`Failed to load signing private key: ${(error as Error).message}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`Signing key is not Ed25519 (got ${privateKey.asymmetricKeyType ?? "unknown"})`);
  }
  if (!publicKeyMatches(privateKey, record.publicKeyPem)) {
    throw new Error(`Signing private key does not correspond to kid ${options.kid}`);
  }

  const bytes = canonicalManifestBytes(options.manifest);
  const signature = edSign(null, bytes, privateKey).toString("base64");

  return {
    algorithm: "Ed25519",
    kid: options.kid,
    keyringVersion: options.keyring.version,
    publicKeyPem: record.publicKeyPem,
    keyRecord: {
      version: record.version,
      status: record.status,
      validFrom: record.validFrom,
      revokedAt: record.revokedAt ?? null,
    },
    manifestSha256: sha256Hex(bytes),
    signature,
    signedAt: now.toISOString(),
  };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * In-app verification. The standalone offline verifier (`verify.mjs`) performs
 * the equivalent checks without importing this module or any secret.
 */
export function verifyCourtPackSignature(
  manifest: CourtPackManifest,
  signature: CourtPackSignature,
  options?: { revoked?: Set<string>; keyring?: Keyring; asOf?: Date },
): VerifyResult {
  if (signature.algorithm !== "Ed25519") {
    return { ok: false, reason: `unsupported signature algorithm: ${signature.algorithm}` };
  }
  const revoked = options?.revoked ?? new Set<string>();

  // Revocation semantics (INV-028): CURRENT revocation state comes from the
  // trusted keyring record and/or the revoked-id list — NOT from the pack's
  // frozen keyRecord (which documents the signing-time status, always active).
  // A revoked key cannot sign NEW packs (enforced at signing). A HISTORICAL pack
  // stays valid ONLY when a TRUSTED time (`asOf`, e.g. a verified RFC 3161
  // timestamp) is strictly before the key's `revokedAt`. Without a trusted time,
  // or without a recorded `revokedAt`, verification is fail-closed. The
  // self-asserted `signedAt` is never trusted for this decision.
  const keyringRecord = options?.keyring?.keys.find((key) => key.kid === signature.kid);
  const currentRevokedAt = keyringRecord?.revokedAt ? new Date(keyringRecord.revokedAt) : null;
  const isRevoked = revoked.has(signature.kid) || keyringRecord?.status === "revoked" || currentRevokedAt !== null;
  if (isRevoked) {
    const trustedBeforeRevocation =
      options?.asOf instanceof Date && currentRevokedAt !== null && options.asOf.getTime() < currentRevokedAt.getTime();
    if (!trustedBeforeRevocation) {
      return { ok: false, reason: `signing kid is revoked: ${signature.kid}` };
    }
  }
  if (options?.keyring) {
    const record = options.keyring.keys.find((key) => key.kid === signature.kid);
    if (!record) {
      return { ok: false, reason: `unknown kid: ${signature.kid}` };
    }
    // Revocation (incl. the pre-revocation `asOf` exception) is decided above;
    // this block only binds the signature's public key to the trusted keyring.
    try {
      const a = createPublicKey(record.publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
      const b = createPublicKey(signature.publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
      if (!a.equals(b)) {
        return { ok: false, reason: `public key in signature does not match trusted keyring for kid ${signature.kid}` };
      }
    } catch {
      return { ok: false, reason: "invalid public key encoding" };
    }
  }

  const bytes = canonicalManifestBytes(manifest);
  if (sha256Hex(bytes) !== signature.manifestSha256) {
    return { ok: false, reason: "manifest hash does not match signature.manifestSha256" };
  }
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(signature.publicKeyPem);
  } catch {
    return { ok: false, reason: "invalid public key PEM in signature" };
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    return { ok: false, reason: "signature public key is not Ed25519" };
  }
  const valid = edVerify(null, bytes, publicKey, Buffer.from(signature.signature, "base64"));
  return valid ? { ok: true } : { ok: false, reason: "Ed25519 signature verification failed" };
}
