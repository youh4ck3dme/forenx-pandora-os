import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { PLANS } from "@/config/billing";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
  SumUpApiError,
  sumupDelete,
  sumupGet,
  sumupPost,
  sumupPut,
  verifySumUpEnvironment,
} from "@/lib/forza/sumup-billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DueSubscription = {
  user_id: string;
  customer_id: string | null;
  period_end: string;
  status: string;
  cancel_at_period_end: boolean;
  renewal_attempt_count: number;
};
type PaymentMethod = {
  customer_id: string;
  payment_instrument_token: string;
};
type PaymentAttempt = {
  id: string;
  checkout_reference: string;
  checkout_id: string | null;
  status: string;
  attempt_number: number;
};
type SumUpCheckout = {
  id: string;
  checkout_reference: string;
  merchant_code?: string;
  status: "PENDING" | "FAILED" | "PAID" | "EXPIRED" | string;
  amount: number;
  currency: string;
  customer_id?: string;
  transactions?: Array<{ status?: string }>;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || !authorized(request.headers.get("authorization"), cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let config;
  try {
    config = getSumUpBillingConfig(request.nextUrl.origin);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof BillingConfigurationError ? "SumUp billing is not configured." : "SumUp billing is unavailable." },
      { status: 503 },
    );
  }

  try {
    await verifySumUpEnvironment(config);
  } catch {
    return NextResponse.json({ error: "SumUp merchant a zvolené prostredie sa nezhodujú." }, { status: 503 });
  }

  const { data: due, error: claimError } = await supabaseAdmin.rpc("claim_sumup_due_subscriptions", {
    _environment: config.environment,
    _batch_size: 50,
  });
  if (claimError || !due) {
    return NextResponse.json({ error: "Unable to claim due subscriptions." }, { status: 503 });
  }

  let charged = 0;
  let canceled = 0;
  let failed = 0;
  for (const item of due as DueSubscription[]) {
    try {
      if (item.cancel_at_period_end) {
        await cancelDueSubscription(item, config.environment, config);
        canceled += 1;
        continue;
      }

      const outcome = await chargeDueSubscription(item, config);
      if (outcome === "charged") charged += 1;
      else if (outcome === "canceled") canceled += 1;
      else failed += 1;
    } catch {
      // Leave the claim to expire after 15 minutes. A retry resumes the same
      // stored checkout where possible and first checks its authoritative state.
      failed += 1;
    }
  }

  return NextResponse.json({ processed: due.length, charged, canceled, failed });
}

async function chargeDueSubscription(
  subscription: DueSubscription,
  config: ReturnType<typeof getSumUpBillingConfig>,
): Promise<"charged" | "failed" | "canceled"> {
  if (!subscription.customer_id || subscription.renewal_attempt_count < 1) {
    await markChargeFailure(subscription, config.environment, null, "missing_payment_method", config);
    return "failed";
  }

  const { data: method, error: methodError } = await supabaseAdmin
    .from("billing_payment_methods")
    .select("customer_id, payment_instrument_token")
    .eq("user_id", subscription.user_id)
    .eq("environment", config.environment)
    .maybeSingle();
  if (methodError || !method || method.customer_id !== subscription.customer_id) {
    await markChargeFailure(subscription, config.environment, null, "missing_payment_method", config);
    return "failed";
  }

  let attempt = await findUnresolvedAttempt(subscription, config.environment);
  if (!attempt) {
    const checkoutReference = makeRenewalReference(
      subscription.user_id,
      subscription.period_end,
      subscription.renewal_attempt_count,
    );
    const { data: created, error: createError } = await supabaseAdmin
      .from("billing_payment_attempts")
      .insert({
        user_id: subscription.user_id,
        environment: config.environment,
        period_end: subscription.period_end,
        attempt_number: subscription.renewal_attempt_count,
        checkout_reference: checkoutReference,
        status: "prepared",
      })
      .select("id, checkout_reference, checkout_id, status, attempt_number")
      .single();
    if (createError && createError.code !== "23505") {
      await releaseClaim(subscription.user_id, config.environment);
      throw new Error("Unable to store SumUp payment attempt.");
    }
    attempt = created ?? await findAttemptByReference(checkoutReference);
  }
  if (!attempt || attempt.status === "paid") {
    if (attempt?.status === "paid") {
      await extendSubscription(subscription, config.environment, attempt);
      return "charged";
    }
    await markChargeFailure(subscription, config.environment, null, "attempt_unavailable", config);
    return "failed";
  }

  let checkout: SumUpCheckout;
  try {
    checkout = attempt.checkout_id
      ? await getCheckout(config, attempt.checkout_id)
      : await createOrRecoverCheckout(subscription, config, attempt);
  } catch (error) {
    await deferAmbiguousAttempt(subscription, config.environment, attempt, errorCode(error));
    return "failed";
  }

  if (checkout.status === "PENDING") {
    try {
      await sumupPut<SumUpCheckout>(config, `checkouts/${encodeURIComponent(checkout.id)}`, {
        payment_type: "card",
        token: method.payment_instrument_token,
        customer_id: method.customer_id,
      });
      checkout = await getCheckout(config, checkout.id);
    } catch (error) {
      await deferAmbiguousAttempt(subscription, config.environment, attempt, errorCode(error));
      return "failed";
    }
  }

  const checkoutMatches =
    checkout.checkout_reference === attempt.checkout_reference &&
    checkout.merchant_code === config.merchantCode &&
    checkout.amount === PLANS.pro.amount &&
    checkout.currency === PLANS.pro.currency &&
    checkout.customer_id === method.customer_id;
  if (!checkoutMatches) {
    await markAttemptError(attempt.id, "checkout_mismatch");
    await markChargeFailure(subscription, config.environment, attempt, "checkout_mismatch", config);
    return "failed";
  }

  const isPaid =
    checkout.status === "PAID" &&
    checkout.transactions?.some((transaction) => transaction.status === "SUCCESSFUL");
  if (!isPaid) {
    if (checkout.status !== "FAILED" && checkout.status !== "EXPIRED") {
      await deferAmbiguousAttempt(subscription, config.environment, attempt, `checkout_${checkout.status.toLowerCase()}`);
      return "failed";
    }
    await markAttemptError(attempt.id, `checkout_${checkout.status.toLowerCase()}`);
    const finalAttempt = subscription.renewal_attempt_count >= 3;
    if (finalAttempt) {
      await cancelDueSubscription(subscription, config.environment, config);
      return "canceled";
    }
    await markChargeFailure(subscription, config.environment, attempt, `checkout_${checkout.status.toLowerCase()}`, config);
    return "failed";
  }

  await extendSubscription(subscription, config.environment, attempt);
  await supabaseAdmin.from("billing_events").insert({
    event_id: `sumup:renewal:${attempt.checkout_reference}`,
    provider: "sumup",
    type: "recurring_payment_succeeded",
    user_id: subscription.user_id,
    event_created_at: new Date().toISOString(),
    result: "processed",
    processed_at: new Date().toISOString(),
  });
  return "charged";
}

