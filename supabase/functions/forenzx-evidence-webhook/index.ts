/// <reference path="../deno.d.ts" />
import { createClient } from "npm:@supabase/supabase-js@2";
import { collectSuppliedCaseIds, decideEvidenceCaseId } from "./ledger-case.ts";

type EvidenceRecord = {
  id?: string;
  case_id?: string;
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

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
];

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
  // Canonical header only — SOURCE-OF-TRUTH §6
  return request.headers.get("x-forenzx-webhook-secret") === expected;
}

export function isValidDownloadUrl(rawUrl: string): { ok: boolean; reason?: string } {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, reason: "Empty download URL" };
  }
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "HTTPS protocol required" };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: "Credentials in URL are forbidden" };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".localhost")
    ) {
      return { ok: false, reason: `Loopback host forbidden: ${host}` };
    }
    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(host)) {
        return { ok: false, reason: `Private IP host forbidden: ${host}` };
      }
    }
    const allowedHostsEnv = Deno.env.get("FORENZX_ALLOWED_DOWNLOAD_HOSTS");
    if (allowedHostsEnv) {
      const allowedList = allowedHostsEnv.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
      const isAllowed = allowedList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
      if (!isAllowed) {
        return { ok: false, reason: `Foreign host rejected: ${host}` };
      }
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Malformed download URL" };
  }
}

function extractInput(body: Input) {
  const record = body.record ?? {};
  // caseId is intentionally not taken from the caller or from the S3 key.
  const evidenceId = body.evidenceId ?? record.id;
  const inputType = body.inputType ?? Deno.env.get("FORENZX_DEFAULT_INPUT_TYPE")?.trim();
  const packId = body.packId ?? Deno.env.get("FORENZX_PACK_ID")?.trim() ?? "mobile_compromise";
  const claimedSha256 = body.claimedSha256 ?? record.sha256_hash;
  const idempotencyKey = body.idempotencyKey ?? (evidenceId && claimedSha256 ? `pandora:evidence:${evidenceId}:${claimedSha256}` : undefined);
  return {
    record,
    evidenceId,
    userId: body.userId ?? record.investigator_id,
    inputType,
    packId,
    claimedSha256,
    idempotencyKey,
  };
}

/**
 * Fetch a presigned GET URL from Pandora M2M endpoint.
 * The Edge Function (Deno) cannot use the AWS SDK directly, so Pandora
 * generates the URL and hands it back via /api/forenzx/presign-for-hub.
 */
