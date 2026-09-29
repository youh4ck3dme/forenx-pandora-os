import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { tracedError, withTraceRoute } from "@/lib/forza/trace";
import { sanitizeForLog } from "@/lib/forza/trace";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

/**
 * POST /api/health/observe (P0-04)
 * Chybový sink klienta: window.onerror / unhandledrejection / error boundary
 * sem posielajú štruktúrované hlásenie. Všetko sa prečistí cez sanitizeForLog
 * (redakcia PII + maskovanie API kľúčov) a zapíše do error_logs (source
 * 'client'). Rate limit: 10 hlásení / používateľ / minúta.
 */

import { checkObserveReportRateLimit } from "./limiter";

const ClientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  route: z.string().max(500).optional(),
  severity: z.enum(["error", "warning"]).default("error"),
});

async function insertClientError(params: {
  userId: string;
  message: string;
  stack?: string;
  route?: string;
  severity: string;
}): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("error_logs").insert({
      user_id: params.userId,
      message: params.message,
      stack: params.stack,
      route: params.route,
      severity: params.severity,
      source: "client",
    });
    if (error) {
      tracedError(null, "[HealthObserve] Zápis chyby do error_logs zlyhal:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    tracedError(null, "[HealthObserve] Neočekávaná chyba pri zápise:", err);
    return false;
  }
}

async function handlePost(
  request: NextRequest,
  traceId: string,
): Promise<NextResponse> {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // P0-09: zdieľaný limit naprieč inštanciami; nedostupný limiter = odmietnutie.
  const rate = await checkObserveReportRateLimit(auth.userId);
  if (!rate.allowed) {
    return rate.unavailable
      ? NextResponse.json({ error: "Limit hlásení sa nepodarilo overiť." }, { status: 503 })
      : NextResponse.json({ error: "Prekročený limit hlásení (10/min)." }, { status: 429 });
  }

  const body: unknown = await request.json().catch(() => null);
  const parsed = ClientErrorSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Neplatné hlásenie chyby." },
      { status: 400 },
    );
  }

  // Sanitizácia: logy NESMÚ obsahovať PII ani API kľúče (P0-04).
  const sanitized = {
    message: sanitizeForLog(parsed.data.message),
    stack: parsed.data.stack ? sanitizeForLog(parsed.data.stack) : undefined,
    route: parsed.data.route
      ? sanitizeForLog(parsed.data.route).slice(0, 500)
      : undefined,
    severity: parsed.data.severity,
  };

  const stored = await insertClientError({
    userId: auth.userId,
    ...sanitized,
  });
  if (!stored) {
    return NextResponse.json(
      { error: "Hlásenie sa nepodarilo zapísať." },
      { status: 500 },
    );
  }
  return new NextResponse(null, { status: 204 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handlePost(request, traceId));
}

/**
 * GET /api/health/observe (P0-04)
 * Operatívne metriky za 24 h (AI timeouty > 60 s, S3 failure rate,
 * Supabase chyby) + vyhodnotené alert prahy. Iba administrátor
 * (kontrola v health_metrics RPC).
 */
async function handleGet(request: NextRequest, traceId: string): Promise<NextResponse> {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  if (!auth.token) {
    return NextResponse.json(
      { error: "Metriky vyžadujú reláciu administrátora." },
      { status: 401 },
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "Metriky nie sú nakonfigurované." }, { status: 503 });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("health_metrics");
    if (error) {
      tracedError(traceId, "[HealthObserve] health_metrics zlyhal:", error.message);
      const status = /administr|42501|Prístup/i.test(error.message) ? 403 : 500;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ metrics: data });
  } catch (err) {
    tracedError(traceId, "[HealthObserve] Neočekávaná chyba metrík:", err);
    return NextResponse.json({ error: "Metriky sa nepodarilo načítať." }, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handleGet(request, traceId));
}
