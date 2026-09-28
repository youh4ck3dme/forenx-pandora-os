// @vitest-environment node
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import type { LedgerRow } from "@/lib/storage/evidence-ledger";
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
let caseLookupError: unknown;
let ledgerOn: boolean;
type InsertFn = (row: Record<string, unknown>) => Promise<LedgerRow>;
let ledgerInsert: ReturnType<typeof vi.fn<InsertFn>>;

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
          maybeSingle: async () =>
            caseLookupError ? { data: null, error: caseLookupError } : { data: storedCase, error: null },
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

// Ledger: skutočné registerEvidence, len DB závislosti sú podvrhnuté.
vi.mock("@/lib/storage/evidence-ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/evidence-ledger")>();
  return {
    ...actual,
    ledgerConfigured: () => ledgerOn,
    listLedgerEvidence: vi.fn(async () => []),
    supabaseLedgerDeps: vi.fn(async () => ({
      caseOf: async () => ({ ok: true as const, userId: OWNER_ID, name: "Prípad Armivex" }),
      findByKey: async () => null,
      insert: (row: Record<string, unknown>) => ledgerInsert(row),
    })),
  };
});

import { GET, POST } from "@/app/api/vault/route";
import { uploadCaseDocument } from "@/lib/storage/s3-vault";
import { evidenceStorageKey } from "@/lib/storage/evidence-ledger";

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
  caseLookupError = null;
  ledgerOn = true;
  ledgerInsert = vi.fn<InsertFn>(async (row) => ({
    id: "44444444-4444-4444-8444-444444444444",
    case_name: String(row.case_name),
    file_name: String(row.file_name),
    file_size: Number(row.file_size),
    mime_type: String(row.mime_type),
    s3_object_key: String(row.s3_object_key),
    sha256_hash: String(row.sha256_hash),
    hash_verification_status: "pending" as const,
    created_at: "2026-09-28T10:00:00.000Z",
  }));
  vi.mocked(uploadCaseDocument).mockReset();
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

describe("POST /api/vault — autentifikácia, vlastníctvo, audit a ledger (P0-07 / N-01)", () => {
  const CONTENT = "obsah dôkazu";
  const SHA = createHash("sha256").update(CONTENT).digest("hex");
  const FILE_NAME = "zmluva.pdf";

  function uploadRequest(opts: { token?: string; caseId?: string; sha?: string } = {}): NextRequest {
    const form = new FormData();
    form.append("file", new File([CONTENT], FILE_NAME, { type: "application/pdf" }));
    form.append("caseId", opts.caseId ?? CASE_ID);
    form.append("clientSha256", opts.sha ?? SHA);
    return new NextRequest("http://localhost:3000/api/vault", {
      method: "POST",
      body: form,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : undefined,
    });
  }

  beforeEach(() => {
    vi.mocked(uploadCaseDocument).mockImplementation(async (caseId, file) =>
      evidenceStorageKey(caseId, file.sha256, file.name),
    );
  });

  function expectNothingStored() {
    expect(uploadCaseDocument).not.toHaveBeenCalled();
    expect(ledgerInsert).not.toHaveBeenCalled();
  }

  it("bez tokenu v produkcii → 401, nič sa neuloží ani nezaznamená", async () => {
    const res = await POST(uploadRequest());
    expect(res.status).toBe(401);
    expectNothingStored();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("neplatný token → 401", async () => {
    const res = await POST(uploadRequest({ token: "a.b.c" }));
    expect(res.status).toBe(401);
    expectNothingStored();
  });

  it("cudzí spis → 403 bez uploadu a bez auditu", async () => {
    getUserMock = vi.fn().mockResolvedValue({ data: { user: { id: STRANGER_ID } }, error: null });
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(403);
    expectNothingStored();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it("neexistujúci spis → 404", async () => {
    storedCase = null;
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(404);
    expectNothingStored();
  });

  it("nedostupné overenie vlastníctva → 503 (nie 200)", async () => {
    caseLookupError = { message: "db down" };
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(503);
    expectNothingStored();
  });

  it("ne-UUID caseId v produkcii → 400", async () => {
    const res = await POST(uploadRequest({ token: TOKEN, caseId: "CASE-KS-2026-881" }));
    expect(res.status).toBe(400);
    expectNothingStored();
  });

  it("audit fail-closed: bez zápisu 'upload' sa súbor nenahrá (500)", async () => {
    rpcSpy = vi.fn().mockResolvedValue({ error: { message: "audit down" } });
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(500);
    expectNothingStored();
  });

  it("produkcia bez ledgera → 503, dôkaz nesmie skončiť v S3 bez evidencie", async () => {
    ledgerOn = false;
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(503);
    expectNothingStored();
  });

  it("vlastník: audit 'upload', S3 pod kľúčom ledgera, zápis do ledgera s reálnou identitou", async () => {
    const res = await POST(uploadRequest({ token: TOKEN }));
    expect(res.status).toBe(201);
    const json = await res.json();

    expect(rpcSpy).toHaveBeenCalledWith(
      "log_case_access",
      expect.objectContaining({ _case_id: CASE_ID, _action: "upload" }),
    );
    expect(uploadCaseDocument).toHaveBeenCalledWith(
      CASE_ID,
      expect.objectContaining({ name: FILE_NAME, sha256: SHA }),
      { folder: "evidence" },
    );
    const expectedKey = evidenceStorageKey(CASE_ID, SHA, FILE_NAME);
    expect(ledgerInsert).toHaveBeenCalledWith(
      expect.objectContaining({ investigator_id: OWNER_ID, s3_object_key: expectedKey, sha256_hash: SHA }),
    );
    expect(json.persisted).toBe(true);
    expect(json.item.uploadedBy).toBe(OWNER_ID);
    expect(json.item.s3StorageKey).toBe(expectedKey);
    // Stav „verified“ nastaví až worker /api/vault/verify.
    expect(json.item.integrityStatus).toBe("checking");
    expect(JSON.stringify(json)).not.toContain("investigator-session-user");
  });

  it("nesúlad klientskeho a serverového SHA-256 → 400 bez uploadu", async () => {
    const res = await POST(uploadRequest({ token: TOKEN, sha: "b".repeat(64) }));
    expect(res.status).toBe(400);
    expectNothingStored();
  });
});
