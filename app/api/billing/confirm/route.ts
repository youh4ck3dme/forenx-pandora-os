import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
  verifySumUpEnvironment,
} from "@/lib/forza/sumup-billing.server";
import { activateSumUpSetupCheckout } from "@/lib/forza/sumup-subscription.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BodySchema = z.object({ checkoutId: z.string().uuid() });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = getAccessToken(request);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Neplatná checkout relácia." }, { status: 400 });

  let config;
  try {
    config = getSumUpBillingConfig(request.nextUrl.origin);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof BillingConfigurationError ? "Platby zatiaľ nie sú nakonfigurované." : "Platby nie sú dostupné." },
      { status: 503 },
    );
  }

  try {
    await verifySumUpEnvironment(config);
  } catch {
    return NextResponse.json({ error: "SumUp merchant a zvolené prostredie sa nezhodujú." }, { status: 503 });
  }

  const { data: ownedCheckout, error: lookupError } = await supabaseAdmin
    .from("subscriptions")
    .select("subscription_id")
    .eq("user_id", authData.user.id)
    .eq("provider", "sumup")
    .eq("environment", config.environment)
    .eq("subscription_id", body.data.checkoutId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Checkout sa nepodarilo overiť." }, { status: 503 });
  if (!ownedCheckout) return NextResponse.json({ error: "Checkout nepatrí tomuto účtu." }, { status: 404 });

  const activation = await activateSumUpSetupCheckout(config, body.data.checkoutId);
  if (activation.ok) {
    return NextResponse.json({
      status: activation.status,
      currentPeriodEnd: activation.currentPeriodEnd,
    });
  }
  if (activation.reason === "not_paid") {
    return NextResponse.json({ error: "Overenie karty ešte nebolo potvrdené SumUpom." }, { status: 409 });
  }
  if (activation.reason === "invalid") {
    return NextResponse.json({ error: "SumUp checkout nemá platný opakovaný platobný súhlas." }, { status: 400 });
  }
  if (activation.reason === "payment_failed") {
    return NextResponse.json({ error: "Platbu 99 € sa nepodarilo dokončiť. Skontrolujte kartu a skúste znova." }, { status: 402 });
  }
  return NextResponse.json({ error: "Checkout sa nepodarilo synchronizovať." }, { status: 503 });
}

function getAccessToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  return request.cookies.get("sb-access-token")?.value ?? null;
}
