import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES, PLANS } from "@/config/billing";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
  SumUpApiError,
  sumupGet,
  sumupPost,
  verifySumUpEnvironment,
} from "@/lib/forza/sumup-billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CARD_VERIFICATION_AMOUNT = 1;
type SumUpCustomer = { customer_id: string };
type SumUpCheckout = {
  id: string;
  status: string;
  amount?: number;
  valid_until?: string | null;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let requestBody: { recurringConsent?: unknown };
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Chýba súhlas s opakovaným účtovaním." }, { status: 400 });
  }
  if (requestBody?.recurringConsent !== true) {
    return NextResponse.json({ error: "Pred pokračovaním potvrďte súhlas s opakovaným účtovaním." }, { status: 400 });
  }

  let config;
  try {
    config = getSumUpBillingConfig(request.nextUrl.origin);
  } catch (error) {
    if (error instanceof BillingConfigurationError) {
      return NextResponse.json({ error: "Platby zatiaľ nie sú nakonfigurované." }, { status: 503 });
    }
    return NextResponse.json({ error: "Platby sa nepodarilo pripraviť." }, { status: 503 });
  }

  try {
    await verifySumUpEnvironment(config);
  } catch {
    return NextResponse.json({ error: "SumUp merchant a zvolené prostredie sa nezhodujú." }, { status: 503 });
  }

  const { data: existing, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("customer_id, subscription_id, plan, status, current_period_end, trial_used")
    .eq("user_id", authData.user.id)
    .eq("environment", config.environment)
    .eq("provider", "sumup")
    .maybeSingle();

  if (subscriptionError) {
    return NextResponse.json({ error: "Predplatné sa nepodarilo overiť." }, { status: 503 });
  }

  const periodHasEnded = existing?.current_period_end
    ? Date.parse(existing.current_period_end) <= Date.now()
    : false;
  if (
    existing?.plan === "pro" &&
    ACTIVE_STATUSES.includes(existing.status) &&
    !periodHasEnded
  ) {
    return NextResponse.json({ error: "Plán Pro už máte aktívny." }, { status: 409 });
  }

  if (existing?.status === "setup_pending" && existing.subscription_id) {
    try {
      const checkout = await sumupGet<SumUpCheckout>(
        config,
        `checkouts/${encodeURIComponent(existing.subscription_id)}`,
      );
      const expectedAmount = CARD_VERIFICATION_AMOUNT;
      if (
        checkout.status === "PENDING" &&
        checkout.amount === expectedAmount &&
        (!checkout.valid_until || Date.parse(checkout.valid_until) > Date.now())
      ) {
        return NextResponse.json({ checkoutId: checkout.id, amount: expectedAmount });
      }
    } catch {
      // Create a fresh setup checkout below; the old checkout is not trusted for entitlement.
    }
  }

  // SumUp's recurring setup checkout only tokenizes the card; its amount is
  // authorized and reimbursed. A returning customer is charged separately.
  const setupAmount = CARD_VERIFICATION_AMOUNT;
  if (setupAmount === null) {
    return NextResponse.json({ error: "Plán Pro nemá nastavenú cenu." }, { status: 503 });
  }
  const customerId = authData.user.id;
  try {
    await ensureCustomer(config, customerId, authData.user.email);
  } catch {
    return NextResponse.json({ error: "SumUp zákazníka sa nepodarilo pripraviť." }, { status: 502 });
  }

  const checkoutReference = `fxs-${customerId.replaceAll("-", "")}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  let checkout: SumUpCheckout;
  try {
    checkout = await sumupPost<SumUpCheckout>(config, "checkouts", {
      checkout_reference: checkoutReference,
      amount: setupAmount,
      currency: PLANS.pro.currency,
      merchant_code: config.merchantCode,
      description: existing?.trial_used
        ? "ForenX Pro — opätovná aktivácia predplatného"
        : "ForenX Pro — overenie karty pre trial",
      customer_id: customerId,
      purpose: "SETUP_RECURRING_PAYMENT",
      return_url: `${config.baseUrl}/api/billing/sumup-webhook`,
      redirect_url: `${config.baseUrl}/forza/predplatne?checkout=return`,
      valid_until: expiresAt,
    });
  } catch {
    return NextResponse.json({ error: "SumUp checkout sa nepodarilo vytvoriť." }, { status: 502 });
  }

  if (!checkout.id || checkout.status !== "PENDING") {
    return NextResponse.json({ error: "SumUp nevrátil platnú checkout reláciu." }, { status: 502 });
  }

  const { error: saveError } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: customerId,
        environment: config.environment,
        provider: "sumup",
        customer_id: customerId,
        subscription_id: checkout.id,
        price_id: PLANS.pro.priceId,
        plan: "free",
        status: "setup_pending",
        current_period_end: null,
        cancel_at_period_end: false,
        renewal_claimed_at: null,
        renewal_next_attempt_at: null,
        renewal_attempt_count: 0,
        trial_used: existing?.trial_used === true,
        recurring_consent_at: new Date().toISOString(),
        recurring_consent_version: "sumup-recurring-v2",
      },
      { onConflict: "user_id,environment" },
    );

  if (saveError) {
    return NextResponse.json({ error: "Checkout sa nepodarilo priradiť k účtu." }, { status: 503 });
  }

  return NextResponse.json({ checkoutId: checkout.id, amount: setupAmount });
}

async function ensureCustomer(config: ReturnType<typeof getSumUpBillingConfig>, customerId: string, email?: string) {
  try {
    await sumupGet<SumUpCustomer>(config, `customers/${encodeURIComponent(customerId)}`);
    return;
  } catch (error) {
    if (!(error instanceof SumUpApiError) || error.status !== 404) throw error;
  }

  try {
    await sumupPost<SumUpCustomer>(config, "customers", {
      customer_id: customerId,
      ...(email ? { personal_details: { email } } : {}),
    });
  } catch (error) {
    // Another concurrent request may have created this same deterministic customer.
    if (!(error instanceof SumUpApiError) || error.status !== 409) throw error;
  }
}

function getAccessToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  return request.cookies.get("sb-access-token")?.value ?? null;
}
