// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const USER_ID = "11111111-1111-4111-8111-111111111111";

let adminRpc: Mock<(...args: any[]) => any>;

// Chainovateľný query builder, ktorý sa dá awaitnúť na daný výsledok.
function qb(result: { data?: unknown; error?: unknown }) {
  const builder: any = {
    select: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

const userClient = {
  from: () => qb({ error: null }), // cases ping
};

let adminTables: Record<string, { data?: unknown; error?: unknown }>;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => adminRpc(...args),
    from: (table: string) => qb(adminTables[table] ?? { data: [], error: null }),
  },
}));

import { getSystemHealth } from "@/lib/forza/health.functions";

const handler = (getSystemHealth as any).handler as (args: {
  data: unknown;
  context: { supabase: unknown; userId: string; traceId: string };
}) => Promise<unknown>;

function run() {
  return handler({
    data: undefined,
    context: { supabase: userClient, userId: USER_ID, traceId: "t" },
  });
}

beforeEach(() => {
  adminTables = { ai_feature_logs: { data: [], error: null }, error_logs: { data: [], error: null } };
  adminRpc = vi.fn().mockImplementation(async (name: string) => {
    if (name === "has_role") return { data: true, error: null };
    if (name === "db_health_stats") return { data: null, error: null };
    return { data: null, error: null };
  });
});

afterEach(() => vi.restoreAllMocks());

describe("getSystemHealth — admin gate po revoke has_role z `authenticated`", () => {
  it("overuje rolu cez service (admin) klienta so správnym userId", async () => {
    await run();
    expect(adminRpc).toHaveBeenCalledWith("has_role", { _user_id: USER_ID, _role: "admin" });
  });

  it("vráti prehľad administrátorovi", async () => {
    const result = (await run()) as { database: unknown; ai: unknown; errors: unknown };
    expect(result).toHaveProperty("database");
    expect(result).toHaveProperty("ai");
    expect(result).toHaveProperty("errors");
  });

  it("fail-closed: roleError → „Overenie oprávnení zlyhalo.“", async () => {
    adminRpc = vi.fn().mockImplementation(async (name: string) =>
      name === "has_role"
        ? { data: null, error: { message: "permission denied for function has_role" } }
        : { data: null, error: null },
    );
    await expect(run()).rejects.toThrow("Overenie oprávnení zlyhalo.");
  });

  it("fail-closed: ne-admin → „Prístup majú iba administrátori.“", async () => {
    adminRpc = vi.fn().mockImplementation(async (name: string) =>
      name === "has_role" ? { data: false, error: null } : { data: null, error: null },
    );
    await expect(run()).rejects.toThrow("Prístup majú iba administrátori.");
  });
});
