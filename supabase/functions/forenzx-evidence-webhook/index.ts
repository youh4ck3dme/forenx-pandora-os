import { createClient } from "npm:@supabase/supabase-js@2";

type EvidenceRecord = {
  id?: string;
  investigator_id?: string;
  file_name?: string;
  mime_type?: string;
  s3_object_key?: string;
  sha256_hash?: string;
  hash_verification_status?: string;
};

type Input = {
  caseId?: string;
  evidenceId?: string;
  userId?: string;
  inputType?: string;
  packId?: string;
  claimedSha256?: string;
  idempotencyKey?: string;
  record?: EvidenceRecord;
  type?: string;
};

const CASE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const EVIDENCE_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const INPUT_TYPES = new Set([
  "ios_backup",
  "ios_sysdiagnose",
  "ios_mobileconfig",
  "ios_app_container",
  "android_backup",
  "android_bugreport",
  "android_app_export",
  "android_filesystem_export",
  "mobile_generic_archive",
  "disk_raw",
  "evtx_logs",
  "pcap",
  "file_generic",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function isAuthorized(request: Request): boolean {
  const expected = Deno.env.get("FORENZX_WEBHOOK_SECRET")?.trim();
  if (!expected) return false;
  return request.headers.get("x-forenzx-webhook-secret") === expected;
}

function extractInput(body: Input) {
  const record = body.record ?? {};
  const caseId = body.caseId ?? record.s3_object_key?.match(/^cases\/([^/]+)\/evidence\//)?.[1];
  const evidenceId = body.evidenceId ?? record.id;
  const inputType = body.inputType ?? Deno.env.get("FORENZX_DEFAULT_INPUT_TYPE")?.trim();
  const packId = body.packId ?? Deno.env.get("FORENZX_PACK_ID")?.trim() ?? "mobile_compromise";
  const claimedSha256 = body.claimedSha256 ?? record.sha256_hash;
  const idempotencyKey = body.idempotencyKey ?? `pandora:evidence:${evidenceId}:${claimedSha256}`;
  return {
    record,
    caseId,
    evidenceId,
    userId: body.userId ?? record.investigator_id,
    inputType,
    packId,
    claimedSha256,
    idempotencyKey,
  };
}

async function callHub(name: string, arguments_: Record<string, unknown>) {
  const url = requiredEnv("FORENZX_MCP_URL").replace(/\/$/, "");
  const key = requiredEnv("FORENZX_MCP_API_KEY");
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: arguments_ } }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(payload?.error?.message ?? `ForenZX MCP HTTP ${response.status}`);
  }
  const text = payload?.result?.content?.find((item: { type?: string }) => item.type === "text")?.text;
  if (!text) throw new Error("ForenZX MCP returned no tool result");
  return JSON.parse(text) as { job_id?: string; status?: string; deduplicated?: boolean };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);

  try {
    const body = (await request.json()) as Input;
    const input = extractInput(body);
    if (body.record?.hash_verification_status && body.record.hash_verification_status !== "verified") {
      return json({ ignored: true, reason: "evidence_not_verified" }, 202);
    }
    if (!input.caseId || !CASE_ID.test(input.caseId) || !input.evidenceId || !EVIDENCE_ID.test(input.evidenceId) || !input.userId) {
      return json({ error: "caseId and evidenceId are required" }, 400);
    }
    if (!input.inputType || !INPUT_TYPES.has(input.inputType)) {
      return json({ ignored: true, reason: "inputType_required_or_unsupported" }, 202);
    }
    if (!input.claimedSha256 || !SHA256.test(input.claimedSha256)) {
      return json({ error: "claimedSha256 must be a SHA-256 digest" }, 400);
    }

    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
    const { data: existing } = await supabase
      .from("forenzx_analysis_jobs")
      .select("id, hub_job_id, status")
      .eq("evidence_id", input.evidenceId)
      .eq("pack_id", input.packId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (existing?.hub_job_id) return json({ accepted: true, deduplicated: true, jobId: existing.hub_job_id });

    const { data: row, error: insertError } = await supabase
      .from("forenzx_analysis_jobs")
      .upsert({
        case_id: input.caseId,
        evidence_id: input.evidenceId,
        user_id: input.userId ?? input.record.investigator_id,
        pack_id: input.packId,
        input_type: input.inputType,
        idempotency_key: input.idempotencyKey,
        status: "starting",
      }, { onConflict: "evidence_id,pack_id,idempotency_key" })
      .select("id")
      .single();
    if (insertError || !row) throw new Error(`forenzx job persistence failed: ${insertError?.message ?? "no row"}`);

    try {
      const result = await callHub("forenzx_analysis_start", {
        case_id: input.caseId,
        evidence_id: input.evidenceId,
        pack_id: input.packId,
        input_type: input.inputType,
        claimed_sha256: input.claimedSha256,
        idempotency_key: input.idempotencyKey,
      });
      if (!result.job_id) throw new Error("ForenZX did not return a job_id");

      await supabase.from("forenzx_analysis_jobs").update({
        hub_job_id: result.job_id,
        status: result.status?.toLowerCase() === "queued" ? "queued" : "running",
      }).eq("id", row.id);
      return json({ accepted: true, jobId: result.job_id, deduplicated: result.deduplicated ?? false });
    } catch (error) {
      await supabase.from("forenzx_analysis_jobs").update({
        status: "failed",
        error_message: error instanceof Error ? error.message.slice(0, 2000) : "ForenZX start failed",
      }).eq("id", row.id);
      throw error;
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Webhook failed" }, 500);
  }
});
