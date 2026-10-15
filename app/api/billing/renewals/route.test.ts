import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  getConfig: vi.fn(),
  sumupGet: vi.fn(),
  sumupPost: vi.fn(),
  sumupPut: vi.fn(),
  sumupDelete: vi.fn(),
  verifyEnvironment: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));
vi.mock("@/lib/forza/sumup-billing.server", () => ({
  BillingConfigurationError: class BillingConfigurationError extends Error {},
  SumUpApiError: class SumUpApiError extends Error {
    constructor(readonly status: number) { super(); }
  },
  getSumUpBillingConfig: mocks.getConfig,
  sumupGet: mocks.sumupGet,
  sumupPost: mocks.sumupPost,
  sumupPut: mocks.sumupPut,
  sumupDelete: mocks.sumupDelete,
  verifySumUpEnvironment: mocks.verifyEnvironment,
}));

import { GET } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const checkoutId = "22222222-2222-4222-8222-222222222222";
const config = {
  apiKey: "sumup_test_api_key_x",
  merchantCode: "TESTMERCHANT",
  environment: "sandbox" as const,
  baseUrl: "http://localhost:3007",
};
const secret = "cron-secret-test-value-that-is-long-enough";
const previousCronSecret = process.env.CRON_SECRET;

function makeQuery(result: unknown) {
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: ReturnType<typeof vi.fn> } = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "limit"]) {
    query[method] = vi.fn().mockImplementation(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.single = vi.fn().mockResolvedValue(result);
  query.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve));
  return query;
}

function request(token?: string) {
  return new NextRequest("http://localhost:3007/api/billing/renewals", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/billing/renewals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
    mocks.getConfig.mockReturnValue(config);
    mocks.verifyEnvironment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCronSecret;
  });

  it("rejects requests without the configured cron secret before reaching SumUp", async () => {
    const response = await GET(request("incorrect-secret"));

    expect(response.status).toBe(401);
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.sumupGet).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous charge attempt open and retries the same checkout", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{
        user_id: userId,
        customer_id: userId,
        period_end: "2026-10-01T00:00:00.000Z",
        status: "active",
        cancel_at_period_end: false,
        renewal_attempt_count: 2,
      }],
      error: null,
    });
    const methodQuery = makeQuery({ data: { customer_id: userId, payment_instrument_token: "tokenized-card" }, error: null });
    const attemptQuery = makeQuery({ data: {
      id: "33333333-3333-4333-8333-333333333333",
      checkout_reference: "fxr-test-renewal",
      checkout_id: checkoutId,
      status: "processing",
      attempt_number: 1,
    }, error: null });
    const attemptUpdateQuery = makeQuery({ error: null });
    const subscriptionUpdateQuery = makeQuery({ error: null });
    mocks.from
      .mockReturnValueOnce(methodQuery)
      .mockReturnValueOnce(attemptQuery)
      .mockReturnValueOnce(attemptUpdateQuery)
      .mockReturnValueOnce(subscriptionUpdateQuery);
    mocks.sumupGet.mockResolvedValueOnce({
      id: checkoutId,
      checkout_reference: "fxr-test-renewal",
      merchant_code: "TESTMERCHANT",
      status: "PENDING",
      amount: 99,
      currency: "EUR",
      customer_id: userId,
    });
    mocks.sumupPut.mockRejectedValue(new Error("request timed out after dispatch"));

    const response = await GET(request(secret));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 1, charged: 0, canceled: 0, failed: 1 });
    expect(mocks.sumupPost).not.toHaveBeenCalled();
    expect(attemptUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing",
      error_code: "sumup_request_failed",
    }));
    expect(subscriptionUpdateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "past_due",
      renewal_next_attempt_at: expect.any(String),
    }));
  });
});
