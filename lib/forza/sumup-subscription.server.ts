import "server-only";
import { PLANS } from "@/config/billing";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SumUpApiError,
  SumUpBillingConfig,
  sumupDelete,
  sumupGet,
  sumupPost,
  sumupPut,
} from "@/lib/forza/sumup-billing.server";

type SetupCheckout = {
  id: string;
  status: string;
  purpose?: string;
  merchant_code?: string;
  customer_id?: string;
  amount?: number;
  currency?: string;
  mandate?: { type?: string; status?: string; merchant_code?: string };
  payment_instrument?: { token?: string };
};

type ChargeCheckout = {
  id: string;
  checkout_reference: string;
  status: string;
  merchant_code?: string;
  customer_id?: string;
  amount?: number;
  currency?: string;
  transactions?: Array<{ status?: string }>;
};

export type SetupActivationResult =
  | { ok: true; status: "trialing" | "active"; currentPeriodEnd: string }
  | { ok: false; reason: "unlinked" | "not_paid" | "invalid" | "database" | "payment_failed" };

export async function activateSumUpSetupCheckout(
  config: SumUpBillingConfig,
  checkoutId: string,
): Promise<SetupActivationResult> {
  const { data: subscription, error: lookupError } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id, customer_id, subscription_id, plan, status, current_period_end, trial_used, recurring_consent_at, recurring_consent_version")
    .eq("provider", "sumup")
    .eq("environment", config.environment)
    .eq("subscription_id", checkoutId)
    .maybeSingle();

  if (lookupError) return { ok: false, reason: "database" };
  if (!subscription) return { ok: false, reason: "unlinked" };

  if (
    subscription.status === "trialing" || subscription.status === "active"
  ) {
    if (subscription.current_period_end) {
      const logged = await recordSetupEvent(checkoutId, subscription.user_id);
      if (!logged) return { ok: false, reason: "database" };
      return {
        ok: true,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
      };
    }
    return { ok: false, reason: "invalid" };
  }
  if (
    subscription.status !== "setup_pending" ||
    !subscription.customer_id ||
    !subscription.recurring_consent_at ||
    !["sumup-recurring-v1", "sumup-recurring-v2"].includes(subscription.recurring_consent_version ?? "")
  ) {
    return { ok: false, reason: "unlinked" };
  }

  let checkout: SetupCheckout;
  try {
    checkout = await sumupGet<SetupCheckout>(
      config,
      `checkouts/${encodeURIComponent(checkoutId)}`,
    );
  } catch {
    return { ok: false, reason: "not_paid" };
  }

  const paymentToken = checkout.payment_instrument?.token;
  if (
    checkout.id !== checkoutId ||
    checkout.merchant_code !== config.merchantCode ||
    checkout.customer_id !== subscription.customer_id ||
    checkout.amount !== 1 ||
    checkout.currency !== PLANS.pro.currency ||
    checkout.purpose !== "SETUP_RECURRING_PAYMENT" ||
    checkout.mandate?.type !== "recurrent" ||
    checkout.mandate.status !== "active" ||
    checkout.mandate.merchant_code !== config.merchantCode ||
    !paymentToken
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (checkout.status !== "PAID") return { ok: false, reason: "not_paid" };

  const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { error: paymentMethodError } = await supabaseAdmin
    .from("billing_payment_methods")
    .upsert(
      {
        user_id: subscription.user_id,
        environment: config.environment,
        customer_id: subscription.customer_id,
        payment_instrument_token: paymentToken,
      },
      { onConflict: "user_id,environment" },
    );
  if (paymentMethodError) return { ok: false, reason: "database" };

  if (subscription.trial_used) {
    let paymentResult: "paid" | "pending" | "failed";
    try {
      paymentResult = await chargeReactivation(config, subscription.user_id, subscription.customer_id, checkoutId, paymentToken);
    } catch {
      return { ok: false, reason: "not_paid" };
    }
    if (paymentResult === "failed") {
      const revoked = await revokeFailedReactivationMethod(config, subscription.user_id, subscription.customer_id, paymentToken);
      return { ok: false, reason: revoked ? "payment_failed" : "database" };
    }
    if (paymentResult !== "paid") return { ok: false, reason: "not_paid" };

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("subscriptions")
      .update({
        plan: "pro",
        status: "active",
        current_period_end: addUtcMonth(new Date()).toISOString(),
        cancel_at_period_end: false,
        renewal_claimed_at: null,
        renewal_next_attempt_at: null,
        renewal_attempt_count: 0,
        trial_used: true,
        last_event_at: new Date().toISOString(),
      })
      .eq("user_id", subscription.user_id)
      .eq("environment", config.environment)
      .eq("provider", "sumup")
      .eq("subscription_id", checkoutId)
      .eq("status", "setup_pending")
      .select("status, current_period_end")
      .maybeSingle();
    if (updateError) return { ok: false, reason: "database" };
    if (!updated?.current_period_end) {
      const { data: current, error } = await supabaseAdmin
        .from("subscriptions")
        .select("status, current_period_end, subscription_id")
        .eq("user_id", subscription.user_id)
        .eq("environment", config.environment)
        .eq("provider", "sumup")
        .maybeSingle();
      if (error || current?.subscription_id !== checkoutId || current.status !== "active" || !current.current_period_end) {
        return { ok: false, reason: "database" };
      }
      const logged = await recordSetupEvent(checkoutId, subscription.user_id, "recurring_payment_succeeded");
      if (!logged) return { ok: false, reason: "database" };
      return { ok: true, status: "active", currentPeriodEnd: current.current_period_end };
    }
    const logged = await recordSetupEvent(checkoutId, subscription.user_id, "recurring_payment_succeeded");
    if (!logged) return { ok: false, reason: "database" };
    return { ok: true, status: "active", currentPeriodEnd: updated.current_period_end };
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      plan: "pro",
      status: "trialing",
      current_period_end: trialEnd,
      cancel_at_period_end: false,
      renewal_claimed_at: null,
      renewal_next_attempt_at: null,
      renewal_attempt_count: 0,
      trial_used: true,
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", subscription.user_id)
    .eq("environment", config.environment)
    .eq("provider", "sumup")
    .eq("subscription_id", checkoutId)
    .eq("status", "setup_pending")
    .select("status, current_period_end")
    .maybeSingle();

  if (updateError) return { ok: false, reason: "database" };

  if (!updated) {
    // A duplicate widget callback or SumUp notification may race another confirmation.
    const { data: current, error: currentError } = await supabaseAdmin
      .from("subscriptions")
      .select("status, current_period_end, subscription_id")
      .eq("user_id", subscription.user_id)
      .eq("environment", config.environment)
      .eq("provider", "sumup")
      .maybeSingle();
    if (
      currentError ||
      current?.subscription_id !== checkoutId ||
      (current.status !== "trialing" && current.status !== "active") ||
      !current.current_period_end
    ) {
      return { ok: false, reason: "database" };
    }
    const logged = await recordSetupEvent(checkoutId, subscription.user_id);
    if (!logged) return { ok: false, reason: "database" };
    return {
      ok: true,
      status: current.status,
      currentPeriodEnd: current.current_period_end,
    };
  }

  if (!updated.current_period_end) return { ok: false, reason: "database" };
  const logged = await recordSetupEvent(checkoutId, subscription.user_id);
  if (!logged) return { ok: false, reason: "database" };
  return {
    ok: true,
    status: "trialing",
    currentPeriodEnd: updated.current_period_end,
  };
}

async function chargeReactivation(
  config: SumUpBillingConfig,
  userId: string,
  customerId: string,
  setupCheckoutId: string,
  paymentToken: string,
): Promise<"paid" | "pending" | "failed"> {
  const reference = `fxa-${setupCheckoutId.replaceAll("-", "")}`;
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("billing_payment_attempts")
    .select("id, checkout_id, status")
    .eq("checkout_reference", reference)
    .maybeSingle();
  if (lookupError) throw new Error("Unable to read reactivation payment attempt.");

  let attempt = existing as { id: string; checkout_id: string | null; status: string } | null;
  if (!attempt) {
    const { data, error } = await supabaseAdmin
      .from("billing_payment_attempts")
      .insert({
        user_id: userId,
        environment: config.environment,
        period_end: new Date().toISOString(),
        attempt_number: 1,
        checkout_reference: reference,
        status: "prepared",
      })
      .select("id, checkout_id, status")
      .single();
    if (error && error.code !== "23505") throw new Error("Unable to store reactivation payment attempt.");
    attempt = data;
    if (!attempt) {
      const { data: recovered, error: recoverError } = await supabaseAdmin
        .from("billing_payment_attempts")
        .select("id, checkout_id, status")
        .eq("checkout_reference", reference)
        .maybeSingle();
      if (recoverError || !recovered) return "pending";
      attempt = recovered;
    }
  }
  if (attempt.status === "paid") return "paid";
  if (attempt.status === "failed") return "failed";

  const leaseCutoff = new Date(Date.now() - 60_000).toISOString();
  let claimQuery = supabaseAdmin
    .from("billing_payment_attempts")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", attempt.id);
  if (attempt.status === "prepared") {
    claimQuery = claimQuery.eq("status", "prepared");
  } else if (attempt.status === "processing") {
    claimQuery = claimQuery.eq("status", "processing").lt("updated_at", leaseCutoff);
  } else {
    return "pending";
  }
  const { data: claimed, error: claimError } = await claimQuery.select("id").maybeSingle();
  if (claimError || !claimed) return "pending";

  let checkout: ChargeCheckout;
  if (attempt.checkout_id) {
    checkout = await sumupGet<ChargeCheckout>(config, `checkouts/${encodeURIComponent(attempt.checkout_id)}`);
  } else {
    try {
      checkout = await sumupPost<ChargeCheckout>(config, "checkouts", {
        checkout_reference: reference,
        amount: PLANS.pro.amount,
        currency: PLANS.pro.currency,
        merchant_code: config.merchantCode,
        description: "ForenX Pro — opätovná aktivácia predplatného",
        customer_id: customerId,
        purpose: "CHECKOUT",
        return_url: `${config.baseUrl}/api/billing/sumup-webhook`,
      });
    } catch (error) {
      if (!(error instanceof SumUpApiError) || error.status !== 409) return "pending";
      const list = await sumupGet<ChargeCheckout[]>(config, `checkouts?checkout_reference=${encodeURIComponent(reference)}`);
      const recovered = Array.isArray(list) ? list.find((item) => item.checkout_reference === reference) : undefined;
      if (!recovered) return "pending";
      checkout = recovered;
    }
    const { error } = await supabaseAdmin
      .from("billing_payment_attempts")
      .update({ checkout_id: checkout.id, status: "processing", updated_at: new Date().toISOString() })
      .eq("id", attempt.id);
    if (error) return "pending";
  }

  if (checkout.status === "PENDING") {
    await sumupPut<ChargeCheckout>(config, `checkouts/${encodeURIComponent(checkout.id)}`, {
      payment_type: "card",
      token: paymentToken,
      customer_id: customerId,
    });
    checkout = await sumupGet<ChargeCheckout>(config, `checkouts/${encodeURIComponent(checkout.id)}`);
  }

  const matches = checkout.checkout_reference === reference &&
    checkout.merchant_code === config.merchantCode &&
    checkout.customer_id === customerId &&
    checkout.amount === PLANS.pro.amount &&
    checkout.currency === PLANS.pro.currency;
  if (!matches) {
    await supabaseAdmin
      .from("billing_payment_attempts")
      .update({ status: "failed", error_code: "checkout_mismatch", updated_at: new Date().toISOString() })
      .eq("id", attempt.id);
    return "failed";
  }
  if (checkout.status === "FAILED" || checkout.status === "EXPIRED") {
    await supabaseAdmin
      .from("billing_payment_attempts")
      .update({ status: "failed", error_code: "checkout_failed", updated_at: new Date().toISOString() })
      .eq("id", attempt.id);
    return "failed";
  }
  if (checkout.status !== "PAID" || !checkout.transactions?.some((item) => item.status === "SUCCESSFUL")) {
    return "pending";
  }
  const { error } = await supabaseAdmin
    .from("billing_payment_attempts")
    .update({ status: "paid", updated_at: new Date().toISOString() })
    .eq("id", attempt.id);
  return error ? "pending" : "paid";
}

async function revokeFailedReactivationMethod(
  config: SumUpBillingConfig,
  userId: string,
  customerId: string,
  paymentToken: string,
): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("billing_payment_methods")
    .delete()
    .eq("user_id", userId)
    .eq("environment", config.environment);
  if (error) return false;
  try {
    await sumupDelete(
      config,
      `customers/${encodeURIComponent(customerId)}/payment-instruments/${encodeURIComponent(paymentToken)}`,
    );
  } catch {
    // The local token is already gone; failed payments cannot renew this account.
  }
  return true;
}

function addUtcMonth(value: Date): Date {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  const day = value.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month + 1,
    Math.min(day, lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
}

async function recordSetupEvent(
  checkoutId: string,
  userId: string,
  type = "recurring_card_setup_paid",
): Promise<boolean> {
  const { error } = await supabaseAdmin.from("billing_events").insert({
    event_id: `sumup:setup:${checkoutId}`,
    provider: "sumup",
    type,
    user_id: userId,
    event_created_at: new Date().toISOString(),
    result: "processed",
    processed_at: new Date().toISOString(),
  });
  return !error || error.code === "23505";
}
