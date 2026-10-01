import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PublicHealthResponseSchema,
  SnapshotSchema,
  buildPublicHealthResponse,
  type PublicHealthResponse,
} from "@/lib/forza/public-health";
import {
  cachePublicHealth,
  getCachedPublicHealth,
} from "@/lib/forza/public-health-cache.server";
import { mistralConfigured } from "@/lib/forza/ai/llm.server";
import { isS3Configured } from "@/lib/storage/s3-vault";
import {
  getRateLimiter,
  type RateLimitRule,
} from "@/lib/security/rate-limiter.server";
import { getTrustedClientIp } from "@/lib/security/client-ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEALTH_QUERY_TIMEOUT_MS = 8_000;
const PUBLIC_HEALTH_RATE_LIMIT: RateLimitRule = {
  bucket: "public-health",
  limit: 60,
  windowSeconds: 60,
};

function requestRateLimitKey(request: NextRequest): string {
  // The deployment proxy supplies these headers. They are hashed by the
  // shared limiter and never returned to the client or persisted in cleartext.
  return getTrustedClientIp(request, "anonymous");
}

function getPublicSupabaseClient() {
  const url = process.env["SUPABASE_URL"] || process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const key =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ||
    process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("health query timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlationId = request.headers.get("x-correlation-id") || crypto.randomUUID();
  const rate = await getRateLimiter().hit(
    PUBLIC_HEALTH_RATE_LIMIT,
    requestRateLimitKey(request),
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { error: rate.unavailable ? "Stav systému nie je možné overiť." : "Príliš veľa požiadaviek." },
      {
        status: rate.unavailable ? 503 : 429,
        headers: { "Cache-Control": "no-store", "x-correlation-id": correlationId },
      },
    );
  }

  const now = Date.now();
  const cachedHealth = getCachedPublicHealth(now);
  if (cachedHealth) {
    return NextResponse.json(cachedHealth, {
      status: 200,
      headers: {
        // P5: Zrušiť vrstvenie cache (bez stale-while-revalidate okna)
        "Cache-Control": "public, max-age=15, no-transform",
        "X-Health-Cache": "HIT",
        "x-correlation-id": correlationId,
      },
    });
  }

  try {
    const publicSupabase = getPublicSupabaseClient();
    const [snapshotResult, bucketsResult] = await Promise.allSettled([
      publicSupabase
        ? withTimeout(publicSupabase.rpc("public_health_snapshot"), HEALTH_QUERY_TIMEOUT_MS)
        : Promise.resolve({ data: null, error: new Error("public health is not configured") }),
      withTimeout(
        Promise.resolve().then(() => supabaseAdmin.storage.listBuckets()),
        HEALTH_QUERY_TIMEOUT_MS,
      ),
    ]);

    const snapshotData = snapshotResult.status === "fulfilled"
      ? snapshotResult.value.data
      : null;
    const bucketsData = bucketsResult.status === "fulfilled"
      ? bucketsResult.value
      : null;
    const parsedSnapshot = SnapshotSchema.safeParse(snapshotData);
    const storageAvailable = Boolean(bucketsData && !bucketsData.error);
    const candidateResponse = buildPublicHealthResponse(
      parsedSnapshot.success ? parsedSnapshot.data : null,
      storageAvailable && bucketsData ? (bucketsData.data?.length ?? 0) : null,
      storageAvailable,
      {
        aiChatConfigured: mistralConfigured("chat"),
        aiAnalysisConfigured: mistralConfigured("analysis"),
        s3Configured: isS3Configured(),
      },
    );
    const parsedResponse = PublicHealthResponseSchema.safeParse(candidateResponse);
    if (!parsedResponse.success) {
      return NextResponse.json(
        {
          checkedAt: new Date().toISOString(),
          overallStatus: "unavailable",
          checks: [],
        },
        { status: 503, headers: { "Cache-Control": "no-store", "x-correlation-id": correlationId } },
      );
    }
    const response = parsedResponse.data;

    // Never cache an unavailable measurement as if it were a healthy result.
    // The client can retain its last successful React Query value and display
    // the refresh warning while this response exposes the current safe status.
    if (response.overallStatus !== "unavailable") {
      cachePublicHealth(response, now);
    }

    return NextResponse.json(response, {
      status: 200,
      headers: {
        // P5: Zrušiť vrstvenie cache (bez stale-while-revalidate okna)
        "Cache-Control": "public, max-age=15, no-transform",
        "X-Health-Cache": "MISS",
        "x-correlation-id": correlationId,
      },
    });
  } catch {
    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        overallStatus: "unavailable",
        checks: [],
      },
      { status: 503, headers: { "Cache-Control": "no-store", "x-correlation-id": correlationId } },
    );
  }
}

