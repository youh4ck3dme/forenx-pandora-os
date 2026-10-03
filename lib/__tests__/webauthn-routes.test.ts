// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  encodeChallengePayload,
  decodeChallengePayload,
  CHALLENGE_COOKIE,
  CHALLENGE_TTL_SECONDS,
} from "@/lib/auth/webauthn.server";

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

  it("returns null for future issuedAt (clock skew attack)", () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ challenge: "x", issuedAt: future })).toString("base64url");
    expect(decodeChallengePayload(payload)).toBeNull();
  });
});

// ── Integration: GET /api/auth/webauthn/challenge ────────────────────────────

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: "mock-challenge-base64url",
    rpId: "localhost",
    timeout: 60000,
    userVerification: "required",
    allowCredentials: [],
  }),
  verifyAuthenticationResponse: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
    auth: {
      admin: {
        getUserById: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
        createSession: vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
      },
    },
  },
}));

describe("GET /api/auth/webauthn/challenge", () => {
  it("returns 200 with challenge and sets HttpOnly cookie", async () => {
    const { GET } = await import("@/app/api/auth/webauthn/challenge/route");
    const req = new NextRequest("http://localhost/api/auth/webauthn/challenge");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
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
    process.env = { ...originalEnv, NEXT_PUBLIC_RP_ID: "localhost" };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.resetModules();
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
    const body = await res.json() as Record<string, unknown>;
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
    const body = await res.json() as Record<string, unknown>;
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
  });
});
