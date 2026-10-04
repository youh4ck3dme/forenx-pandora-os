"use client";

import { supabase } from "@/integrations/supabase/client";

export type ForenZXJob = {
  id: string;
  case_id: string;
  evidence_id: string;
  hub_job_id: string | null;
  pack_id: string;
  input_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type ForenZXTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export async function fetchForenZXJobs(
  input: string | { caseId: string }
): Promise<{ jobs: ForenZXJob[] }> {
  try {
    const caseId = typeof input === "string" ? input : input.caseId;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers: Record<string, string> = {};
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
    const res = await fetch(`/api/forenzx/jobs?caseId=${encodeURIComponent(caseId)}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return { jobs: [] };
    const json = await res.json();
    return { jobs: json.jobs ?? [] };
  } catch {
    return { jobs: [] };
  }
}

export async function fetchForenZXTools(): Promise<ForenZXTool[]> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
    const res = await fetch("/api/fn/forenzx/listTools", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
      cache: "no-store",
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
