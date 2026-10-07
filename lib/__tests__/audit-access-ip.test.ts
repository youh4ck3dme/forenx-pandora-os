// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
const getUser = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getUser }, rpc }),
}));

const { POST } = await import("@/app/api/audit/access/route");

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "aaa.bbb.ccc";

function auditRequest(headers: Record<string, string>) {
  return new NextRequest("https://pandora.test/api/audit/access", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
    body: JSON.stringify({ caseId: CASE_ID, action: "view" }),
  });
}

describe("POST /api/audit/access source IP", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("records the proxy-appended hop, not a client-forged first x-forwarded-for value", async () => {
    const res = await POST(auditRequest({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("log_case_access", expect.objectContaining({ _source_ip: "203.0.113.7" }));
  });

  it("prefers x-real-ip set by the reverse proxy", async () => {
    await POST(auditRequest({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "198.51.100.4" }));
    expect(rpc).toHaveBeenCalledWith("log_case_access", expect.objectContaining({ _source_ip: "198.51.100.4" }));
  });

  it("logs an empty IP instead of a fabricated one when no valid address is present", async () => {
    await POST(auditRequest({ "x-forwarded-for": "not-an-ip" }));
    expect(rpc).toHaveBeenCalledWith("log_case_access", expect.objectContaining({ _source_ip: "" }));
  });
});
