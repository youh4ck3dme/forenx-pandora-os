// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  encodeChallengePayload,
  decodeChallengePayload,
  CHALLENGE_COOKIE,
  REG_CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
} from "@/lib/auth/webauthn.server";
import { resetRateLimiterForTests } from "@/lib/security/rate-limiter.server";

// ── Unit: challenge payload encode/decode ────────────────────────────────────

describe("encodeChallengePayload / decodeChallengePayload", () => {
  it("round-trips a fresh challenge", () => {
    const challenge = "abc123def456";
    const encoded = encodeChallengePayload(challenge);
    const decoded = decodeChallengePayload(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.challenge).toBe(challenge);
  });

  it("returns null for an expired challenge", () => {
    const past = Math.floor(Date.now() / 1000) - CHALLENGE_TTL_SECONDS - 1;
    const payload = Buffer.from(JSON.stringify({ challenge: "x", issuedAt: past })).toString("base64url");
    expect(decodeChallengePayload(payload)).toBeNull();
  });

  it("returns null for malformed cookie", () => {
    expect(decodeChallengePayload("not-base64url!!!")).toBeNull();
    expect(decodeChallengePayload("")).toBeNull();
  });

  it("rejects an unsigned cookie minted by the client around an arbitrary challenge", () => {
    const now = Math.floor(Date.now() / 1000);
    const forged = Buffer.from(JSON.stringify({ challenge: "captured-challenge", issuedAt: now })).toString("base64url");
    expect(decodeChallengePayload(forged)).toBeNull();
  });

  it("rejects a signed cookie whose payload was swapped", () => {
    const [, mac] = encodeChallengePayload("issued-challenge").split(".");
    const now = Math.floor(Date.now() / 1000);
    const swapped = Buffer.from(JSON.stringify({ challenge: "captured-challenge", issuedAt: now })).toString("base64url");
    expect(decodeChallengePayload(`${swapped}.${mac}`)).toBeNull();
  });

  it("returns null for future issuedAt (clock skew attack)", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ challenge: "x", issuedAt: future })).toString("base64url");
    expect(decodeChallengePayload(payload)).toBeNull();
  });
});

// ── Integration mocks ────────────────────────────────────────────────────────

const mockVerifyAuthResponse = vi.fn();
const mockGenerateRegOptions = vi.fn();
const mockVerifyRegResponse = vi.fn();

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: "mock-challenge-base64url",
    rpId: "localhost",
    timeout: 60000,
    userVerification: "required",
    allowCredentials: [],
  }),
  verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthResponse(...args),
  generateRegistrationOptions: (...args: unknown[]) => mockGenerateRegOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegResponse(...args),
}));

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockGetUserById = vi.fn();
const mockCreateSession = vi.fn();
const mockGetUser = vi.fn();

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: (...args: unknown[]) => mockDbSelect(...args),
      insert: (...args: unknown[]) => mockDbInsert(...args),
      update: vi.fn(() => ({
        eq: (...args: unknown[]) => mockDbUpdate(...args),
      })),
    })),
    auth: {
      getUser: (...args: unknown[]) => mockGetUser(...args),
      admin: {
        getUserById: (...args: unknown[]) => mockGetUserById(...args),
        createSession: (...args: unknown[]) => mockCreateSession(...args),
      },
    },
  },
}));

// ── Integration: GET /api/auth/webauthn/challenge ────────────────────────────

describe("GET /api/auth/webauthn/challenge", () => {
  it("returns 200 with challenge and sets HttpOnly cookie", async () => {
    const { GET } = await import("@/app/api/auth/webauthn/challenge/route");
    const req = new NextRequest("http://localhost/api/auth/webauthn/challenge");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("challenge");
    expect(typeof body.challenge).toBe("string");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(CHALLENGE_COOKIE);
    expect(setCookie).toContain("HttpOnly");
  });
});

// ── Integration: POST /api/auth/webauthn/verify ──────────────────────────────