async function createOrRecoverCheckout(
  subscription: DueSubscription,
  config: ReturnType<typeof getSumUpBillingConfig>,
  attempt: PaymentAttempt,
): Promise<SumUpCheckout> {
  await supabaseAdmin.from("billing_payment_attempts").update({ status: "processing" }).eq("id", attempt.id);

  let checkout: SumUpCheckout;
  try {
    checkout = await sumupPost<SumUpCheckout>(config, "checkouts", {
      checkout_reference: attempt.checkout_reference,
      amount: PLANS.pro.amount,
      currency: PLANS.pro.currency,
      merchant_code: config.merchantCode,
      description: "ForenX Pro — mesačné predplatné",
      customer_id: subscription.customer_id,
      purpose: "CHECKOUT",
      return_url: `${config.baseUrl}/api/billing/sumup-webhook`,
    });
  } catch (error) {
    if (!(error instanceof SumUpApiError) || error.status !== 409) throw error;
    const list = await sumupGet<SumUpCheckout[]>(
      config,
      `checkouts?checkout_reference=${encodeURIComponent(attempt.checkout_reference)}`,
    );
    const recovered = Array.isArray(list)
      ? list.find((item) => item.checkout_reference === attempt.checkout_reference)
      : undefined;
    if (!recovered) throw new Error("Unable to recover duplicate SumUp checkout.");
    checkout = recovered;
  }

  const { error } = await supabaseAdmin
    .from("billing_payment_attempts")
    .update({ checkout_id: checkout.id, status: "processing" })
    .eq("id", attempt.id);
  if (error) throw new Error("Unable to link SumUp checkout.");
  return checkout;
}

async function getCheckout(config: ReturnType<typeof getSumUpBillingConfig>, checkoutId: string) {
  return sumupGet<SumUpCheckout>(config, `checkouts/${encodeURIComponent(checkoutId)}`);
}

async function findUnresolvedAttempt(
  subscription: DueSubscription,
  environment: "sandbox" | "live",
): Promise<PaymentAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("billing_payment_attempts")
    .select("id, checkout_reference, checkout_id, status, attempt_number")
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .eq("period_end", subscription.period_end)
    .in("status", ["prepared", "processing"])
    .order("attempt_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Unable to read SumUp payment attempts.");
  return data;
}

async function findAttemptByReference(reference: string): Promise<PaymentAttempt | null> {
  const { data, error } = await supabaseAdmin
    .from("billing_payment_attempts")
    .select("id, checkout_reference, checkout_id, status, attempt_number")
    .eq("checkout_reference", reference)
    .maybeSingle();
  if (error) throw new Error("Unable to read SumUp payment attempt.");
  return data;
}

