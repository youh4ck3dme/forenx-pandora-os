import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  getConfig: vi.fn(),
  sumupGet: vi.fn(),
  sumupPost: vi.fn(),
  verifyEnvironment: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));
vi.mock("@/lib/forza/sumup-billing.server", () => ({
  BillingConfigurationError: class BillingConfigurationError extends Error {},
  SumUpApiError: class SumUpApiError extends Error { constructor(readonly status: number) { super(); } },
  getSumUpBillingConfig: mocks.getConfig,
  sumupGet: mocks.sumupGet,
  sumupPost: mocks.sumupPost,
  verifySumUpEnvironment: mocks.verifyEnvironment,
}));

import { POST } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const subscriptionQuery = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
};

function request(token?: string, recurringConsent: unknown = true) {
  return new NextRequest("http://localhost:3007/api/billing/checkout", {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify({ recurringConsent }),
  });
}

describe("POST /api/billing/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of ["select", "eq"]) subscriptionQuery[method as "select" | "eq"].mockReturnThis();
    subscriptionQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    subscriptionQuery.upsert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue(subscriptionQuery);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId, email: "investigator@example.test" } },
      error: null,
    });
    mocks.getConfig.mockReturnValue({
      apiKey: "sumup_test_api_key_x",
      merchantCode: "TESTMERCHANT",
      environment: "sandbox",
      baseUrl: "http://localhost:3007",
    });
    mocks.sumupGet.mockResolvedValue({ customer_id: userId });
    mocks.sumupPost.mockResolvedValue({ id: "22222222-2222-4222-8222-222222222222", status: "PENDING" });
    mocks.verifyEnvironment.mockResolvedValue(undefined);
  });

  it("requires an authenticated user", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.sumupGet).not.toHaveBeenCalled();
  });

  it("requires explicit consent before creating a recurring setup checkout", async () => {
    const response = await POST(request("valid-token", false));
    expect(response.status).toBe(400);
    expect(mocks.sumupPost).not.toHaveBeenCalled();
  });

  it("creates a one-euro, recurring-card setup checkout for a 14-day trial", async () => {
    const response = await POST(request("valid-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checkoutId: "22222222-2222-4222-8222-222222222222",
      amount: 1,
    });
    const body = mocks.sumupPost.mock.calls[0][2];
    expect(body).toMatchObject({
      amount: 1,
      currency: "EUR",
      merchant_code: "TESTMERCHANT",
      customer_id: userId,
      purpose: "SETUP_RECURRING_PAYMENT",
    });
    expect(body.return_url).toBe("http://localhost:3007/api/billing/sumup-webhook");
    expect(subscriptionQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        provider: "sumup",
        plan: "free",
        status: "setup_pending",
        subscription_id: "22222222-2222-4222-8222-222222222222",
        recurring_consent_version: "sumup-recurring-v2",
        recurring_consent_at: expect.any(String),
      }),
      { onConflict: "user_id,environment" },
    );
  });

  it("creates a one-euro card setup checkout for a returning user without granting another trial", async () => {
    subscriptionQuery.maybeSingle.mockResolvedValue({
      data: { plan: "free", status: "canceled", trial_used: true, current_period_end: null },
      error: null,
    });

    const response = await POST(request("valid-token"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ amount: 1 });
    expect(mocks.sumupPost).toHaveBeenCalledWith(
      expect.anything(),
      "checkouts",
      expect.objectContaining({ amount: 1, purpose: "SETUP_RECURRING_PAYMENT" }),
    );
    expect(subscriptionQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ trial_used: true, status: "setup_pending" }),
      { onConflict: "user_id,environment" },
    );
  });
});
