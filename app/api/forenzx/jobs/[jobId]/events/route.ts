import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ jobId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { jobId } = await params;
  if (!/^[A-Za-z0-9-]{1,128}$/.test(jobId)) {
    return NextResponse.json({ error: "Neplatné ID úlohy." }, { status: 400 });
  }

  const { data: job, error: lookupError } = await (supabaseAdmin as any)
    .from("forenzx_analysis_jobs")
    .select("hub_job_id")
    .eq("id", jobId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Stav úlohy sa nepodarilo overiť." }, { status: 503 });
  if (!job?.hub_job_id) return NextResponse.json({ error: "Úloha nebola nájdená." }, { status: 404 });

  const baseUrl = process.env.FORENZX_MCP_URL?.trim().replace(/\/$/, "");
  const apiKey = process.env.FORENZX_MCP_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "ForenZX MCP nie je nakonfigurovaný." }, { status: 503 });
  }

  const upstream = await fetch(`${baseUrl}/api/v1/jobs/${encodeURIComponent(job.hub_job_id)}/events`, {
    headers: { accept: "text/event-stream", "x-api-key": apiKey },
    cache: "no-store",
  });
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "ForenZX MCP stream nie je dostupný." }, { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