async function extendSubscription(
  subscription: DueSubscription,
  environment: "sandbox" | "live",
  attempt: PaymentAttempt,
) {
  const currentEnd = new Date(subscription.period_end);
  const nextEnd = addUtcMonth(currentEnd).toISOString();
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({
      plan: "pro",
      status: "active",
      current_period_end: nextEnd,
      cancel_at_period_end: false,
      renewal_claimed_at: null,
      renewal_next_attempt_at: null,
      renewal_attempt_count: 0,
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .eq("provider", "sumup");
  if (error) throw new Error("Unable to extend SumUp subscription.");
  await supabaseAdmin.from("billing_payment_attempts").update({ status: "paid" }).eq("id", attempt.id);
}

async function markChargeFailure(
  subscription: DueSubscription,
  environment: "sandbox" | "live",
  attempt: PaymentAttempt | null,
  code: string,
  config: ReturnType<typeof getSumUpBillingConfig>,
) {
  const tries = subscription.renewal_attempt_count;
  if (tries >= 3) {
    if (attempt) await markAttemptError(attempt.id, code);
    await cancelDueSubscription(subscription, environment, config);
    return;
  }
  const delayDays = tries === 1 ? 1 : 3;
  const nextAttemptAt = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({
      plan: "pro",
      status: "past_due",
      cancel_at_period_end: false,
      renewal_claimed_at: null,
      renewal_next_attempt_at: nextAttemptAt,
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .eq("provider", "sumup");
  if (error) throw new Error("Unable to store SumUp payment failure.");
  if (attempt) await markAttemptError(attempt.id, code);
}

async function markAttemptError(attemptId: string, code: string) {
  await supabaseAdmin
    .from("billing_payment_attempts")
    .update({ status: "failed", error_code: code.slice(0, 80) })
    .eq("id", attemptId);
}

async function deferAmbiguousAttempt(
  subscription: DueSubscription,
  environment: "sandbox" | "live",
  attempt: PaymentAttempt,
  code: string,
) {
  const retryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { error } = await supabaseAdmin
    .from("billing_payment_attempts")
    .update({ error_code: code.slice(0, 80), status: "processing" })
    .eq("id", attempt.id);
  if (error) throw new Error("Unable to preserve SumUp payment attempt.");
  const { error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      plan: "pro",
      status: "past_due",
      cancel_at_period_end: false,
      renewal_claimed_at: null,
      renewal_next_attempt_at: retryAt,
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .eq("provider", "sumup");
  if (subscriptionError) throw new Error("Unable to defer ambiguous SumUp payment.");
}

async function cancelDueSubscription(
  subscription: DueSubscription,
  environment: "sandbox" | "live",
  config: ReturnType<typeof getSumUpBillingConfig>,
) {
  const { data: method } = await supabaseAdmin
    .from("billing_payment_methods")
    .select("customer_id, payment_instrument_token")
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .maybeSingle();
  const { error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .update({
      plan: "free",
      status: "canceled",
      cancel_at_period_end: false,
      renewal_claimed_at: null,
      renewal_next_attempt_at: null,
      renewal_attempt_count: 0,
      last_event_at: new Date().toISOString(),
    })
    .eq("user_id", subscription.user_id)
    .eq("environment", environment)
    .eq("provider", "sumup");
  if (subscriptionError) throw new Error("Unable to cancel SumUp subscription.");
  const { error: methodDeleteError } = await supabaseAdmin
    .from("billing_payment_methods")
    .delete()
    .eq("user_id", subscription.user_id)
    .eq("environment", environment);
  if (methodDeleteError) throw new Error("Unable to revoke local SumUp payment method.");
  if (method) {
    try {
      await sumupDelete(
        config,
        `customers/${encodeURIComponent(method.customer_id)}/payment-instruments/${encodeURIComponent(method.payment_instrument_token)}`,
      );
    } catch {
      // Local credentials are already removed; provider-side cleanup can be retried manually.
    }
  }
}

async function releaseClaim(userId: string, environment: "sandbox" | "live") {
  await supabaseAdmin
    .from("subscriptions")
    .update({ renewal_claimed_at: null })
    .eq("user_id", userId)
    .eq("environment", environment)
    .eq("provider", "sumup");
}

function makeRenewalReference(userId: string, periodEnd: string, attempt: number) {
  const cycle = Math.floor(Date.parse(periodEnd) / 1000).toString(36);
  return `fxr-${userId.replaceAll("-", "")}-${cycle}-${attempt}`;
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

function errorCode(error: unknown): string {
  return error instanceof SumUpApiError ? `sumup_http_${error.status}` : "sumup_request_failed";
}

function authorized(authorization: string | null, secret: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7).trim());
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
