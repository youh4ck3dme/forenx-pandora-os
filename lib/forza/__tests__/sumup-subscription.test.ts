import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sumupGet: vi.fn(),
  sumupPost: vi.fn(),
  sumupPut: vi.fn(),
  sumupDelete: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/forza/sumup-billing.server", () => ({
  SumUpApiError: class SumUpApiError extends Error { constructor(readonly status: number) { super(); } },
  sumupGet: mocks.sumupGet,
  sumupPost: mocks.sumupPost,
  sumupPut: mocks.sumupPut,
  sumupDelete: mocks.sumupDelete,
}));

import { activateSumUpSetupCheckout } from "../sumup-subscription.server";

const checkoutId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const config = {
  apiKey: "sumup_test_api_key_x",
  merchantCode: "TESTMERCHANT",
  environment: "sandbox" as const,
  baseUrl: "http://localhost:3007",
};

function chain(result: unknown = { data: null, error: null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "lt", "upsert", "update", "insert", "delete"]) {
    query[method] = vi.fn().mockImplementation(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  query.insert.mockResolvedValue(result);
  query.upsert.mockResolvedValue(result);
  return query;
}

describe("activateSumUpSetupCheckout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not activate a setup checkout without the recorded recurring consent", async () => {
    const lookup = chain({
      data: {
        user_id: userId,
        customer_id: userId,
        subscription_id: checkoutId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        recurring_consent_at: null,
        recurring_consent_version: null,
      },
      error: null,
    });
    mocks.from.mockReturnValue(lookup);

    await expect(activateSumUpSetupCheckout(config, checkoutId)).resolves.toEqual({
      ok: false,
      reason: "unlinked",
    });
    expect(mocks.sumupGet).not.toHaveBeenCalled();
  });

  it("activates the trial only after SumUp confirms the paid recurring mandate", async () => {
    const lookup = chain({
      data: {
        user_id: userId,
        customer_id: userId,
        subscription_id: checkoutId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        recurring_consent_at: "2026-10-15T10:00:00.000Z",
        recurring_consent_version: "sumup-recurring-v1",
      },
      error: null,
    });
    const paymentMethod = chain();
    const update = chain({
      data: { status: "trialing", current_period_end: "2026-10-29T10:00:00.000Z" },
      error: null,
    });
    const event = chain();
    mocks.from
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(paymentMethod)
      .mockReturnValueOnce(update)
      .mockReturnValueOnce(event);
    mocks.sumupGet.mockResolvedValue({
      id: checkoutId,
      status: "PAID",
      purpose: "SETUP_RECURRING_PAYMENT",
      merchant_code: "TESTMERCHANT",
      customer_id: userId,
      amount: 1,
      currency: "EUR",
      mandate: { type: "recurrent", status: "active", merchant_code: "TESTMERCHANT" },
      payment_instrument: { token: "tokenized-payment-instrument" },
    });

    const result = await activateSumUpSetupCheckout(config, checkoutId);

    expect(result.ok).toBe(true);
    expect(paymentMethod.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: userId,
        environment: "sandbox",
        payment_instrument_token: "tokenized-payment-instrument",
      }),
      { onConflict: "user_id,environment" },
    );
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({
      plan: "pro",
      status: "trialing",
      trial_used: true,
    }));
  });

  it("charges 99 euros before reactivating a customer who already used the trial", async () => {
    const lookup = chain({
      data: {
        user_id: userId,
        customer_id: userId,
        subscription_id: checkoutId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        trial_used: true,
        recurring_consent_at: "2026-10-15T10:00:00.000Z",
        recurring_consent_version: "sumup-recurring-v2",
      },
      error: null,
    });
    const paymentMethod = chain();
    const attemptLookup = chain({
      data: { id: "attempt-id", checkout_id: null, status: "prepared" },
      error: null,
    });
    const attemptClaim = chain({ data: { id: "attempt-id" }, error: null });
    const attemptUpdate = chain();
    const subscriptionUpdate = chain({
      data: { status: "active", current_period_end: "2026-11-15T10:00:00.000Z" },
      error: null,
    });
    const event = chain();
    mocks.from
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(paymentMethod)
      .mockReturnValueOnce(attemptLookup)
      .mockReturnValueOnce(attemptClaim)
      .mockReturnValueOnce(attemptUpdate)
      .mockReturnValueOnce(attemptUpdate)
      .mockReturnValueOnce(subscriptionUpdate)
      .mockReturnValueOnce(event);
    mocks.sumupGet
      .mockResolvedValueOnce({
        id: checkoutId,
        status: "PAID",
        purpose: "SETUP_RECURRING_PAYMENT",
        merchant_code: "TESTMERCHANT",
        customer_id: userId,
        amount: 1,
        currency: "EUR",
        mandate: { type: "recurrent", status: "active", merchant_code: "TESTMERCHANT" },
        payment_instrument: { token: "reactivation-token" },
      })
      .mockResolvedValueOnce({
        id: "33333333-3333-4333-8333-333333333333",
        checkout_reference: `fxa-${checkoutId.replaceAll("-", "")}`,
        status: "PAID",
        merchant_code: "TESTMERCHANT",
        customer_id: userId,
        amount: 99,
        currency: "EUR",
        transactions: [{ status: "SUCCESSFUL" }],
      });
    mocks.sumupPost.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      checkout_reference: `fxa-${checkoutId.replaceAll("-", "")}`,
      status: "PENDING",
    });

    const result = await activateSumUpSetupCheckout(config, checkoutId);

    expect(result).toMatchObject({ ok: true, status: "active" });
    expect(mocks.sumupPost).toHaveBeenCalledWith(config, "checkouts", expect.objectContaining({
      amount: 99,
      currency: "EUR",
      customer_id: userId,
      purpose: "CHECKOUT",
    }));
    expect(mocks.sumupPut).toHaveBeenCalledWith(config, "checkouts/33333333-3333-4333-8333-333333333333", {
      payment_type: "card",
      token: "reactivation-token",
      customer_id: userId,
    });
    expect(subscriptionUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "active",
      trial_used: true,
    }));
  });

  it("does not charge again while another callback owns the reactivation attempt", async () => {
    const lookup = chain({
      data: {
        user_id: userId,
        customer_id: userId,
        subscription_id: checkoutId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        trial_used: true,
        recurring_consent_at: "2026-10-15T10:00:00.000Z",
        recurring_consent_version: "sumup-recurring-v2",
      },
      error: null,
    });
    const paymentMethod = chain();
    const attemptLookup = chain({
      data: { id: "attempt-id", checkout_id: "33333333-3333-4333-8333-333333333333", status: "processing" },
      error: null,
    });
    const attemptClaim = chain({ data: null, error: null });
    mocks.from
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(paymentMethod)
      .mockReturnValueOnce(attemptLookup)
      .mockReturnValueOnce(attemptClaim);
    mocks.sumupGet.mockResolvedValue({
      id: checkoutId,
      status: "PAID",
      purpose: "SETUP_RECURRING_PAYMENT",
      merchant_code: "TESTMERCHANT",
      customer_id: userId,
      amount: 1,
      currency: "EUR",
      mandate: { type: "recurrent", status: "active", merchant_code: "TESTMERCHANT" },
      payment_instrument: { token: "reactivation-token" },
    });

    await expect(activateSumUpSetupCheckout(config, checkoutId)).resolves.toEqual({
      ok: false,
      reason: "not_paid",
    });
    expect(mocks.sumupPost).not.toHaveBeenCalled();
    expect(mocks.sumupPut).not.toHaveBeenCalled();
  });

  it("revokes the saved card token after a failed reactivation charge", async () => {
    const lookup = chain({
      data: {
        user_id: userId,
        customer_id: userId,
        subscription_id: checkoutId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        trial_used: true,
        recurring_consent_at: "2026-10-15T10:00:00.000Z",
        recurring_consent_version: "sumup-recurring-v2",
      },
      error: null,
    });
    const paymentMethod = chain();
    const attemptLookup = chain({ data: { id: "attempt-id", checkout_id: null, status: "prepared" }, error: null });
    const attemptClaim = chain({ data: { id: "attempt-id" }, error: null });
    const attemptUpdate = chain();
    const revokeMethod = chain();
    mocks.from
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(paymentMethod)
      .mockReturnValueOnce(attemptLookup)
      .mockReturnValueOnce(attemptClaim)
      .mockReturnValueOnce(attemptUpdate)
      .mockReturnValueOnce(attemptUpdate)
      .mockReturnValueOnce(revokeMethod);
    mocks.sumupGet.mockResolvedValue({
      id: checkoutId,
      status: "PAID",
      purpose: "SETUP_RECURRING_PAYMENT",
      merchant_code: "TESTMERCHANT",
      customer_id: userId,
      amount: 1,
      currency: "EUR",
      mandate: { type: "recurrent", status: "active", merchant_code: "TESTMERCHANT" },
      payment_instrument: { token: "failed-card-token" },
    });
    mocks.sumupPost.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      checkout_reference: `fxa-${checkoutId.replaceAll("-", "")}`,
      status: "FAILED",
      merchant_code: "TESTMERCHANT",
      customer_id: userId,
      amount: 99,
      currency: "EUR",
    });

    await expect(activateSumUpSetupCheckout(config, checkoutId)).resolves.toEqual({
      ok: false,
      reason: "payment_failed",
    });
    expect(mocks.sumupDelete).toHaveBeenCalledWith(
      config,
      `customers/${userId}/payment-instruments/failed-card-token`,
    );
    expect(revokeMethod.delete).toHaveBeenCalled();
  });
});
