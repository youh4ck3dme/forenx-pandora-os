// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * P0-08 (N-03): vývojársky obchvat autentifikácie nesmie platiť len preto, že
 * NODE_ENV nie je "production" (staging, preview, zle nastavené prostredie).
 */

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STRANGER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "header.payload.signature";

let tokenUser: string | null;
type RpcFn = (name: string, params?: Record<string, unknown>) => Promise<{ error: unknown }>;
let rpcSpy: ReturnType<typeof vi.fn<RpcFn>>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: async (token: string) =>
        token === TOKEN && tokenUser
          ? { data: { user: { id: tokenUser } }, error: null }
          : { data: { user: null }, error: { message: "invalid token" } },
    },
    rpc: (name: string, params?: Record<string, unknown>) => rpcSpy(name, params),
  })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: CASE_ID, user_id: OWNER_ID }, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/storage/s3-vault", () => ({
  isS3Configured: () => true,
  getPresignedDossierUrl: vi.fn(async () => "https://s3.example.test/signed-url"),
  getPresignedUploadUrl: vi.fn(async () => "https://s3.example.test/upload-url"),
  uploadCaseDocument: vi.fn(),
}));

import { authenticateVaultRequest, devAuthBypassAllowed } from "@/lib/storage/vault-auth";
import { GET } from "@/app/api/vault/route";
import { POST as PRESIGN } from "@/app/api/vault/presign/route";

function req(
  url = "http://localhost:3000/api/vault",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

beforeEach(() => {
  tokenUser = OWNER_ID;
  rpcSpy = vi.fn<RpcFn>().mockResolvedValue({ error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  for (const key of ["S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    vi.stubEnv(key, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devAuthBypassAllowed", () => {
  it("nikdy v produkcii, ani so zapnutým flagom a loopbackom", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    expect(devAuthBypassAllowed(req())).toBe(false);
  });

  it("v unit testoch (NODE_ENV=test) áno", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(devAuthBypassAllowed(req())).toBe(true);
  });

  it("development bez výslovného PANDORA_DEV_AUTH_BYPASS=1 nie (staging/preview)", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(devAuthBypassAllowed(req())).toBe(false);
  });

  it("development + flag + loopback áno", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    expect(devAuthBypassAllowed(req())).toBe(true);
    expect(devAuthBypassAllowed(req("http://127.0.0.1:3000/api/vault"))).toBe(true);
    expect(
      devAuthBypassAllowed(req("http://localhost:3000/api/vault", { "x-forwarded-for": "::1" })),
    ).toBe(true);
  });

  it("development + flag, ale vzdialený host alebo proxy z inej adresy nie", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    expect(devAuthBypassAllowed(req("http://100.70.1.16:3000/api/vault"))).toBe(false);
    expect(devAuthBypassAllowed(req("https://pandora.whoiswho.at/api/vault"))).toBe(false);
    expect(
      devAuthBypassAllowed(req("http://localhost:3000/api/vault", { "x-forwarded-for": "203.0.113.9" })),
    ).toBe(false);
    expect(
      devAuthBypassAllowed(
        req("http://localhost:3000/api/vault", { "x-forwarded-for": "203.0.113.9, 127.0.0.1" }),
      ),
    ).toBe(false);
    expect(
      devAuthBypassAllowed(req("http://localhost:3000/api/vault", { "x-forwarded-host": "evil.example" })),
    ).toBe(false);
  });

  it("development + flag + loopback, ale s prístupom k reálnym dôkazom nie (S3 alebo service rola)", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIA-test");
    expect(devAuthBypassAllowed(req())).toBe(false);
    vi.stubEnv("S3_ACCESS_KEY_ID", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    expect(devAuthBypassAllowed(req())).toBe(false);
  });

  it("development + flag na Verceli (preview) nie", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(devAuthBypassAllowed(req())).toBe(false);
  });
});

