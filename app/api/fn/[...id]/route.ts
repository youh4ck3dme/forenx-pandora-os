import { NextRequest, NextResponse } from "next/server";
import { handleServerFnRequest } from "@/lib/server-fn/handle.server";

// AI autopilot a hromadná extrakcia bežia dlho (nginx: proxy_read_timeout 600s).
export const maxDuration = 600;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Jediný vstup do serverových funkcií (createServerFn) z prehliadača.
 * Autorizáciu robí requireSupabaseAuth v každej funkcii nad hlavičkami tohto
 * requestu; zoznam volateľných funkcií je v lib/server-fn/registry.server.ts.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string[] }> },
): Promise<NextResponse> {
  const { id } = await params;
  const fnId = id.join("/");
  const { status, body } = await handleServerFnRequest(request, fnId);
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
