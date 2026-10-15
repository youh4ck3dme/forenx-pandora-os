import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock } = vi.hoisted(() => ({ getSessionMock: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: getSessionMock } },
}));

import {
  confirmCheckout,
  createCheckoutSession,
  getSubscriptionState,
  setSubscriptionCancellation,
} from "../payments.functions";
import { PLANS } from "@/config/billing";

const fetchMock = vi.fn<typeof fetch>();

describe("payment configuration", () => {
  beforeEach(() => {
    getSessionMock.mockResolvedValue({
      data: { session: { access_token: "user-access-token" } },
      error: null,
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the configured free and Pro plan limits and prices", () => {
    expect(PLANS.free.quotas.aiPerDay).toBe(5);
    expect(PLANS.pro.amount).toBe(99);
    expect(PLANS.pro.interval).toBe("month");
  });

  it("loads subscription state using the signed-in Supabase session", async () => {
    const state = {
      configured: true,
      status: "trialing",
      tier: "pro",
      tierLabel: "Pro",
      features: ["AI"],
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));

    await expect(getSubscriptionState()).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/billing/subscription",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer user-access-token" },
      }),
    );
  });

  it("creates a SumUp widget checkout and confirms it through authenticated routes", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ checkoutId: "11111111-1111-4111-8111-111111111111", amount: 1 }), { status: 200 }),
    );
    await expect(createCheckoutSession(true)).resolves.toEqual({
      checkoutId: "11111111-1111-4111-8111-111111111111",
      amount: 1,
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: "trialing", currentPeriodEnd: "2026-10-29T00:00:00.000Z" }), { status: 200 }),
    );
    await expect(confirmCheckout("11111111-1111-4111-8111-111111111111")).resolves.toEqual({
      status: "trialing",
      currentPeriodEnd: "2026-10-29T00:00:00.000Z",
    });

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ cancelAtPeriodEnd: true, status: "trialing" }), { status: 200 }),
    );
    await expect(setSubscriptionCancellation(true)).resolves.toEqual({
      cancelAtPeriodEnd: true,
      status: "trialing",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/billing/checkout", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ recurringConsent: true }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/billing/confirm", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ checkoutId: "11111111-1111-4111-8111-111111111111" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/billing/cancel", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ cancel: true }),
    }));
  });

  it("fails closed when there is no authenticated session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null }, error: null });

    await expect(createCheckoutSession(true)).rejects.toThrow("Prihláste sa do účtu");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
