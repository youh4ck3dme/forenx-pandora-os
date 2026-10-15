import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  BillingConfigurationError,
  getSumUpBillingConfig,
  verifySumUpEnvironment,
} from "@/lib/forza/sumup-billing.server";
import { activateSumUpSetupCheckout } from "@/lib/forza/sumup-subscription.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_WEBHOOK_BYTES = 32 * 1024;
const WebhookSchema = z.object({
  event_type: z.string().min(1).max(100),
  id: z.string().uuid(),
}).passthrough();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  let config;
  try {
    config = getSumUpBillingConfig(request.nextUrl.origin);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof BillingConfigurationError ? "SumUp webhook is not configured." : "SumUp webhook is unavailable." },
      { status: 503 },
    );
  }

  try {
    await verifySumUpEnvironment(config);
  } catch {
    return NextResponse.json({ error: "SumUp merchant a zvolené prostredie sa nezhodujú." }, { status: 503 });
  }

  const payload = await request.text();
  if (Buffer.byteLength(payload, "utf8") > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid webhook JSON." }, { status: 400 });
  }
  const event = WebhookSchema.safeParse(parsed);
  if (!event.success) return NextResponse.json({ error: "Invalid SumUp event." }, { status: 400 });
  if (event.data.event_type !== "CHECKOUT_STATUS_CHANGED") {
    return new NextResponse(null, { status: 204 });
  }

  // SumUp asks integrations to verify callbacks by retrieving the checkout from
  // its API. The callback itself is only a notification and carries no authority.
  const activation = await activateSumUpSetupCheckout(config, event.data.id);
  if (activation.ok || activation.reason === "unlinked" || activation.reason === "invalid" || activation.reason === "not_paid" || activation.reason === "payment_failed") {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ error: "Unable to sync SumUp checkout." }, { status: 503 });
}
