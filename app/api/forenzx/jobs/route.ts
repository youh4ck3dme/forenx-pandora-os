import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateVaultRequest } from "@/lib/storage/vault-auth";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JobRow = z.object({
  id: z.string(),
  case_id: z.string(),
  evidence_id: z.string(),
  hub_job_id: z.string().nullable(),
  pack_id: z.string(),
  input_type: z.string(),
  status: z.string(),
  error_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export async function GET(request: NextRequest) {
  const auth = await authenticateVaultRequest(request);
  if (auth.userId === null) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const caseId = searchParams.get("caseId");
  if (!caseId || !/^[0-9a-f-]{36}$/i.test(caseId)) {
    return NextResponse.json({ error: "Neplatné caseId." }, { status: 400 });
  }

  const { data: rows, error } = await supabaseAdmin
    .from("forenzx_analysis_jobs")
    .select("id, case_id, evidence_id, hub_job_id, pack_id, input_type, status, error_message, created_at, updated_at")
    .eq("case_id", caseId)
    .order("created_at", { ascending: false })
    .limit(12);

  if (error) {
    return NextResponse.json({ error: "Chyba pri načítaní úloh." }, { status: 500 });
  }

  return NextResponse.json({ jobs: (rows ?? []).map((row) => JobRow.parse(row)) });
}
