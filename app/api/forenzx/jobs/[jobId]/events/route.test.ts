import { describe, it, expect, vi, beforeEach } from "vitest";

const LOCAL_JOB_ID = "local-uuid-1234";
const HUB_JOB_ID = "hub-uuid-5678";

const mockMaybeSingle = vi.fn();
const mockEqUserId = vi.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqId = vi.fn(() => ({ eq: mockEqUserId }));
const mockSelect = vi.fn(() => ({ eq: mockEqId }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () => ({ userId: "user-1", error: null, status: 200 })),
}));

const fetchSpy = vi.fn();
vi.stubGlobal("fetch", fetchSpy);

// Import after mocks
const { GET } = await import("./route");

function makeRequest(jobId: string) {
  return new Request(`http://localhost/api/forenzx/jobs/${jobId}/events`) as unknown as import("next/server").NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FORENZX_MCP_URL = "https://hub.example.com";
  process.env.FORENZX_MCP_API_KEY = "test-key";
});

describe("GET /api/forenzx/jobs/[jobId]/events", () => {
  it("fetches upstream using hub_job_id, not the URL jobId", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { hub_job_id: HUB_JOB_ID }, error: null });
    fetchSpy.mockResolvedValue({
      ok: true,
      body: new ReadableStream(),
    });

    const params = Promise.resolve({ jobId: LOCAL_JOB_ID });
    await GET(makeRequest(LOCAL_JOB_ID), { params });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl: string = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain(HUB_JOB_ID);
    expect(calledUrl).not.toContain(LOCAL_JOB_ID);
  });

  it("returns 404 when hub_job_id is missing from the row", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { hub_job_id: null }, error: null });

    const params = Promise.resolve({ jobId: LOCAL_JOB_ID });
    const res = await GET(makeRequest(LOCAL_JOB_ID), { params });

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when job row is not found", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const params = Promise.resolve({ jobId: LOCAL_JOB_ID });
    const res = await GET(makeRequest(LOCAL_JOB_ID), { params });

    expect(res.status).toBe(404);
  });

  it("queries DB by local id, not hub_job_id", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { hub_job_id: HUB_JOB_ID }, error: null });
    fetchSpy.mockResolvedValue({ ok: true, body: new ReadableStream() });

    const params = Promise.resolve({ jobId: LOCAL_JOB_ID });
    await GET(makeRequest(LOCAL_JOB_ID), { params });

    // eq("id", LOCAL_JOB_ID) — first .eq call on the chain
    expect(mockEqId).toHaveBeenCalledWith("id", LOCAL_JOB_ID);
  });
});
