/**
 * P0-01 / P1-01 — WebAuthn väzba podpisu vyšetrovateľa.
 *
 * Reálne volanie navigator.credentials.create (platform authenticator,
 * ES256/RS256) viaže podpis na hardvérový kľúč passkey. Ak prehliadač alebo
 * prostredie WebAuthn nepodporuje (napr. dev/test), prepadne sa na lokálny
 * softvérový podpis: ned exportovateľný ECDSA P-256 kľúč uložený v IndexedDB,
 * ktorým sa podpíše challenge. Ak zlyhá aj ten, vráti null — export pokračuje
 * bez väzby (podpisový blok ostáva, len bez WebAuthn poľa).
 */
import { sha256Hex } from "./provenance/sha256";

export type SignatureMethod = "webauthn" | "software";

export type SignatureBinding = {
  /** Base64URL ID kľúča (WebAuthn rawId alebo softvérového kľúča). */
  credentialId: string;
  /** SHA-256 clientDataJSON (WebAuthn) alebo podpisového kontextu (softvér). */
  clientDataHash: string;
  method: SignatureMethod;
};

/** Zdroj ned exportovateľného ECDSA kľúča pre softvérový fallback. */
export interface SoftKeyStore {
  getKey(): Promise<{ keyId: string; key: CryptoKey }>;
}

export type CreateSignatureBindingOptions = {
  /** Viazaný obsah (napr. SHA-256 dossiera) — stáva sa WebAuthn challenge. */
  challenge: string;
  userId: string;
  userName: string;
  /** Injektovateľné pre testy; default = IndexedDB store. */
  keyStore?: SoftKeyStore;
  /** Injektovateľné pre testy; default = navigator.credentials. */
  credentialsApi?: {
    create(options: {
      publicKey: PublicKeyCredentialCreationOptions;
    }): Promise<PublicKeyCredential | null>;
  };
  /** RP ID pre WebAuthn; default = NEXT_PUBLIC_RP_ID alebo hostname. */
  rpId?: string;
};

const KEY_STORE_NAME = "forenx-signature-key";
const KEY_ID_STORAGE_KEY = "forenx-signature-key-id";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  // Deterministická výzva: SHA-256 challenge textu (64 B → 32 B hex → bytes).
  const hex = sha256Hex(challenge);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function effectiveRpId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_RP_ID;
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.hostname;
  return "localhost";
}

async function webauthnBinding(
  options: CreateSignatureBindingOptions,
): Promise<SignatureBinding | null> {
  const credentialsApi =
    options.credentialsApi ??
    (typeof navigator !== "undefined" ? navigator.credentials : undefined);
  const hasPlatformSupport =
    typeof window !== "undefined" &&
    "PublicKeyCredential" in window &&
    typeof credentialsApi?.create === "function";
  if (!credentialsApi || !hasPlatformSupport) return null;

  const creation: PublicKeyCredentialCreationOptions = {
    challenge: challengeBytes(options.challenge),
    rp: { name: "PANDORA ForenX OS", id: options.rpId ?? effectiveRpId() },
    user: {
      id: new TextEncoder().encode(options.userId),
      name: options.userName,
      displayName: options.userName,
    },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
      residentKey: "preferred",
    },
    timeout: 60_000,
    attestation: "none",
  };

  const credential = (await credentialsApi.create({
    publicKey: creation,
  })) as PublicKeyCredential | null;
  if (!credential) return null;

  const clientData = new Uint8Array(
    (credential.response as AuthenticatorAttestationResponse).clientDataJSON,
  );
  const clientDataText = new TextDecoder().decode(clientData);
  return {
    credentialId: toBase64Url(new Uint8Array(credential.rawId)),
    clientDataHash: sha256Hex(clientDataText),
    method: "webauthn",
  };
}

async function softwareBinding(
  options: CreateSignatureBindingOptions,
): Promise<SignatureBinding | null> {
  const store = options.keyStore ?? createIdbKeyStore();
  const { keyId, key } = await store.getKey();
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;

  const signature = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(options.challenge),
  );
  const clientDataHash = sha256Hex(
    JSON.stringify({
      challenge: options.challenge,
      keyId,
      signature: toHex(signature),
      userId: options.userId,
    }),
  );
  return { credentialId: keyId, clientDataHash, method: "software" };
}

/**
 * Vytvorí väzbu podpisu: WebAuthn (passkey) alebo softvérový podpis.
 * Vracia null, ak nie je možné vytvoriť ani jednu (export bez väzby).
 */
export async function createSignatureBinding(
  options: CreateSignatureBindingOptions,
): Promise<SignatureBinding | null> {
  try {
    const binding = await webauthnBinding(options);
    if (binding) return binding;
  } catch {
    // WebAuthn zlyhal (zrušená výzva, bez podpory) — pokračujeme fallbackom.
  }
  try {
    return await softwareBinding(options);
  } catch {
    return null;
  }
}

/** IndexedDB-backed softvérový kľúč (ned exportovateľný ECDSA P-256). */
export function createIdbKeyStore(): SoftKeyStore {
  let cached: { keyId: string; key: CryptoKey } | null = null;

  const openDatabase = (): Promise<IDBDatabase | null> =>
    new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open(KEY_STORE_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
          db.createObjectStore(KEY_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });

  return {
    async getKey() {
      if (cached) return cached;
      const db = await openDatabase();
      if (!db) throw new Error("IndexedDB nie je dostupná.");

      const readExisting = (): Promise<{ keyId: string; key: CryptoKey } | null> =>
        new Promise((resolve) => {
          const tx = db.transaction(KEY_STORE_NAME, "readonly");
          const request = tx.objectStore(KEY_STORE_NAME).get(KEY_ID_STORAGE_KEY);
          request.onsuccess = () => {
            const value = request.result as
              | { keyId: string; key: CryptoKey }
              | undefined;
            resolve(value ?? null);
          };
          request.onerror = () => resolve(null);
        });

      const existing = await readExisting();
      if (existing) {
        cached = existing;
        return existing;
      }

      const subtle = globalThis.crypto?.subtle;
      if (!subtle) throw new Error("WebCrypto nie je dostupné.");
      const keyPair = (await subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false, // ned exportovateľný — kľúč opúšťa store len ako CryptoKey
        ["sign"],
      )) as CryptoKeyPair;
      const keyId = crypto.randomUUID();

      await new Promise<void>((resolve) => {
        const tx = db.transaction(KEY_STORE_NAME, "readwrite");
        tx.objectStore(KEY_STORE_NAME).put(
          { keyId, key: keyPair.privateKey },
          KEY_ID_STORAGE_KEY,
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      cached = { keyId, key: keyPair.privateKey };
      return cached;
    },
  };
}
