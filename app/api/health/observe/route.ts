import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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

  try {
    // has_role aj health_metrics() majú odobraté EXECUTE roli `authenticated`
    // (migrácia 2026-10-03). Admin gate aj agregáciu preto robíme cez service
    // klienta; identita pochádza z overeného tokenu (auth.userId).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: isAdmin, error: roleError } = await supabaseAdmin.rpc("has_role", {
      _user_id: auth.userId,
      _role: "admin",
    });
    if (roleError) {
      tracedError(traceId, "[HealthObserve] overenie roly zlyhalo:", roleError.message);
      return NextResponse.json({ error: "Overenie oprávnení zlyhalo." }, { status: 500 });
    }
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Prístup majú iba administrátori." },
        { status: 403 },
      );
    }

    const metrics = await computeHealthMetrics(supabaseAdmin);
    return NextResponse.json({ metrics });
  } catch (err) {
    tracedError(traceId, "[HealthObserve] Neočekávaná chyba metrík:", err);
    return NextResponse.json({ error: "Metriky sa nepodarilo načítať." }, { status: 500 });
  }
}

/**
 * Agregácia operatívnych metrík za posledných 24 h cez service klienta.
 * Verná náhrada SQL funkcie `health_metrics()` (migrácia 20260928000100), ktorá
 * už nie je volateľná z `authenticated` relácie. Pozn.: duplikuje SQL logiku —
 * čistejšie by bolo pridať `_actor uuid` param do `health_metrics` (migrácia),
 * no tu volíme app-only riešenie bez migrácie.
 */
type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function computeHealthMetrics(supabaseAdmin: AdminClient) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [aiRes, evidenceRes, errorsRes] = await Promise.all([
    supabaseAdmin
      .from("ai_usage")
      .select("status, error_code, created_at, finished_at")
      .gte("created_at", since),
    supabaseAdmin
      .from("evidence_items")
      .select("hash_verification_status, created_at")
      .gte("created_at", since),
    supabaseAdmin
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since),
  ]);

  if (aiRes.error) throw new Error(aiRes.error.message);
  if (evidenceRes.error) throw new Error(evidenceRes.error.message);
  if (errorsRes.error) throw new Error(errorsRes.error.message);

  const aiRows = (aiRes.data ?? []) as Array<{
    status: string | null;
    error_code: string | null;
    created_at: string | null;
    finished_at: string | null;
  }>;
  const aiTotal = aiRows.length;
  const aiFailed = aiRows.filter((r) => r.status === "failed").length;
  const aiTimeouts = aiRows.filter(
    (r) =>
      r.error_code === "timeout" ||
      (r.finished_at != null &&
        r.created_at != null &&
        new Date(r.finished_at).getTime() - new Date(r.created_at).getTime() >
          60_000),
  ).length;

  const evidenceRows = (evidenceRes.data ?? []) as Array<{
    hash_verification_status: string | null;
  }>;
  const s3Uploads = evidenceRows.length;
  const s3Failed = evidenceRows.filter(
    (r) =>
      r.hash_verification_status === "mismatch" ||
      r.hash_verification_status === "object_missing" ||
      r.hash_verification_status === "error",
  ).length;

  const dbErrors = errorsRes.count ?? 0;

  const round2 = (value: number) => Math.round(value * 100) / 100;
  const aiFailureRate = aiTotal > 0 ? round2((aiFailed * 100) / aiTotal) : 0;
  const s3FailureRate = s3Uploads > 0 ? round2((s3Failed * 100) / s3Uploads) : 0;

  return {
    window_hours: 24,
    generated_at: new Date().toISOString(),
    ai: {
      total: aiTotal,
      failed: aiFailed,
      timeouts_over_60s: aiTimeouts,
      failure_rate_percent: aiFailureRate,
    },
    s3: {
      uploads: s3Uploads,
      failed: s3Failed,
      failure_rate_percent: s3FailureRate,
    },
    supabase: {
      errors_24h: dbErrors,
    },
    alerts: {
      ai_timeouts_over_60s: aiTimeouts > 0,
      s3_failure_rate_over_1pct: s3Uploads > 0 && (s3Failed * 100) / s3Uploads > 1,
      supabase_errors_high: dbErrors >= 10,
    },
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return withTraceRoute(request, (traceId) => handleGet(request, traceId));
}
