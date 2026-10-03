/**
 * Strict ForenZX workflow regression gate.
 *
 * This is an opt-in staging test. It intentionally fails when configuration is
 * incomplete; it must never silently skip a broken integration.
 *
 * Covered flow:
 *   verified evidence -> Supabase Edge Function -> MCP Hub -> presigned
 *   download -> SHA-256 verification -> forensic job -> SSE -> signed result
 *
 * Required environment variables:
 *   FORENZX_REGRESSION_CONFIRM=RUN_AGAINST_STAGING
 *   FORENZX_REGRESSION_WEBHOOK_URL
 *   FORENZX_REGRESSION_WEBHOOK_SECRET
 *   FORENZX_REGRESSION_MCP_URL
 *   FORENZX_REGRESSION_MCP_API_KEY
 *   FORENZX_REGRESSION_CASE_ID
 *   FORENZX_REGRESSION_EVIDENCE_ID
 *   FORENZX_REGRESSION_USER_ID
 *   FORENZX_REGRESSION_INPUT_TYPE
 *   FORENZX_REGRESSION_PACK_ID
 *   FORENZX_REGRESSION_SHA256
 *   FORENZX_REGRESSION_SUPABASE_URL
 *   FORENZX_REGRESSION_SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "CANCELLED", "SECURITY_BLOCKED"]);
const SHA256 = /^[a-f0-9]{64}$/i;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[CONFIG] Missing ${name}`);
  return value;
}

function requireHttps(name: string): string {
  const value = required(name);
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error(`[CONFIG] ${name} must use https://`);
  return value;
}

function assertUuid(name: string, value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`[CONFIG] ${name} must be a UUID`);
  }
}

async function expectJson(response: Response, label: string): Promise<Record<string, unknown>> {
  const raw = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`[${label}] expected JSON, received HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error(`[${label}] HTTP ${response.status}: ${raw.slice(0, 1000)}`);
  }
  return body as Record<string, unknown>;
}

async function readSseUntilTerminal(response: Response): Promise<Record<string, unknown>[]> {
  if (!response.ok || !response.body) {
    throw new Error(`[SSE] HTTP ${response.status}; response body is missing`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: Record<string, unknown>[] = [];
  let buffer = "";
  const deadline = Date.now() + Number(process.env.FORENZX_REGRESSION_TIMEOUT_MS ?? 900_000);

  while (Date.now() < deadline) {
    const next = await reader.read();
    buffer += decoder.decode(next.value, { stream: !next.done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw new Error(`[SSE] invalid JSON frame: ${data.slice(0, 500)}`);
      }
      if (!parsed || typeof parsed !== "object") throw new Error("[SSE] frame is not an object");
      const event = parsed as Record<string, unknown>;
      events.push(event);
      if (typeof event.state === "string" && TERMINAL_STATES.has(event.state)) {
        await reader.cancel();
        return events;
      }
    }
    if (next.done) break;
  }
  await reader.cancel();
  throw new Error(`[SSE] no terminal state within ${process.env.FORENZX_REGRESSION_TIMEOUT_MS ?? 900_000} ms`);
}

async function main(): Promise<void> {
  if (process.env.FORENZX_REGRESSION_CONFIRM !== "RUN_AGAINST_STAGING") {
    throw new Error("Refusing to run: set FORENZX_REGRESSION_CONFIRM=RUN_AGAINST_STAGING");
  }

  const webhookUrl = requireHttps("FORENZX_REGRESSION_WEBHOOK_URL");
  const webhookSecret = required("FORENZX_REGRESSION_WEBHOOK_SECRET");
  const mcpUrl = requireHttps("FORENZX_REGRESSION_MCP_URL").replace(/\/$/, "");
  const mcpApiKey = required("FORENZX_REGRESSION_MCP_API_KEY");
  const caseId = required("FORENZX_REGRESSION_CASE_ID");
  const evidenceId = required("FORENZX_REGRESSION_EVIDENCE_ID");
  const userId = required("FORENZX_REGRESSION_USER_ID");
  const inputType = required("FORENZX_REGRESSION_INPUT_TYPE");
  const packId = required("FORENZX_REGRESSION_PACK_ID");
  const sha256 = required("FORENZX_REGRESSION_SHA256");
  const supabaseUrl = required("FORENZX_REGRESSION_SUPABASE_URL");
  const serviceRoleKey = required("FORENZX_REGRESSION_SUPABASE_SERVICE_ROLE_KEY");

  assertUuid("FORENZX_REGRESSION_CASE_ID", caseId);
  assertUuid("FORENZX_REGRESSION_EVIDENCE_ID", evidenceId);
  assertUuid("FORENZX_REGRESSION_USER_ID", userId);
  if (!SHA256.test(sha256)) throw new Error("[CONFIG] FORENZX_REGRESSION_SHA256 must be SHA-256");

  const idempotencyKey = `regression:${evidenceId}:${sha256}`;
  const webhookResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forenzx-webhook-secret": webhookSecret,
    },
    body: JSON.stringify({
      caseId,
      evidenceId,
      userId,
      inputType,
      packId,
      claimedSha256: sha256,
      idempotencyKey,
      record: {
        id: evidenceId,
        investigator_id: userId,
        file_name: "evidence.bin",
        s3_object_key: `cases/${caseId}/evidence/evidence.bin`,
        sha256_hash: sha256,
        hash_verification_status: "verified",
      },
    }),
  });
  const accepted = await expectJson(webhookResponse, "WEBHOOK");
  const jobId = String(accepted.jobId ?? "");
  if (!/^[A-Za-z0-9-]{1,128}$/.test(jobId)) throw new Error("[WEBHOOK] missing valid jobId");

  const toolsResponse = await fetch(`${mcpUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": mcpApiKey,
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "regression-tools", method: "tools/list", params: {} }),
  });
  const tools = await expectJson(toolsResponse, "MCP tools/list");
  const toolList = ((tools.result as Record<string, unknown> | undefined)?.tools ?? []) as Array<Record<string, unknown>>;
  const startTool = toolList.find((tool) => tool.name === "forenzx_analysis_start");
  const startProperties = (((startTool?.inputSchema as Record<string, unknown> | undefined)?.properties ?? {}) as Record<string, unknown>);
  if (!startTool || !startProperties.download_url) {
    throw new Error("[MCP] forenzx_analysis_start does not advertise download_url");
  }

  const sseResponse = await fetch(`${mcpUrl}/api/v1/jobs/${encodeURIComponent(jobId)}/events`, {
    headers: { accept: "text/event-stream", "x-api-key": mcpApiKey },
  });
  const events = await readSseUntilTerminal(sseResponse);
  const terminal = events.at(-1);
  if (!terminal || terminal.job_id !== jobId) throw new Error("[SSE] terminal event has wrong job_id");
  if (terminal.state !== "COMPLETED") throw new Error(`[SSE] terminal state is ${String(terminal.state)}`);
  if (!events.some((event) => event.current_stage === "Downloading evidence from S3")) {
    throw new Error("[SSE] download stage was not observed");
  }

  const resultResponse = await fetch(`${mcpUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": mcpApiKey,
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "regression-result",
      method: "tools/call",
      params: { name: "forenzx_analysis_results", arguments: { job_id: jobId } },
    }),
  });
  const resultEnvelope = await expectJson(resultResponse, "MCP results");
  const resultText = ((resultEnvelope.result as Record<string, unknown> | undefined)?.content as Array<Record<string, unknown>> | undefined)
    ?.find((item) => item.type === "text")?.text;
  if (typeof resultText !== "string") throw new Error("[MCP results] missing text payload");
  const result = JSON.parse(resultText) as Record<string, unknown>;
  if (result.status !== "COMPLETED") throw new Error(`[MCP results] status is ${String(result.status)}`);
  if (!Array.isArray(result.findings)) throw new Error("[MCP results] findings array is missing");
  if (!result.execution_record || typeof result.execution_record !== "object") {
    throw new Error("[MCP results] signed execution_record is missing");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: job, error } = await supabase
    .from("forenzx_analysis_jobs")
    .select("case_id, evidence_id, hub_job_id, status, idempotency_key")
    .eq("hub_job_id", jobId)
    .single();
  if (error || !job) throw new Error(`[Supabase] job projection missing: ${error?.message ?? "not found"}`);
  if (job.case_id !== caseId || job.evidence_id !== evidenceId || job.idempotency_key !== idempotencyKey) {
    throw new Error("[Supabase] job projection does not match the regression identity/evidence");
  }
  if (job.status !== "completed") throw new Error(`[Supabase] projected status is ${job.status}`);

  console.log(JSON.stringify({ status: "PASS", jobId, events: events.length, findings: result.findings.length }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
