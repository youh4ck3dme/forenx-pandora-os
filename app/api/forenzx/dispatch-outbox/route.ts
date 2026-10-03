import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { drainForenzxDispatchOutbox } from "@/lib/forza/forenzx-dispatch-drain.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET and POST /api/forenzx/dispatch-outbox
 *
 * Drains forenzx_dispatch_outbox. A failed webhook POST keeps the row
 * (pending or failed) with last_error.
 *
 * Auth: FORENZX_WEBHOOK_SECRET via Bearer or x-forenzx-webhook-secret,
 * or Bearer CRON_SECRET (what Vercel Cron sends).
 *
 * Env: FORENZX_WEBHOOK_SECRET (outbound x-forenzx-webhook-secret and manual auth),
 * FORENZX_EVIDENCE_WEBHOOK_URL (absolute evidence-webhook URL).
 * Vercel Cron in vercel.json invokes GET on this path. Set CRON_SECRET.
 */

function safeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function bearer(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function isAuthorized(request: NextRequest): boolean {
  const webhookSecret = process.env.FORENZX_WEBHOOK_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const token = bearer(request);
  const customHeader = request.headers.get("x-forenzx-webhook-secret");
  if (webhookSecret && token && safeCompare(token, webhookSecret)) return true;
  if (webhookSecret && customHeader && safeCompare(customHeader, webhookSecret)) return true;
  if (cronSecret && token && safeCompare(token, cronSecret)) return true;
  return false;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await drainForenzxDispatchOutbox();
    if (summary.skipped) {
      return NextResponse.json({ error: summary.reason }, { status: 503 });
    }
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dispatch worker failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
