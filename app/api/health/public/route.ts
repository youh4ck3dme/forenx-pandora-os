import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  SnapshotSchema,
  buildPublicHealthResponse,
  type PublicHealthResponse,
} from "@/lib/forza/public-health";
import { mistralConfigured } from "@/lib/forza/ai/llm.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const HEALTH_QUERY_TIMEOUT_MS = 8_000;

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

export async function GET(): Promise<NextResponse<PublicHealthResponse>> {
  try {
    const [snapshotResult, bucketsResult] = await Promise.allSettled([
      withTimeout(
        supabaseAdmin.rpc("public_health_snapshot").single(),
        HEALTH_QUERY_TIMEOUT_MS,
      ),
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
    const response = buildPublicHealthResponse(
      parsedSnapshot.success ? parsedSnapshot.data : null,
      storageAvailable && bucketsData ? (bucketsData.data?.length ?? 0) : null,
      storageAvailable,
      {
        aiChatConfigured: mistralConfigured("chat"),
        aiAnalysisConfigured: mistralConfigured("analysis"),
      },
    );

    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        checkedAt: new Date().toISOString(),
        overallStatus: "unavailable",
        checks: [],
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
