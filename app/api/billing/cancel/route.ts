import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES } from "@/config/billing";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
  sumupDelete,
  verifySumUpEnvironment,
} from "@/lib/forza/sumup-billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let config;
  try {
    config = getSumUpBillingConfig(request.nextUrl.origin);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof BillingConfigurationError ? "Platby nie sú nakonfigurované." : "Platby nie sú dostupné." },
      { status: 503 },
    );
  }

  try {
    await verifySumUpEnvironment(config);
  } catch {
    return NextResponse.json({ error: "SumUp merchant a zvolené prostredie sa nezhodujú." }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { cancel?: unknown } | null;
  if (!body || typeof body.cancel !== "boolean") {
    return NextResponse.json({ error: "Chýba voľba zrušenia predplatného." }, { status: 400 });
  }

  const { data: subscription, error: lookupError } = await supabaseAdmin
    .from("subscriptions")
    .select("subscription_id, plan, status, current_period_end, cancel_at_period_end")
    .eq("user_id", authData.user.id)
    .eq("environment", config.environment)
    .eq("provider", "sumup")
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Predplatné sa nepodarilo načítať." }, { status: 503 });
  if (!subscription) return NextResponse.json({ error: "Aktívne predplatné sa nenašlo." }, { status: 404 });

  if (subscription.status === "setup_pending") {
    if (!body.cancel) return NextResponse.json({ error: "Nedokončené overenie karty nemožno obnoviť." }, { status: 409 });
    const { error: cancelError } = await supabaseAdmin
      .from("subscriptions")
      .update({ plan: "free", status: "canceled", subscription_id: null, current_period_end: null })
      .eq("user_id", authData.user.id)
      .eq("environment", config.environment)
      .eq("provider", "sumup")
      .eq("status", "setup_pending");
    if (cancelError) return NextResponse.json({ error: "Checkout sa nepodarilo zrušiť." }, { status: 503 });
    if (subscription.subscription_id) {
      try {
        await sumupDelete(config, `checkouts/${encodeURIComponent(subscription.subscription_id)}`);
      } catch {
        // The local checkout is already canceled; an expired provider checkout cannot grant access.
      }
    }
    return NextResponse.json({ cancelAtPeriodEnd: true, status: "canceled" });
  }

  const periodEnd = subscription.current_period_end ? Date.parse(subscription.current_period_end) : NaN;
  const hasCurrentEntitlement =
    subscription.plan === "pro" &&
    ACTIVE_STATUSES.includes(subscription.status) &&
    Number.isFinite(periodEnd) &&
    periodEnd > Date.now();
  if (!hasCurrentEntitlement) {
    return NextResponse.json({ error: "Aktívne predplatné sa nenašlo." }, { status: 404 });
  }
  if (body.cancel === subscription.cancel_at_period_end) {
    return NextResponse.json({ cancelAtPeriodEnd: subscription.cancel_at_period_end, status: subscription.status });
  }

  const currentPeriodEnd = subscription.current_period_end;
  if (!currentPeriodEnd) return NextResponse.json({ error: "Predplatné nemá platné obdobie." }, { status: 409 });

  const { error: updateError } = await supabaseAdmin
    .from("subscriptions")
    .update({ cancel_at_period_end: body.cancel })
    .eq("user_id", authData.user.id)
    .eq("environment", config.environment)
    .eq("provider", "sumup")
    .eq("current_period_end", currentPeriodEnd);
  if (updateError) return NextResponse.json({ error: "Predplatné sa nepodarilo aktualizovať." }, { status: 503 });

  return NextResponse.json({
    cancelAtPeriodEnd: body.cancel,
    status: subscription.status,
    currentPeriodEnd,
  });
}

function getAccessToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  return request.cookies.get("sb-access-token")?.value ?? null;
}
