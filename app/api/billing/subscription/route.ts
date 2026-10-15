import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_STATUSES, PLANS, planOf } from "@/config/billing";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
} from "@/lib/forza/sumup-billing.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
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
    if (error instanceof BillingConfigurationError) {
      return NextResponse.json({
        configured: false,
        status: "inactive",
        tier: "free",
        tierLabel: PLANS.free.name,
        features: PLANS.free.features,
      });
    }
    return NextResponse.json({ error: "Unable to read billing configuration." }, { status: 503 });
  }

  const { data: subscription, error } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status, current_period_end, cancel_at_period_end, trial_used")
    .eq("user_id", authData.user.id)
    .eq("environment", config.environment)
    .eq("provider", "sumup")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Unable to load subscription." }, { status: 503 });
  }

  const periodHasEnded =
    subscription?.current_period_end !== null &&
    subscription?.current_period_end !== undefined &&
    Date.parse(subscription.current_period_end) <= Date.now();
  const active = Boolean(
    subscription &&
      subscription.plan === "pro" &&
      ACTIVE_STATUSES.includes(subscription.status) &&
      !periodHasEnded,
  );
  const plan = planOf(active ? subscription?.plan : "free");

  return NextResponse.json({
    configured: true,
    status: active ? subscription?.status : (subscription?.status ?? "inactive"),
    tier: plan.id,
    tierLabel: plan.name,
    features: plan.features,
    cancelAtPeriodEnd: active && subscription?.cancel_at_period_end,
    currentPeriodEnd: active ? subscription?.current_period_end ?? null : null,
    sandboxMode: config.environment === "sandbox",
    trialUsed: Boolean(subscription?.trial_used),
  });
}

function getAccessToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  return request.cookies.get("sb-access-token")?.value ?? null;
}
