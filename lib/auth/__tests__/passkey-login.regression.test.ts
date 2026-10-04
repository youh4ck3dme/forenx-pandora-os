/**
 * Regression tests: Passkey / WebAuthn login flow
 *
 * Covers both the client-side helper (webauthn.client.ts) and
 * the server-side pure functions (webauthn.server.ts):
 *   - isPasskeySupported()
 *   - loginWithPasskey() – all branches (challenge fail, user cancel, not-found, success)
 *   - registerPasskey() – all branches
 *   - getRpId() / getExpectedOrigins()
 *   - encodeChallengePayload() / decodeChallengePayload() – TTL, malformed, happy-path
 *   - verifyPasskeyResponse() – credential not found, replay attack, success
 *
 * NOTE: No Supabase / DB calls are made – all external deps are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// @simplewebauthn/browser  – stub browser-side calls
vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

// @simplewebauthn/server   – stub crypto verification
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

// Supabase admin client
const mockSupabaseSelect = vi.fn();
const mockSupabaseUpdate = vi.fn();
const mockSupabaseInsert = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockSupabaseSelect,
          order: () => ({ data: [] }),
        }),
        order: () => ({ data: [] }),
      }),
      update: () => ({ eq: mockSupabaseUpdate }),
      insert: mockSupabaseInsert,
    }),
  },
}));

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";

import {
  isPasskeySupported,
  loginWithPasskey,
  registerPasskey,
} from "../webauthn.client";

import {
  getRpId,
  getExpectedOrigins,
  encodeChallengePayload,
  decodeChallengePayload,
  verifyPasskeyResponse,
  CHALLENGE_TTL_SECONDS,
} from "../webauthn.server";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeHeaders(obj: Record<string, string>) {
  const h = new Headers();
  for (const [k, v] of Object.entries(obj)) h.set(k, v);
  return h;
}

function mockFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = responses[call++] ?? responses[responses.length - 1];
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 400),
        json: async () => r.body,
      };
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. isPasskeySupported()
// ─────────────────────────────────────────────────────────────────────────────

describe("isPasskeySupported()", () => {
  it("returns false when window is undefined (SSR context)", () => {
    const origWindow = global.window;
    // @ts-expect-error – intentionally delete window
    delete global.window;
    expect(isPasskeySupported()).toBe(false);
    global.window = origWindow;
  });

  it("returns false when PublicKeyCredential is missing", () => {
    vi.stubGlobal("window", { navigator: { credentials: {} } });
    expect(isPasskeySupported()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("returns true when all WebAuthn APIs are present", () => {
    vi.stubGlobal("window", {
      PublicKeyCredential: class {},
      navigator: { credentials: { get: vi.fn() } },
    });
    expect(isPasskeySupported()).toBe(true);
    vi.unstubAllGlobals();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. loginWithPasskey() – client-side flow
// ─────────────────────────────────────────────────────────────────────────────

describe("loginWithPasskey()", () => {
  beforeEach(() => {
    // Ensure WebAuthn APIs appear supported
    vi.stubGlobal("window", {
      PublicKeyCredential: class {},
      navigator: { credentials: { get: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns ok:false when browser does not support WebAuthn", async () => {
    vi.stubGlobal("window", { navigator: {} }); // no PublicKeyCredential
    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/nepodporuje/i);
  });

  it("returns ok:false when /api/auth/webauthn/challenge/ returns non-ok", async () => {
    mockFetch([{ ok: false, status: 503, body: {} }]);
    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/výzvu/i);
  });

  it("returns ok:false on network error fetching challenge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("Network down");
  });

  it("returns ok:false when user cancels the authenticator (NotAllowedError)", async () => {
    mockFetch([{ ok: true, body: { challenge: "abc", timeout: 60000 } }]);
    const err = new Error("User cancelled");
    err.name = "NotAllowedError";
    vi.mocked(startAuthentication).mockRejectedValueOnce(err);

    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/zrušené|zrušená/i);
  });

  it("returns ok:false on InvalidStateError from authenticator", async () => {
    mockFetch([{ ok: true, body: { challenge: "abc" } }]);
    const err = new Error("Invalid state");
    err.name = "InvalidStateError";
    vi.mocked(startAuthentication).mockRejectedValueOnce(err);

    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/platný|doménu/i);
  });

  it("maps 'Credential not found.' server error to a friendly Slovak message", async () => {
    mockFetch([
      { ok: true, body: { challenge: "abc" } },
      { ok: false, status: 401, body: { error: "Credential not found." } },
    ]);
    vi.mocked(startAuthentication).mockResolvedValueOnce({ id: "cred-id" } as never);

    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(
      /nie je priradený k žiadnemu účtu/i,
    );
  });

  it("returns ok:false with raw server error message for other verify failures", async () => {
    mockFetch([
      { ok: true, body: { challenge: "abc" } },
      { ok: false, status: 401, body: { error: "Signature mismatch." } },
    ]);
    vi.mocked(startAuthentication).mockResolvedValueOnce({ id: "cred-id" } as never);

    const result = await loginWithPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("Signature mismatch.");
  });

  it("returns ok:true with redirectUrl on successful login", async () => {
    mockFetch([
      { ok: true, body: { challenge: "abc" } },
      { ok: true, body: { ok: true, redirectUrl: "/forza/prehlad/" } },
    ]);
    vi.mocked(startAuthentication).mockResolvedValueOnce({ id: "cred-id" } as never);

    const result = await loginWithPasskey("/forza/prehlad/");
    expect(result.ok).toBe(true);
    expect((result as { ok: true; redirectUrl: string }).redirectUrl).toBe("/forza/prehlad/");
  });

  it("falls back to /dashboard when server response has no redirectUrl", async () => {
    mockFetch([
      { ok: true, body: { challenge: "abc" } },
      { ok: true, body: { success: true } },
    ]);
    vi.mocked(startAuthentication).mockResolvedValueOnce({ id: "cred-id" } as never);

    const result = await loginWithPasskey();
    expect(result.ok).toBe(true);
    expect((result as { ok: true; redirectUrl: string }).redirectUrl).toBe("/dashboard");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. registerPasskey() – client-side flow
// ─────────────────────────────────────────────────────────────────────────────

describe("registerPasskey()", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      PublicKeyCredential: class {},
      navigator: { credentials: { get: vi.fn() } },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns ok:false when /register/options/ fails", async () => {
    mockFetch([{ ok: false, status: 401, body: { error: "Not authenticated" } }]);
    const result = await registerPasskey("My Key");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("Not authenticated");
  });

  it("returns ok:false when user cancels registration (NotAllowedError)", async () => {
    mockFetch([{ ok: true, body: { challenge: "abc" } }]);
    const err = new Error("Cancelled");
    err.name = "NotAllowedError";
    vi.mocked(startRegistration).mockRejectedValueOnce(err);

    const result = await registerPasskey();
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/zrušen/i);
  });

  it("returns ok:true with credentialId on success", async () => {
    mockFetch([
      { ok: true, body: { challenge: "abc" } },
      { ok: true, body: { credentialId: "new-cred-xyz" } },
    ]);
    vi.mocked(startRegistration).mockResolvedValueOnce({ id: "new-cred-xyz" } as never);

    const result = await registerPasskey("Security Key");
    expect(result.ok).toBe(true);
    expect((result as { ok: true; credentialId: string }).credentialId).toBe("new-cred-xyz");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. getRpId() & getExpectedOrigins() – server-side
// ─────────────────────────────────────────────────────────────────────────────

describe("getRpId()", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_RP_ID;
    delete process.env.RP_ID;
  });

  it("prefers NEXT_PUBLIC_RP_ID env over everything else", () => {
    process.env.NEXT_PUBLIC_RP_ID = "forensic.example.com";
    expect(getRpId()).toBe("forensic.example.com");
  });

  it("falls back to RP_ID env", () => {
    process.env.RP_ID = "alt.example.com";
    expect(getRpId()).toBe("alt.example.com");
  });

  it("derives rpId from x-forwarded-host header", () => {
    const req = { headers: makeHeaders({ "x-forwarded-host": "staging.pandora.at" }) };
    expect(getRpId(req)).toBe("staging.pandora.at");
  });

  it("strips port from host header", () => {
    const req = { headers: makeHeaders({ host: "localhost:3000" }) };
    expect(getRpId(req)).toBe("localhost");
  });

  it("returns 'localhost' as the final fallback", () => {
    expect(getRpId()).toBe("localhost");
  });
});

describe("getExpectedOrigins()", () => {
  it("always includes localhost:3000", () => {
    const origins = getExpectedOrigins();
    expect(origins).toContain("http://localhost:3000");
  });

  it("includes NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://custom.pandora.org";
    const origins = getExpectedOrigins();
    expect(origins).toContain("https://custom.pandora.org");
    delete process.env.NEXT_PUBLIC_APP_URL;
  });

  it("includes https://rpId when rpId is a real domain", () => {
    process.env.NEXT_PUBLIC_RP_ID = "pandora.whoiswho.at";
    const origins = getExpectedOrigins();
    expect(origins).toContain("https://pandora.whoiswho.at");
    delete process.env.NEXT_PUBLIC_RP_ID;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. encodeChallengePayload() / decodeChallengePayload()
// ─────────────────────────────────────────────────────────────────────────────

describe("Challenge payload codec", () => {
  it("round-trips a challenge string correctly", () => {
    const encoded = encodeChallengePayload("my-challenge-string");
    const decoded = decodeChallengePayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.challenge).toBe("my-challenge-string");
    expect(decoded!.issuedAt).toBeGreaterThan(0);
  });

  it("returns null for malformed / non-base64url input", () => {
    expect(decodeChallengePayload("!!!invalid!!!")).toBeNull();
  });

  it("returns null for valid JSON that is missing required fields", () => {
    const bad = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    expect(decodeChallengePayload(bad)).toBeNull();
  });

  it("returns null for a challenge older than TTL", () => {
    const expired = Buffer.from(
      JSON.stringify({
        challenge: "old-challenge",
        issuedAt: Math.floor(Date.now() / 1000) - (CHALLENGE_TTL_SECONDS + 10),
      }),
    ).toString("base64url");
    expect(decodeChallengePayload(expired)).toBeNull();
  });

  it("returns null for a challenge with a future issuedAt (clock skew attack)", () => {
    const future = Buffer.from(
      JSON.stringify({
        challenge: "future-challenge",
        issuedAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url");
    expect(decodeChallengePayload(future)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. verifyPasskeyResponse() – server-side security invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyPasskeyResponse()", () => {
  const fakeResponse = {
    id: "cred-abc",
    rawId: "cred-abc",
    response: {
      authenticatorData: "auth-data",
      clientDataJSON: "client-data",
      signature: "sig",
    },
    type: "public-key" as const,
    clientExtensionResults: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok:false when credential is not found in DB (fail-closed)", async () => {
    mockSupabaseSelect.mockResolvedValueOnce({ data: null, error: null });

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("Credential not found.");
  });

  it("returns ok:false when @simplewebauthn/server throws (e.g. bad origin)", async () => {
    mockSupabaseSelect.mockResolvedValueOnce({
      data: {
        id: "row-1",
        user_id: "user-1",
        credential_id: "cred-abc",
        public_key_cbor: Buffer.from("fake-public-key").toString("base64url"),
        sign_count: 5,
        transports: ["internal"],
      },
      error: null,
    });
    vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(
      new Error("Unexpected origin"),
    );

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toBe("Unexpected origin");
  });

  it("returns ok:false when verified=false (signature mismatch)", async () => {
    mockSupabaseSelect.mockResolvedValueOnce({
      data: {
        id: "row-1",
        user_id: "user-1",
        credential_id: "cred-abc",
        public_key_cbor: Buffer.from("fake-public-key").toString("base64url"),
        sign_count: 0,
        transports: [],
      },
      error: null,
    });
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 0 },
    } as never);

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/signature/i);
  });

  it("rejects a cloned authenticator when sign_count does not advance (SECURITY INVARIANT)", async () => {
    mockSupabaseSelect.mockResolvedValueOnce({
      data: {
        id: "row-1",
        user_id: "user-1",
        credential_id: "cred-abc",
        public_key_cbor: Buffer.from("fake-public-key").toString("base64url"),
        sign_count: 10, // stored counter = 10
        transports: [],
      },
      error: null,
    });
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 10 }, // same as stored -> replay!
    } as never);

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/cloned/i);
  });

  it("returns ok:true with userId and newSignCount on a valid verification", async () => {
    mockSupabaseSelect.mockResolvedValueOnce({
      data: {
        id: "row-1",
        user_id: "user-uuid-777",
        credential_id: "cred-abc",
        public_key_cbor: Buffer.from("fake-public-key").toString("base64url"),
        sign_count: 5,
        transports: ["internal"],
      },
      error: null,
    });
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as never);
    mockSupabaseUpdate.mockResolvedValueOnce({});

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(true);
    const ok = result as { ok: true; userId: string; newSignCount: number };
    expect(ok.userId).toBe("user-uuid-777");
    expect(ok.newSignCount).toBe(6);
  });

  it("allows counter=0 without triggering replay protection (stateless authenticators)", async () => {
    // sign_count=0 means the authenticator does not increment counters - skip replay check
    mockSupabaseSelect.mockResolvedValueOnce({
      data: {
        id: "row-2",
        user_id: "user-uuid-888",
        credential_id: "cred-abc",
        public_key_cbor: Buffer.from("pk").toString("base64url"),
        sign_count: 0,
        transports: [],
      },
      error: null,
    });
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    } as never);
    mockSupabaseUpdate.mockResolvedValueOnce({});

    const result = await verifyPasskeyResponse(fakeResponse, "challenge-xyz");
    expect(result.ok).toBe(true);
  });
});
