// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const USER_A = "00000000-0000-4000-8000-000000000001";
const CASE_B = "22222222-2222-4222-8222-222222222222";
const filterCalls: Array<[string, string]> = [];

vi.mock("@/lib/storage/vault-auth", () => ({
  authenticateVaultRequest: vi.fn(async () => ({ userId: USER_A, status: 200, error: null })),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((column: string, value: string) => {
          filterCalls.push([column, value]);
          return {
            eq: vi.fn((nextColumn: string, nextValue: string) => {
              filterCalls.push([nextColumn, nextValue]);
              return {
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null })),
                })),
              };
            }),
          };
        }),
      })),
    })),
  },
}));

describe("GET /api/forenzx/jobs authorization", () => {
  it("scopes a requested foreign case to the authenticated job owner", async () => {
    filterCalls.length = 0;
    const { GET } = await import("../../../app/api/forenzx/jobs/route");
    const response = await GET(
      new NextRequest(`https://pandora.example/api/forenzx/jobs?caseId=${CASE_B}`),
    );

    expect(response.status).toBe(200);
    expect(filterCalls).toContainEqual(["case_id", CASE_B]);
    expect(filterCalls).toContainEqual(["user_id", USER_A]);
    await expect(response.json()).resolves.toEqual({ jobs: [] });
  });
});