describe("POST /api/auth/webauthn/verify", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiterForTests();
    process.env = { ...originalEnv, NEXT_PUBLIC_RP_ID: "localhost" };
  });

  it("rejects a replayed assertion with a synced passkey (signCount stays 0)", async () => {
    const credential = {
      id: "cred-uuid-0",
      user_id: "user-uuid-0",
      credential_id: "cred-id-0",
      public_key_cbor: Buffer.from("fake-cose-key").toString("base64url"),
      sign_count: 0,
      counter: 0,
      transports: ["internal"],
    };
    mockDbSelect.mockResolvedValue({ data: credential, error: null });
    mockVerifyAuthResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 0 } });
    mockDbUpdate.mockResolvedValue({ error: null });
    mockGetUserById.mockResolvedValue({ data: { user: { id: "user-uuid-0", email: "a@forenx.org" } }, error: null });
    mockCreateSession.mockResolvedValue({
      data: { session: { access_token: "jwt", refresh_token: "r", expires_in: 3600 } },
      error: null,
    });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const cookie = encodeChallengePayload("captured-challenge");
    const send = () =>
      POST(
        new NextRequest("http://localhost/api/auth/webauthn/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: `${CHALLENGE_COOKIE}=${cookie}` },
          body: JSON.stringify({
            id: "cred-id-0",
            rawId: "cred-id-0",
            response: { clientDataJSON: "c", authenticatorData: "a", signature: "s" },
            type: "public-key",
          }),
        }),
      );

    expect((await send()).status).toBe(200);
    const replay = await send();
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as { error: string }).error).toMatch(/already used/i);
    expect(mockVerifyAuthResponse).toHaveBeenCalledTimes(1);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 when the shared single-use store is unavailable", async () => {
    process.env = {
      ...process.env,
      NODE_ENV: "production",
      WEBAUTHN_CHALLENGE_SECRET: "test-challenge-secret-0123456789abcdef",
      NEXT_PUBLIC_SUPABASE_URL: "",
      SUPABASE_URL: "",
    };
    resetRateLimiterForTests();
    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const cookie = encodeChallengePayload("store-down-challenge");
    const res = await POST(
      new NextRequest("http://localhost/api/auth/webauthn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `${CHALLENGE_COOKIE}=${cookie}` },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(503);
    expect(mockVerifyAuthResponse).not.toHaveBeenCalled();
  });

  it("rejects a forged unsigned challenge cookie", async () => {
    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const now = Math.floor(Date.now() / 1000);
    const forged = Buffer.from(JSON.stringify({ challenge: "captured", issuedAt: now })).toString("base64url");
    const res = await POST(
      new NextRequest("http://localhost/api/auth/webauthn/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `${CHALLENGE_COOKIE}=${forged}` },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(401);
    expect(mockVerifyAuthResponse).not.toHaveBeenCalled();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 when challenge cookie is missing", async () => {
    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "x", rawId: "x", response: {}, type: "public-key" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/challenge/i);
  });

  it("returns 401 when challenge cookie is expired", async () => {
    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const past = Math.floor(Date.now() / 1000) - CHALLENGE_TTL_SECONDS - 10;
    const expired = Buffer.from(JSON.stringify({ challenge: "abc", issuedAt: past })).toString("base64url");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${expired}`,
      },
      body: JSON.stringify({ id: "x", rawId: "x", response: {}, type: "public-key" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/expired/i);
  });

  it("returns 400 for invalid body schema", async () => {
    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({ badField: "value" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 when credential not found in DB", async () => {
    mockDbSelect.mockResolvedValueOnce({ data: null, error: null });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "unknown-cred-id",
        rawId: "unknown-cred-id",
        response: {
          clientDataJSON: "base64url-data",
          authenticatorData: "base64url-data",
          signature: "base64url-sig",
        },
        type: "public-key",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/credential/i);
  });

  it("returns 401 when signature verification fails", async () => {
    mockDbSelect.mockResolvedValueOnce({
      data: {
        id: "cred-uuid-1",
        user_id: "user-uuid-1",
        credential_id: "cred-id-1",
        public_key_cbor: Buffer.from("fake-key").toString("base64url"),
        sign_count: 5,
        counter: 5,
        transports: ["internal"],
      },
      error: null,
    });

    mockVerifyAuthResponse.mockResolvedValueOnce({
      verified: false,
    });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "cred-id-1",
        rawId: "cred-id-1",
        response: {
          clientDataJSON: "base64url-data",
          authenticatorData: "base64url-data",
          signature: "invalid-signature",
        },
        type: "public-key",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects cloned authenticator when counter does not advance", async () => {
    mockDbSelect.mockResolvedValueOnce({
      data: {
        id: "cred-uuid-1",
        user_id: "user-uuid-1",
        credential_id: "cred-id-1",
        public_key_cbor: Buffer.from("fake-key").toString("base64url"),
        sign_count: 10,
        counter: 10,
        transports: ["internal"],
      },
      error: null,
    });

    // Authenticator returns counter 10 (not > 10)
    mockVerifyAuthResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 10,
      },
    });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "cred-id-1",
        rawId: "cred-id-1",
        response: {
          clientDataJSON: "base64url-data",
          authenticatorData: "base64url-data",
          signature: "replay-signature",
        },
        type: "public-key",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toMatch(/cloned|counter/i);
  });

  it("successfully authenticates with valid signature, advances counter, sets session cookies and redirects to /dashboard", async () => {
    mockDbSelect.mockResolvedValueOnce({
      data: {
        id: "cred-uuid-1",
        user_id: "user-uuid-1",
        credential_id: "cred-id-1",
        public_key_cbor: Buffer.from("fake-cose-key").toString("base64url"),
        sign_count: 5,
        counter: 5,
        transports: ["internal"],
      },
      error: null,
    });

    mockVerifyAuthResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: {
        newCounter: 6,
      },
    });

    mockDbUpdate.mockResolvedValueOnce({ error: null });

    mockGetUserById.mockResolvedValueOnce({
      data: {
        user: {
          id: "user-uuid-1",
          email: "agent@forenx.org",
        },
      },
      error: null,
    });

    mockCreateSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "mock-access-jwt",
          refresh_token: "mock-refresh-jwt",
          expires_in: 3600,
        },
      },
      error: null,
    });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "cred-id-1",
        rawId: "cred-id-1",
        response: {
          clientDataJSON: "base64url-data",
          authenticatorData: "base64url-data",
          signature: "valid-sig",
        },
        type: "public-key",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.redirectUrl).toBe("/dashboard");

    // Cookies check: session issued, challenge cleared
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-access-token=mock-access-jwt");
    expect(setCookie).toContain("sb-refresh-token=mock-refresh-jwt");
  });

  it("handles custom redirect target safely and rejects open-redirect", async () => {
    mockDbSelect.mockResolvedValueOnce({
      data: {
        id: "cred-uuid-1",
        user_id: "user-uuid-1",
        credential_id: "cred-id-1",
        public_key_cbor: Buffer.from("fake-cose-key").toString("base64url"),
        sign_count: 1,
        counter: 1,
      },
      error: null,
    });

    mockVerifyAuthResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });

    mockDbUpdate.mockResolvedValueOnce({ error: null });
    mockGetUserById.mockResolvedValueOnce({
      data: { user: { id: "user-uuid-1", email: "agent@forenx.org" } },
      error: null,
    });
    mockCreateSession.mockResolvedValueOnce({
      data: {
        session: { access_token: "mock-access-jwt", refresh_token: "mock-refresh-jwt", expires_in: 3600 },
      },
      error: null,
    });

    const { POST } = await import("@/app/api/auth/webauthn/verify/route");
    const validCookie = encodeChallengePayload("fresh-challenge");

    // Request with malicious open redirect
    const req = new NextRequest("http://localhost/api/auth/webauthn/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "cred-id-1",
        rawId: "cred-id-1",
        response: {
          clientDataJSON: "data",
          authenticatorData: "data",
          signature: "sig",
        },
        type: "public-key",
        next: "https://attacker.evil.com/steal-creds",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Open redirect must be rejected and fall back safely to /dashboard
    expect(body.redirectUrl).toBe("/dashboard");
  });
});

// ── Integration: Passkey Registration Flow ──────────────────────────────────

describe("Passkey Registration Flow (/api/auth/webauthn/register/*)", () => {
  beforeEach(() => {
    resetRateLimiterForTests();
  });

  it("rejects unauthenticated user requesting registration options", async () => {
    const { GET } = await import("@/app/api/auth/webauthn/register/options/route");
    const req = new NextRequest("http://localhost/api/auth/webauthn/register/options");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("generates registration options and sets HttpOnly cookie for authenticated user", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "auth-user-uuid",
          email: "investigator@pandora.os",
        },
      },
      error: null,
    });

    mockGenerateRegOptions.mockResolvedValueOnce({
      challenge: "reg-challenge-token",
      rp: { name: "PANDORA / ForenX OS", id: "localhost" },
      user: { id: "auth-user-uuid", name: "investigator@pandora.os", displayName: "investigator@pandora.os" },
      pubKeyCredParams: [],
      timeout: 60000,
    });

    const { GET } = await import("@/app/api/auth/webauthn/register/options/route");
    const req = new NextRequest("http://localhost/api/auth/webauthn/register/options", {
      headers: {
        Authorization: "Bearer valid.user.token",
      },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.challenge).toBe("reg-challenge-token");

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(REG_CHALLENGE_COOKIE);
    expect(setCookie).toContain("HttpOnly");
  });

  it("verifies registration response and persists credential to database", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "auth-user-uuid",
          email: "investigator@pandora.os",
        },
      },
      error: null,
    });

    mockVerifyRegResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "new-cred-base64",
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
        aaguid: "00000000-0000-0000-0000-000000000000",
      },
    });

    mockDbInsert.mockResolvedValueOnce({ error: null });

    const validCookie = encodeChallengePayload("reg-challenge-token");
    const { POST } = await import("@/app/api/auth/webauthn/register/verify/route");

    const req = new NextRequest("http://localhost/api/auth/webauthn/register/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer valid.user.token",
        Cookie: `${REG_CHALLENGE_COOKIE}=${validCookie}`,
      },
      body: JSON.stringify({
        id: "new-cred-base64",
        rawId: "new-cred-base64",
        response: {
          clientDataJSON: "data",
          attestationObject: "attestation",
        },
        type: "public-key",
        friendlyName: "MacBook TouchID",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.credentialId).toBe("new-cred-base64");
  });
});
