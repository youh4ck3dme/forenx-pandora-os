// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const callForenZXTool = vi.hoisted(() => vi.fn());
const startForenZXAnalysis = vi.hoisted(() => vi.fn());

vi.mock("@/lib/forza/forenzx-mcp.server", () => ({
  callForenZXTool: (...args: unknown[]) => callForenZXTool(...args),
  startForenZXAnalysis: (...args: unknown[]) => startForenZXAnalysis(...args),
}));

const USER = "00000000-0000-4000-8000-000000000001";
const EVIDENCE = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const HASH = "ab".repeat(32);
let authUser: string | null = USER;
let evidence: Record<string, unknown> | null = null;

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () =>
    authUser
      ? { userId: authUser, token: "token", devBypass: false }
      : { userId: null, token: null, error: "Unauthorized", status: 401 },
  ),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "evidence_items") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: evidence, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "forenzx_analysis_jobs") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              }),
            }),
          }),
          upsert: () => ({
            select: () => ({ single: async () => ({ data: { id: "job-1" }, error: null }) }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "case_audit_log") return { insert: async () => ({ error: null }) };
      return {};
    },
  },
}));

describe("ForenZX MCP tool proxy authorization", () => {
  beforeEach(() => {
    callForenZXTool.mockReset();
    startForenZXAnalysis.mockReset();
    startForenZXAnalysis.mockResolvedValue({ job_id: "hub-1", status: "queued", deduplicated: false });
    authUser = USER;
    evidence = {
      id: EVIDENCE,
      case_id: CASE_ID,
      investigator_id: USER,
      s3_object_key: `cases/${CASE_ID}/evidence/dump.bin`,
      sha256_hash: HASH,
      hash_verification_status: "verified",
      file_size: 10,
    };
  });

  it("rejects an authenticated caller invoking an arbitrary MCP tool", async () => {
    const { callTool } = await import("@/lib/forza/forenzx-mcp.functions");
    const handler = (callTool as unknown as { handler: (args: { data: unknown }) => Promise<unknown> }).handler;
    await expect(
      handler({
        data: {
          name: "forenzx_analysis_start",
          arguments: { download_url: "https://evil.example/loot", case_id: CASE_ID },
        },
      }),
    ).rejects.toThrow("Prístup majú iba serverové trasy ForenZX.");
    expect(callForenZXTool).not.toHaveBeenCalled();
  });

  it("still starts analysis for the evidence owner through the ledger route", async () => {
    const { POST } = await import("@/app/api/forenzx/start/route");
    const response = await POST(
      new NextRequest("http://localhost/api/forenzx/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceId: EVIDENCE, inputType: "ios_backup" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(startForenZXAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        evidenceId: EVIDENCE,
        s3Key: `cases/${CASE_ID}/evidence/dump.bin`,
        sha256: HASH,
      }),
    );
  });

  it("does not start analysis for a caller who does not own the evidence", async () => {
    evidence = null;
    const { POST } = await import("@/app/api/forenzx/start/route");
    const response = await POST(
      new NextRequest("http://localhost/api/forenzx/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evidenceId: EVIDENCE, inputType: "ios_backup" }),
      }),
    );
    expect(response.status).toBe(404);
    expect(startForenZXAnalysis).not.toHaveBeenCalled();
    expect(callForenZXTool).not.toHaveBeenCalled();
  });
});
