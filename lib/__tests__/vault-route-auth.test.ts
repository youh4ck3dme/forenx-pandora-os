// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const STRANGER_ID = "22222222-2222-4222-8222-222222222222";
const CASE_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "header.payload.signature";

type RpcFn = (
  name: string,
  params?: Record<string, unknown>,
) => Promise<{ error: unknown } | null>;
type GetUserFn = (
  token: string,
) => Promise<{ data: { user: { id: string } | null }; error?: unknown }>;

let rpcSpy: ReturnType<typeof vi.fn<RpcFn>>;
let getUserMock: ReturnType<typeof vi.fn<GetUserFn>>;
let storedCase: { id: string; user_id: string } | null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (token: string) => getUserMock(token),
    },
    rpc: (name: string, params?: Record<string, unknown>) =>
      rpcSpy(name, params),
  })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: storedCase, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/storage/s3-vault", () => ({
  isS3Configured: () => true,
  getPresignedDossierUrl: vi.fn(async () => "https://s3.example.test/signed-url"),
  uploadCaseDocument: vi.fn(),
}));

import { GET } from "@/app/api/vault/route";

function prodRequest(url: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${url}`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
}

beforeEach(() => {
  rpcSpy = vi.fn().mockResolvedValue({ error: null });
  getUserMock = vi.fn().mockImplementation(async (token: string) =>
    token === TOKEN
      ? { data: { user: { id: OWNER_ID } }, error: null }
      : { data: { user: null }, error: { message: "invalid token" } },
  );
  storedCase = { id: CASE_ID, user_id: OWNER_ID };
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  vi.stubEnv("S3_ACCESS_KEY_ID", "test");
  vi.stubEnv("S3_SECRET_ACCESS_KEY", "test");
  vi.stubEnv("S3_BUCKET", "forenx-vault-sk");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/vault — povinná autentifikácia a serverový audit (Ú1)", () => {
  it("odmietne požiadavku bez tokenu v produkcii (401)", async () => {
    const res = await GET(prodRequest(`/api/vault?caseId=${CASE_ID}`));
    expect(res.status).toBe(401);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("odmietne cudzieho používateľa (403) bez auditu", async () => {
    getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: STRANGER_ID } },
      error: null,
    });
    const res = await GET(prodRequest(`/api/vault?caseId=${CASE_ID}`, TOKEN));
    expect(res.status).toBe(403);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("odmietne neexistujúci spis (404)", async () => {
    storedCase = null;
    const res = await GET(prodRequest(`/api/vault?caseId=${CASE_ID}`, TOKEN));
    expect(res.status).toBe(404);
  });

  it("odmietne ne-UUID caseId v produkcii (400)", async () => {
    const res = await GET(prodRequest("/api/vault?caseId=CASE-KS-2026-881", TOKEN));
    expect(res.status).toBe(400);
  });

  it("vlastník: zoznam dôkazov + auditný záznam 'view' s právnym základom", async () => {
    const res = await GET(prodRequest(`/api/vault?caseId=${CASE_ID}`, TOKEN));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.caseId).toBe(CASE_ID);
    expect(json.items).toEqual([]);

    expect(rpcSpy).toHaveBeenCalledWith(
      "log_case_access",
      expect.objectContaining({
        _case_id: CASE_ID,
        _action: "view",
      }),
    );
    const params = rpcSpy.mock.calls[0]?.[1] as Record<string, string>;
    expect(params._legal_basis).toContain("119");
    expect(params._legal_basis).toContain("GDPR");
  });

  it("presign na stiahnutie: audit 'view' fail-closed — bez zápisu sa URL nevydá", async () => {
    rpcSpy = vi.fn().mockResolvedValue({ error: { message: "ledger down" } });
    const storageKey = `cases/${CASE_ID}/evidence/${"a".repeat(64)}-zmluva.pdf`;
    const res = await GET(
      prodRequest(`/api/vault?storageKey=${encodeURIComponent(storageKey)}&action=presign`, TOKEN),
    );
    expect(res.status).toBe(500);
  });

  it("presign na stiahnutie: vlastník dostane URL po audite", async () => {
    const storageKey = `cases/${CASE_ID}/evidence/${"a".repeat(64)}-zmluva.pdf`;
    const res = await GET(
      prodRequest(`/api/vault?storageKey=${encodeURIComponent(storageKey)}&action=presign`, TOKEN),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.url).toContain("signed-url");
    expect(rpcSpy).toHaveBeenCalledWith(
      "log_case_access",
      expect.objectContaining({ _action: "view" }),
    );
  });

  it("presign s cudzím storage kľúčom je odmietnutý (403)", async () => {
    const storageKey = `cases/${CASE_ID}/evidence/${"a".repeat(64)}-zmluva.pdf`;
    getUserMock = vi.fn().mockResolvedValue({
      data: { user: { id: STRANGER_ID } },
      error: null,
    });
    const res = await GET(
      prodRequest(`/api/vault?storageKey=${encodeURIComponent(storageKey)}&action=presign`, TOKEN),
    );
    expect(res.status).toBe(403);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
