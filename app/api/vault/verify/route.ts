import { NextRequest, NextResponse } from "next/server";
import {
  isAuthorizedCronRequest,
  runPendingEvidenceVerification,
} from "@/lib/storage/evidence-verify";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "fra1";

/**
 * Serverové overenie hashov čakajúcich dôkazov (cron / worker).
 * Autorizácia: `Authorization: Bearer $CRON_SECRET` (Vercel Cron ho posiela sám).
 * Bez nastaveného CRON_SECRET je endpoint zatvorený (503).
 */
async function handle(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "verification_not_configured" }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? "10");
  const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

  try {
    const results = await runPendingEvidenceVerification(limit);
    const summary = results.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    return NextResponse.json({ processed: results.length, summary });
  } catch (error) {
    return NextResponse.json(
      { error: "verification_failed", detail: error instanceof Error ? error.message : "unknown" },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
