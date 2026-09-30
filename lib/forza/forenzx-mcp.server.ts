import { z } from "zod";

const McpResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

const ToolSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
});

export type ForenZXTool = z.infer<typeof ToolSchema>;

export class ForenZXMcpError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "timeout" | "http" | "protocol",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ForenZXMcpError";
  }
}

function endpoint(): string {
  const value = process.env.FORENZX_MCP_URL?.trim();
  if (!value) throw new ForenZXMcpError("FORENZX_MCP_URL nie je nastavená.", "not_configured");
  return value.replace(/\/$/, "");
}

function apiKey(): string {
  const value = process.env.FORENZX_MCP_API_KEY?.trim();
  if (!value) throw new ForenZXMcpError("FORENZX_MCP_API_KEY nie je nastavený.", "not_configured");
  return value;
}

async function request(method: string, params: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(process.env.FORENZX_MCP_TIMEOUT_MS ?? 15000)),
  );

  try {
    const response = await fetch(`${endpoint()}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "mcp-protocol-version": "2026-07-28",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new ForenZXMcpError(`ForenZX MCP HTTP ${response.status}.`, "http", response.status);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ForenZXMcpError("ForenZX MCP vrátil neplatný JSON.", "protocol");
    }
    const envelope = McpResponseSchema.safeParse(parsed);
    if (!envelope.success) throw new ForenZXMcpError("ForenZX MCP vrátil neplatnú JSON-RPC odpoveď.", "protocol");
    if (envelope.data.error) throw new ForenZXMcpError(envelope.data.error.message, "protocol");
    return envelope.data.result;
  } catch (error) {
    if (error instanceof ForenZXMcpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ForenZXMcpError("ForenZX MCP timeout.", "timeout");
    }
    throw new ForenZXMcpError(
      error instanceof Error ? error.message : "ForenZX MCP request failed.",
      "http",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function listForenZXTools(): Promise<ForenZXTool[]> {
  const result = await request("tools/list");
  const parsed = z.object({ tools: z.array(ToolSchema) }).safeParse(result);
  if (!parsed.success) throw new ForenZXMcpError("ForenZX tools/list má neplatný tvar.", "protocol");
  return parsed.data.tools;
}

export async function callForenZXTool(
  name: string,
  arguments_: Record<string, unknown> = {},
): Promise<unknown> {
  if (!/^[a-z][a-z0-9_-]{0,127}$/i.test(name)) {
    throw new ForenZXMcpError("Neplatný názov ForenZX nástroja.", "protocol");
  }
  const result = await request("tools/call", { name, arguments: arguments_ });
  const parsed = z
    .object({
      content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
      isError: z.boolean().optional(),
    })
    .safeParse(result);
  if (!parsed.success) throw new ForenZXMcpError("ForenZX tools/call má neplatný tvar.", "protocol");
  if (parsed.data.isError) throw new ForenZXMcpError("ForenZX nástroj vrátil chybu.", "protocol");
  const text = parsed.data.content?.find((item) => item.type === "text")?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── High-level typed helper: start ForenZX analysis with S3 presigned URL ────
// Import presign helper (server-only — never bundled to client)
import { buildForenzxStartPayload } from "./forenzx-evidence-presign.server";

export interface StartForenZXAnalysisParams {
  caseId: string;
  evidenceId: string;
  packId: string;
  inputType: string;
  /** Full S3 key of the evidence file, e.g. "evidence/case-123/dump.tar.gz" */
  s3Key: string;
  /** Expected SHA-256 from the Pandora evidence ledger (hex, 64 chars) */
  sha256: string;
  /** Optional S3 bucket override (defaults to FORENZX_S3_BUCKET env var) */
  bucket?: string;
  /** Optional idempotency key for deduplication */
  idempotencyKey?: string;
}

export interface StartForenZXAnalysisResult {
  job_id: string;
  status: string;
  deduplicated: boolean;
}

/**
 * Starts a ForenZX analysis job.
 *
 * Automatically:
 *  1. Generates a presigned S3 URL for the evidence file.
 *  2. Calls `forenzx_analysis_start` on the Hub with the URL embedded.
 *  3. Hub streams the file into its vault, verifies SHA-256, runs Docker pack.
 *
 * @returns job_id + initial status
 */
export async function startForenZXAnalysis(
  params: StartForenZXAnalysisParams
): Promise<StartForenZXAnalysisResult> {
  const payload = await buildForenzxStartPayload({
    caseId: params.caseId,
    evidenceId: params.evidenceId,
    packId: params.packId,
    inputType: params.inputType,
    s3Key: params.s3Key,
    sha256: params.sha256,
    bucket: params.bucket,
    idempotencyKey: params.idempotencyKey,
  });

  // Remove internal metadata before sending to Hub
  const { _presigned_expires_at: _, ...hubArgs } = payload as Record<string, unknown>;

  const result = await callForenZXTool("forenzx_analysis_start", hubArgs);

  const parsed = (result as StartForenZXAnalysisResult);
  if (!parsed?.job_id) {
    throw new ForenZXMcpError("forenzx_analysis_start returned no job_id.", "protocol");
  }
  return parsed;
}
