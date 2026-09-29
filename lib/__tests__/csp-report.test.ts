// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

let insertSpy: Mock<(...args: any[]) => any>;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: unknown) => insertSpy(table, row),
    }),
  },
}));

import { POST } from "@/app/api/csp-report/route";
import { resetCspReportRateLimiter } from "@/app/api/csp-report/limiter";

function cspRequest(body: unknown, ip = "203.0.113.7"): NextRequest {
  return new NextRequest("http://localhost:3000/api/csp-report", {
    method: "POST",
    headers: {
      "content-type": "application/csp-report",
      "x-forwarded-for": ip,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  insertSpy = vi.fn().mockResolvedValue({ error: null });
  resetCspReportRateLimiter();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("P0-09 — zdieľaný rate limit v produkcii", () => {
  it("bez service role sa limit nedá overiť → 503 a nič sa nezapíše", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    resetCspReportRateLimiter();
    const res = await POST(cspRequest({ "csp-report": { "violated-directive": "script-src" } }));
    expect(res.status).toBe(503);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("P0-05 — POST /api/csp-report (collector CSP violácií)", () => {
  it("prijme klasický csp-report a zapíše sanitizovaný záznam", async () => {
    const res = await POST(
      cspRequest({
        "csp-report": {
          "document-uri": "https://pandora.whoiswho.at/forza/asistent",
          "violated-directive": "script-src 'self' 'unsafe-inline'",
          "blocked-uri": "https://evil.example.com/rodne-cislo-800101/0006.js",
          disposition: "report",
        },
      }),
    );

    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [table, row] = insertSpy.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe("error_logs");
    expect(row.source).toBe("csp");
    expect(row.severity).toBe("warning");
    const message = String(row.message);
    expect(message).toContain("CSP report");
    expect(message).toContain("script-src");
    // blocked-uri sa sanitizuje — PII z URL nesmie prejsť.
    expect(message).toContain("[RODNÉ_ČÍSLO]");
    expect(message).not.toContain("800101");
  });

  it("prijme aj formu application/reports+json (body)", async () => {
    const res = await POST(
      cspRequest({
        body: {
          documentURL: "https://pandora.whoiswho.at/",
          effectiveDirective: "style-src-elem",
          blockedURL: "inline",
          disposition: "report",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const [, row] = insertSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(row.message)).toContain("style-src-elem");
  });

  it("odmietne neplatný JSON (400) a prázdne telo", async () => {
    const res = await POST(cspRequest("not-json{"));
    expect(res.status).toBe(400);
    const empty = await POST(
      new NextRequest("http://localhost:3000/api/csp-report", { method: "POST" }),
    );
    expect(empty.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("rate limit: 21. report z tej istej IP v minúte → 429", async () => {
    const body = {
      "csp-report": { "violated-directive": "img-src", disposition: "report" },
    };
    for (let i = 0; i < 20; i += 1) {
      const res = await POST(cspRequest(body));
      expect(res.status).toBe(204);
    }
    const res = await POST(cspRequest(body));
    expect(res.status).toBe(429);
  });

  it("iné IP majú nezávislý rate limit", async () => {
    const body = {
      "csp-report": { "violated-directive": "img-src", disposition: "report" },
    };
    for (let i = 0; i < 20; i += 1) {
      await POST(cspRequest(body, "198.51.100.1"));
    }
    const other = await POST(cspRequest(body, "198.51.100.2"));
    expect(other.status).toBe(204);
  });
});