describe("authenticateVaultRequest", () => {
  it("vzdialený host + x-dev-user-id → 401 aj pri NODE_ENV=development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const auth = await authenticateVaultRequest(
      req("http://100.70.1.16:3000/api/vault", { "x-dev-user-id": STRANGER_ID }),
    );
    expect(auth.userId).toBeNull();
    if (auth.userId === null) expect(auth.status).toBe(401);
  });

  it("development bez flagu: x-dev-user-id ani na localhoste nestačí → 401", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const auth = await authenticateVaultRequest(req(undefined, { "x-dev-user-id": STRANGER_ID }));
    expect(auth.userId).toBeNull();
  });

  it("development bez flagu: neplatný token → 401 (žiadny pád do obchvatu)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const auth = await authenticateVaultRequest(req(undefined, { authorization: "Bearer a.b.c" }));
    expect(auth.userId).toBeNull();
  });

  it("lokálny obchvat (flag + loopback) → dev identita s devBypass: true", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    const auth = await authenticateVaultRequest(req());
    expect(auth).toMatchObject({ userId: "dev-investigator-001", devBypass: true });
  });

  it("v next dev obchvat ignoruje x-dev-user-id — identita je pevná", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    const auth = await authenticateVaultRequest(req(undefined, { "x-dev-user-id": STRANGER_ID }));
    expect(auth).toMatchObject({ userId: "dev-investigator-001", devBypass: true });
  });

  it("platný token → identita z tokenu s devBypass: false, aj v developmente", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PANDORA_DEV_AUTH_BYPASS", "1");
    const auth = await authenticateVaultRequest(req(undefined, { authorization: `Bearer ${TOKEN}` }));
    expect(auth).toMatchObject({ userId: OWNER_ID, devBypass: false });
  });
});

describe("GET /api/vault mimo produkcie so skutočným tokenom", () => {
  it("kontroluje vlastníctvo aj v developmente: cudzí používateľ → 403", async () => {
    vi.stubEnv("NODE_ENV", "development");
    tokenUser = STRANGER_ID;
    const res = await GET(
      req(`http://localhost:3000/api/vault?caseId=${CASE_ID}`, { authorization: `Bearer ${TOKEN}` }),
    );
    expect(res.status).toBe(403);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("presign na stiahnutie cudzieho dôkazu v developmente → 403", async () => {
    vi.stubEnv("NODE_ENV", "development");
    tokenUser = STRANGER_ID;
    const storageKey = `cases/${CASE_ID}/evidence/${"a".repeat(64)}-zmluva.pdf`;
    const res = await GET(
      req(
        `http://localhost:3000/api/vault?storageKey=${encodeURIComponent(storageKey)}&action=presign`,
        { authorization: `Bearer ${TOKEN}` },
      ),
    );
    expect(res.status).toBe(403);
  });

  it("vlastník v developmente: prístup s auditom 'view'", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await GET(
      req(`http://localhost:3000/api/vault?caseId=${CASE_ID}`, { authorization: `Bearer ${TOKEN}` }),
    );
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith("log_case_access", expect.objectContaining({ _action: "view" }));
  });
});

describe("POST /api/vault/presign mimo produkcie so skutočným tokenom", () => {
  function presignReq(): NextRequest {
    return new NextRequest("http://localhost:3000/api/vault/presign", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        caseId: CASE_ID,
        fileName: "zmluva.pdf",
        fileSizeBytes: 1024,
        mimeType: "application/pdf",
        sha256Hash: "a".repeat(64),
      }),
    });
  }

  it("bez service role sa vlastníctvo nepreskočí, ale odmietne (503)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const res = await PRESIGN(presignReq());
    expect(res.status).toBe(503);
  });

  it("cudzí používateľ → 403 aj v developmente", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
    tokenUser = STRANGER_ID;
    const res = await PRESIGN(presignReq());
    expect(res.status).toBe(403);
  });
});
