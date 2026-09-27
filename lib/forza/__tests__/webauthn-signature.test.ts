// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { sha256Hex } from "@/lib/forza/provenance/sha256";
import {
  createSignatureBinding,
  type SoftKeyStore,
} from "@/lib/forza/webauthn-signature";

function fakeWebauthnCredential(): PublicKeyCredential {
  const rawId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.create",
      challenge: "dGVzdA",
      origin: "https://pandora.whoiswho.at",
    }),
  );
  return {
    rawId,
    id: "fake-id",
    type: "public-key",
    response: { clientDataJSON, attestationObject: new ArrayBuffer(8) },
    getClientExtensionResults: () => ({}),
    authenticatorAttachment: "platform",
  } as unknown as PublicKeyCredential;
}

describe("createSignatureBinding — WebAuthn cesta (P0-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("použije navigator.credentials.create a vráti base64url ID + hash clientData", async () => {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    const create = vi.fn(
      async (_options: { publicKey: PublicKeyCredentialCreationOptions }) =>
        fakeWebauthnCredential(),
    );
    const binding = await createSignatureBinding({
      challenge: "dossier-sha",
      userId: "vysetrovatel-1",
      userName: "JUDr. Horký",
      credentialsApi: { create },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(binding?.method).toBe("webauthn");
    expect(binding?.credentialId).toBe("AQIDBAUGBwg"); // base64url(1..8)
    expect(binding?.clientDataHash).toBe(
      sha256Hex(new TextDecoder().decode(
        new Uint8Array(
          (fakeWebauthnCredential()
            .response as AuthenticatorAttestationResponse).clientDataJSON,
        ),
      )),
    );

    // Challenge = deterministický SHA-256 digest vstupu.
    const options = create.mock.calls[0]?.[0]?.publicKey;
    expect(options).toBeDefined();
    expect(new Uint8Array(options!.challenge as ArrayBuffer)).toEqual(
      Uint8Array.from(
        sha256Hex("dossier-sha").match(/../g)!.map((h) => Number.parseInt(h, 16)),
      ),
    );
    expect(options.rp.id).toBe(process.env.NEXT_PUBLIC_RP_ID ?? "localhost");
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe(
      "platform",
    );
  });
});

describe("createSignatureBinding — softvérový fallback (P0-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const inMemoryKeyStore = (): SoftKeyStore => {
    let privateKey: CryptoKey | null = null;
    return {
      async getKey() {
        if (privateKey) return { keyId: "soft-key-1", key: privateKey };
        const pair = (await globalThis.crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          false,
          ["sign"],
        )) as CryptoKeyPair;
        privateKey = pair.privateKey;
        return { keyId: "soft-key-1", key: privateKey };
      },
    };
  };

  it("WebAuthn zlyhá → podpis ned exportovateľným softvérovým kľúčom", async () => {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    const create = vi.fn(async () => {
      throw new Error("NotAllowedError: user cancelled");
    });
    const store = inMemoryKeyStore();

    const binding = await createSignatureBinding({
      challenge: "dossier-sha",
      userId: "vysetrovatel-1",
      userName: "JUDr. Horký",
      credentialsApi: { create },
      keyStore: store,
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(binding?.method).toBe("software");
    expect(binding?.credentialId).toBe("soft-key-1");
    expect(binding?.clientDataHash).toMatch(/^[a-f0-9]{64}$/);

    // Kľúč sa reuseuje — druhý podpis použije ten istý credentialId.
    const second = await createSignatureBinding({
      challenge: "dossier-sha-2",
      userId: "vysetrovatel-1",
      userName: "JUDr. Horký",
      credentialsApi: { create },
      keyStore: store,
    });
    expect(second?.credentialId).toBe("soft-key-1");
    expect(second?.clientDataHash).not.toBe(binding?.clientDataHash);
  });

  it("vráti null, keď zlyhá WebAuthn aj softvérový podpis", async () => {
    const failingStore: SoftKeyStore = {
      getKey: async () => {
        throw new Error("IndexedDB nie je dostupná.");
      },
    };
    const create = vi.fn(async () => {
      throw new Error("NotAllowedError");
    });

    const binding = await createSignatureBinding({
      challenge: "dossier-sha",
      userId: "u",
      userName: "n",
      credentialsApi: { create },
      keyStore: failingStore,
    });
    expect(binding).toBeNull();
  });

  it("bez WebAuthn podpory prejde rovno na softvérový podpis", async () => {
    const create = vi.fn();
    const binding = await createSignatureBinding({
      challenge: "dossier-sha",
      userId: "u",
      userName: "n",
      credentialsApi: { create },
      keyStore: inMemoryKeyStore(),
    });
    expect(create).not.toHaveBeenCalled();
    expect(binding?.method).toBe("software");
  });
});
