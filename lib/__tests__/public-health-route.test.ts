// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  listBuckets: vi.fn(),
  mistralConfigured: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: mocks.rpc })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    storage: { listBuckets: mocks.listBuckets },
  },
}));

vi.mock("@/lib/forza/ai/llm.server", () => ({
  mistralConfigured: mocks.mistralConfigured,
}));

import { GET } from "@/app/api/health/public/route";
import { resetPublicHealthCacheForTests } from "@/lib/forza/public-health-cache.server";
import { resetRateLimiterForTests } from "@/lib/security/rate-limiter.server";

const SNAPSHOT = {
  case_count: 4,
  latency_ms: 56,
  total_connections: 17,
  max_connections: 60,
  idle_in_transaction: 0,
  waiting_connections: 0,
  database_size_bytes: 14_200_000,
  postgres_version: "17.6",
  ai_total: 43,
  ai_failures: 6,
  error_count: 0,
};

function request(ip = "203.0.113.10"): NextRequest {
  return new NextRequest("http://localhost:3000/api/health/public", {
    headers: { "x-real-ip": ip },
  });
}

describe("public health endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    resetPublicHealthCacheForTests();
    resetRateLimiterForTests();
    mocks.rpc.mockReset().mockResolvedValue({ data: SNAPSHOT, error: null });
    mocks.listBuckets.mockReset().mockResolvedValue({ data: [{ id: "private" }], error: null });
    mocks.mistralConfigured.mockReset().mockReturnValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("works anonymously and exposes only the typed aggregate contract", async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.overallStatus).toBe("attention");
    expect(JSON.stringify(body)).not.toMatch(/secret|api[_-]?key|token|stack|prompt|user[_-]?id/i);
  });

  it("serves repeated requests from the 15 second server cache", async () => {
    const first = await GET(request("203.0.113.11"));
    const second = await GET(request("203.0.113.11"));
    expect(first.headers.get("x-health-cache")).toBe("MISS");
    expect(second.headers.get("x-health-cache")).toBe("HIT");
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.listBuckets).toHaveBeenCalledTimes(1);
  });

  it("uses the shared limiter and does not mutate health data", async () => {
    const responses = await Promise.all(
      Array.from({ length: 61 }, () => GET(request("203.0.113.12"))),
    );
    expect(responses.at(-1)?.status).toBe(429);
    expect(mocks.listBuckets).not.toHaveBeenCalledWith(expect.objectContaining({ delete: expect.anything() }));
  });

  it("reports unavailable on failed measurements without false healthy status or raw errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "secret stack trace" } });
    mocks.listBuckets.mockResolvedValue({ data: null, error: { message: "storage secret" } });
    const response = await GET(request("203.0.113.13"));
    const body = await response.json();
    expect(body.overallStatus).toBe("unavailable");
    expect(JSON.stringify(body)).not.toMatch(/secret|stack trace/i);
  });
});
