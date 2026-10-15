import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  getConfig: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));
vi.mock("@/lib/forza/sumup-billing.server", () => ({
  BillingConfigurationError: class BillingConfigurationError extends Error {},
  getSumUpBillingConfig: mocks.getConfig,
}));

import { GET } from "./route";

const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
const userId = "11111111-1111-4111-8111-111111111111";

function request() {
  return new NextRequest("https://pandora.test/api/billing/subscription", {
    headers: { authorization: "Bearer valid-token" },
  });
}

describe("GET /api/billing/subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    query.select.mockReturnThis();
    query.eq.mockReturnThis();
    mocks.from.mockReturnValue(query);
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.getConfig.mockReturnValue({
      apiKey: "sumup_test_api_key_x",
      merchantCode: "TESTMERCHANT",
      environment: "sandbox",
      baseUrl: "https://pandora.test",
    });
  });

  it("grants Pro during a valid trial", async () => {
    query.maybeSingle.mockResolvedValue({
      data: {
        plan: "pro",
        status: "trialing",
        current_period_end: new Date(Date.now() + 86_400_000).toISOString(),
        cancel_at_period_end: false,
        trial_used: true,
      },
      error: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, tier: "pro", status: "trialing", trialUsed: true });
  });

  it("falls back to Free after subscription expiry", async () => {
    query.maybeSingle.mockResolvedValue({
      data: {
        plan: "pro",
        status: "active",
        current_period_end: new Date(Date.now() - 1_000).toISOString(),
        cancel_at_period_end: true,
      },
      error: null,
    });

    const response = await GET(request());

    expect(await response.json()).toMatchObject({ tier: "free", cancelAtPeriodEnd: false });
  });
});
