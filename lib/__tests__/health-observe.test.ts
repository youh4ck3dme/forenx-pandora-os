// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "header.payload.signature";

let insertSpy: Mock<(...args: any[]) => any>;
let rpcSpy: Mock<(...args: any[]) => any>;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: async (token: string) =>
        token === TOKEN
          ? { data: { user: { id: OWNER_ID } }, error: null }
          : { data: { user: null }, error: { message: "invalid" } },
    },
    rpc: (...args: unknown[]) => rpcSpy(...args),
    from: (table: string) => ({
      insert: (row: unknown) => insertSpy(table, row),
    }),
  })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: unknown) => insertSpy(table, row),
    }),
  },
}));

import { GET, POST } from "@/app/api/health/observe/route";
import { resetReportRateLimiter } from "@/app/api/health/observe/limiter";

function request(
  url: string,
  init?: { method?: string; body?: string; token?: string },
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  return new NextRequest(`http://localhost:3000${url}`, {
    method: init?.method ?? "GET",
    headers,
    body: init?.body,
  });
}

beforeEach(() => {
  resetReportRateLimiter();
  insertSpy = vi.fn().mockResolvedValue({ error: null });
  rpcSpy = vi.fn().mockResolvedValue({
    data: { window_hours: 24, alerts: { ai_timeouts_over_60s: false } },
    error: null,
  });
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("P0-04 — /api/health/observe", () => {
  it("POST bez tokenu v produkcii → 401", async () => {
    const res = await POST(request("/api/health/observe", {
      method: "POST",
      body: JSON.stringify({ message: "Chyba" }),
    }));
    expect(res.status).toBe(401);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("POST sanitizuje PII a API kľúče pred zápisom do error_logs", async () => {
    const res = await POST(request("/api/health/observe", {
      method: "POST",
      token: TOKEN,
      body: JSON.stringify({
        message:
          "Pád analýzy: rodné číslo 800101/0006, kľúč sk-mistral-AbCdEf123456",
        stack: "Error: foo\n    at bar (Bearer eyJhbGciOi.abc.def)",
        route: "/forza/asistent",
        severity: "error",
      }),
    }));

    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("error_logs");
    expect(row.source).toBe("client");
    expect(row.user_id).toBe(OWNER_ID);
    const message = String(row.message);
    expect(message).toContain("[RODNÉ_ČÍSLO]");
    expect(message).toContain("[REDACTED_API_KEY]");
    expect(message).not.toContain("800101");
    const stack = String(row.stack);
    expect(stack).toContain("Bearer [REDACTED]");
    expect(stack).not.toContain("eyJhbGciOi");
  });

  it("POST rate limit: 11. hlásenie v minúte → 429", async () => {
    for (let i = 0; i < 10; i += 1) {
      const res = await POST(request("/api/health/observe", {
        method: "POST",
        token: TOKEN,
        body: JSON.stringify({ message: `Chyba ${i}` }),
      }));
      expect(res.status).toBe(204);
    }
    const res = await POST(request("/api/health/observe", {
      method: "POST",
      token: TOKEN,
      body: JSON.stringify({ message: "Chyba 11" }),
    }));
    expect(res.status).toBe(429);
  });

  it("GET vracia metriky administrátorovi", async () => {
    const res = await GET(request("/api/health/observe", { token: TOKEN }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.metrics).toHaveProperty("alerts");
    expect(rpcSpy).toHaveBeenCalledWith("health_metrics");
  });

  it("GET pre ne-admina (RPC odmietne) → 403", async () => {
    rpcSpy = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Prístup majú iba administrátori." },
    });
    const res = await GET(request("/api/health/observe", { token: TOKEN }));
    expect(res.status).toBe(403);
  });
});
