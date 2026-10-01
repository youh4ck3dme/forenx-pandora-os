// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getClaims: mocks.getClaims,
    },
  })),
}));

import {
  devAuthBypassAllowed,
  requireSupabaseAuth,
} from "@/integrations/supabase/auth-middleware";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

function installRequestContext(current: Request): void {
  Object.defineProperty(globalThis, "__pandoraServerFnRequest", {
    configurable: true,
    value: { getStore: () => ({ headers: current.headers, url: current.url }) },
  });
}

async function executeAuth(current: Request): Promise<Record<string, unknown>> {
  installRequestContext(current);
  let context: Record<string, unknown> | undefined;
  await requireSupabaseAuth.execute({}, async (nextContext) => {
    context = nextContext;
    return null;
  });
  return context ?? {};
}

describe("requireSupabaseAuth development boundary", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://supabase.test");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.stubEnv("ALLOW_DEV_AUTH_BYPASS", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    mocks.getClaims.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as { __pandoraServerFnRequest?: unknown }).__pandoraServerFnRequest;
  });

  it.each(["production", "staging"])('without a token fails closed in %s', async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    await expect(executeAuth(request("http://localhost:3000/api/fn/test"))).rejects.toThrow(
      /No authorization header/,
    );
  });

  it("rejects a malformed token in staging", async () => {
    vi.stubEnv("NODE_ENV", "staging");
    await expect(
      executeAuth(
        request("https://preview.example.test/api/fn/test", {
          authorization: "Bearer malformed-token",
        }),
      ),
    ).rejects.toThrow(/Invalid token/);
  });

  it("allows an explicit bypass only on loopback", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_AUTH_BYPASS", "true");
    const context = await executeAuth(request("http://localhost:3000/api/fn/test"));
    expect(context).toMatchObject({ userId: "dev-user-id" });
    expect(devAuthBypassAllowed(request("http://127.0.0.1:3000/api/fn/test"))).toBe(true);
  });

  it("ignores an explicit bypass on public or deployed hostnames", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_AUTH_BYPASS", "true");
    expect(devAuthBypassAllowed(request("https://pandora.example.test/api/fn/test"))).toBe(false);
    await expect(
      executeAuth(request("https://pandora.example.test/api/fn/test")),
    ).rejects.toThrow(/No authorization header/);
  });
});