async function fetchPresignedDownloadUrl(
  s3ObjectKey: string,
  pandoraBaseUrl: string,
  webhookSecret: string,
): Promise<{ download_url: string; filename: string; expires_at: string }> {
  const url = `${pandoraBaseUrl.replace(/\/$/, "")}/api/forenzx/presign-for-hub`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forenzx-webhook-secret": webhookSecret,
    },
    body: JSON.stringify({ s3_object_key: s3ObjectKey }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Pandora presign-for-hub returned ${response.status}: ${text.slice(0, 500)}`);
  }
  const data = await response.json() as { download_url: string; filename: string; expires_at: string };
  if (!data.download_url) throw new Error("Pandora presign-for-hub returned no download_url");
  return data;
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


type LedgerEvidenceRow = {
  id?: string;
  case_id?: string | null;
  investigator_id?: string | null;
};

async function writeCaseMismatchAudit(
  supabase: ReturnType<typeof createClient>,
  evidenceRow: LedgerEvidenceRow,
  suppliedCaseIds: unknown[] | null,
  evidenceId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!evidenceRow.investigator_id) {
    return { ok: false, error: "investigator_id missing; cannot write case_audit_log" };
  }
  const { error } = await supabase.from("case_audit_log").insert({
    user_id: evidenceRow.investigator_id,
    case_id: evidenceRow.case_id,
    action: "forenzx_case_id_mismatch",
    table_name: "evidence_items",
    record_id: evidenceRow.id,
    changes: {
      ledger_case_id: evidenceRow.case_id ?? null,
      supplied_case_ids: suppliedCaseIds,
      evidence_id: evidenceId,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isAuthorized(request)) return json({ error: "Unauthorized" }, 401);

  try {
    const body = (await request.json()) as Input & { downloadUrl?: unknown; download_url?: unknown };

    // Invariant: ForenZX webhook must NEVER accept downloadUrl from caller
    if (body.downloadUrl !== undefined || body.download_url !== undefined) {
      return json(
        { error: "Caller-supplied downloadUrl is prohibited; download URL must be resolved from evidence ledger" },
        400
      );
    }

    const input = extractInput(body);

    if (!input.evidenceId || !EVIDENCE_ID.test(input.evidenceId)) {
      return json({ error: "evidenceId is required" }, 400);
    }
    if (!input.inputType || !INPUT_TYPES.has(input.inputType)) {
      return json({ ignored: true, reason: "inputType_required_or_unsupported" }, 202);
    }

    const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));

    // ── Load verified ledger row from evidence_items table ─────────────────
    const { data: evidenceRow, error: evidenceLookupError } = await supabase
      .from("evidence_items")
      .select("id, case_id, investigator_id, s3_object_key, sha256_hash, hash_verification_status, file_name")
      .eq("id", input.evidenceId)
      .maybeSingle();

    if (evidenceLookupError) {
      return json({ error: `Ledger lookup failed: ${evidenceLookupError.message}` }, 500);
    }
    if (!evidenceRow) {
      return json({ error: "Evidence row not found in ledger" }, 404);
    }

    // Fail-closed verification: only verified evidence is allowed
    if (evidenceRow.hash_verification_status !== "verified") {
      return json({ ignored: true, reason: "evidence_not_verified" }, 202);
    }

    const s3Key = evidenceRow.s3_object_key;
    if (!s3Key || typeof s3Key !== "string" || s3Key.includes("..")) {
      return json({ error: "Evidence ledger row contains invalid s3_object_key" }, 403);
    }

    const trustedSha256 = (evidenceRow.sha256_hash ?? "").toLowerCase();
    if (!SHA256.test(trustedSha256)) {
      return json({ error: "Evidence ledger row contains invalid sha256_hash" }, 403);
    }

    // caseId is ledger-authoritative. Caller caseId/case_id is checked, never trusted.
    // The S3 key is not a case identity.
    const suppliedCaseIds = collectSuppliedCaseIds(body);
    const caseDecision = decideEvidenceCaseId(evidenceRow.case_id, suppliedCaseIds);
    if (!caseDecision.ok) {
      if (caseDecision.code === "case_id_mismatch") {
        const audit = await writeCaseMismatchAudit(
          supabase,
          evidenceRow,
          suppliedCaseIds,
          input.evidenceId,
        );
        if (!audit.ok) {
          return json(
            { error: `Caller caseId rejected and audit log failed: ${audit.error}` },
            500,
          );
        }
      }
      return json({ error: caseDecision.error }, caseDecision.status);
    }
    const caseId = caseDecision.caseId;

    const userId = evidenceRow.investigator_id ?? input.userId;
    if (!userId) {
      return json({ error: "userId is required" }, 400);
    }

    const idempotencyKey = input.idempotencyKey ?? `pandora:evidence:${input.evidenceId}:${trustedSha256}`;

    // ── Idempotency deduplication check ────────────────────────────────────
    const { data: existing } = await supabase
      .from("forenzx_analysis_jobs")
      .select("id, hub_job_id, status")
      .eq("evidence_id", input.evidenceId)
      .eq("pack_id", input.packId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing?.hub_job_id) {
      return json({ accepted: true, deduplicated: true, jobId: existing.hub_job_id });
    }

    const { data: row, error: insertError } = await supabase
      .from("forenzx_analysis_jobs")
      .upsert({
        case_id: caseId,
        evidence_id: input.evidenceId,
        user_id: userId,
        pack_id: input.packId,
        input_type: input.inputType,
        idempotency_key: idempotencyKey,
        status: "starting",
      }, { onConflict: "evidence_id,pack_id,idempotency_key" })
      .select("id")
      .single();

    if (insertError || !row) {
      throw new Error(`forenzx job persistence failed: ${insertError?.message ?? "no row"}`);
    }

    try {
      // ── Compose presigned download URL on server from ledger row ─────────
      const pandoraUrl = requiredEnv("PANDORA_URL");
      const webhookSecret = requiredEnv("FORENZX_WEBHOOK_SECRET");
      const presigned = await fetchPresignedDownloadUrl(s3Key, pandoraUrl, webhookSecret);

      const download_url = presigned.download_url;
      const filename = presigned.filename || evidenceRow.file_name || "evidence.bin";

      // ── Cudzia URL = odmietnuť ───────────────────────────────────────────
      const urlCheck = isValidDownloadUrl(download_url);
      if (!urlCheck.ok) {
        return json(
          { error: `Download URL rejected: ${urlCheck.reason}` },
          403
        );
      }

      const result = await callHub("forenzx_analysis_start", {
        case_id: caseId,
        evidence_id: input.evidenceId,
        pack_id: input.packId,
        input_type: input.inputType,
        claimed_sha256: trustedSha256,
        idempotency_key: idempotencyKey,
        download_url,
        download_filename: filename,
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
