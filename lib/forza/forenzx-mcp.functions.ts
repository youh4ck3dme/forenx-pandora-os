import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type ForenZXJob = z.infer<typeof JobRow>;

export const getForenZXJobs = createServerFn({ method: "GET", id: "forenzx/listJobs" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ caseId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("forenzx_analysis_jobs")
      .select("id, case_id, evidence_id, hub_job_id, pack_id, input_type, status, error_message, created_at, updated_at")
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(`ForenZX job metadata failed: ${error.message}`);
    return { jobs: (rows ?? []).map((row: unknown) => JobRow.parse(row)) };
  });
