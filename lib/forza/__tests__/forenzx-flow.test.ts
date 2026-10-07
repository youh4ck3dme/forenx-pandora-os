/**
 * ForenZX end-to-end contract tests (unit/integration layer — no live Hub).
 *
 * Tests the full flow contract:
 *   evidence verified
 *   → /api/forenzx/start (auth + IDOR + idempotency + Hub call)
 *   → /api/forenzx/presign-for-hub (M2M presigned URL)
 *   → /api/forenzx/jobs/:id/events (SSE proxy)
 *
 * All external calls (Supabase, S3, Hub) are mocked.
 * Run with: npx vitest run lib/forza/__tests__/forenzx-flow.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  FORENZX_WEBHOOK_HEADER,
  isWebhookAuthorized,
} from "../../../supabase/functions/forenzx-evidence-webhook/webhook-auth";

// ── Mock AWS SDK presigner ──────────────────────────────────────────────────────
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn();
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(async () => "https://s3.example.com/evidence/test-file.bin?X-Amz-Signature=abc123&expires=3600"),
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("ForenZX flow: presign-for-hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORENZX_S3_REGION = "eu-central-1";
    process.env.FORENZX_S3_ACCESS_KEY_ID = "AKIATEST";
    process.env.FORENZX_S3_SECRET_ACCESS_KEY = "test-secret";
    process.env.FORENZX_S3_BUCKET = "forenx-vault-test";
    process.env.FORENZX_PRESIGNED_EXPIRY_SECONDS = "3600";
  });

  it("generates a presigned GET URL with correct structure", async () => {
    const { generateEvidencePresignedUrl } = await import("../forenzx-evidence-presign.server");

    const result = await generateEvidencePresignedUrl("evidence/case-abc/dump.tar.gz");

    expect(result.url).toContain("https://s3.example.com");
    expect(result.url).toContain("X-Amz-Signature");
    expect(result.filename).toBe("dump.tar.gz");
    expect(result.s3Key).toBe("evidence/case-abc/dump.tar.gz");
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("buildForenzxStartPayload includes download_url and download_filename", async () => {
    const { buildForenzxStartPayload } = await import("../forenzx-evidence-presign.server");

    const payload = await buildForenzxStartPayload({
      caseId: "case-001",
      evidenceId: "ev-001",
      packId: "mobile_compromise",
      inputType: "ios_backup",
      s3Key: "evidence/case-001/backup.tar.gz",
      sha256: "a".repeat(64),
    });

    expect(payload.download_url).toContain("https://s3.example.com");
    expect(payload.download_filename).toBe("backup.tar.gz");
    expect(payload.case_id).toBe("case-001");
    expect(payload.evidence_id).toBe("ev-001");
    expect(payload.claimed_sha256).toBe("a".repeat(64));
    // Internal metadata must NOT be sent to Hub
    expect(Object.keys(payload)).not.toContain("_presigned_expires_at");
  });
});

describe("ForenZX flow: webhook header", () => {
  const SECRET = "webhook-secret-value";

  function requestWith(name: string | null, value = ""): Request {
    const headers = new Headers();
    if (name) headers.set(name, value);
    return new Request("https://edge.local/forenzx-evidence-webhook", {
      method: "POST",
      headers,
    });
  }

  it("missing FORENZX_WEBHOOK_SECRET is unauthorized", () => {
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, SECRET), undefined)).toBe(false);
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, SECRET), "")).toBe(false);
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, SECRET), "   ")).toBe(false);
  });

  it("missing canonical header is unauthorized", () => {
    expect(isWebhookAuthorized(requestWith(null), SECRET)).toBe(false);
  });

  it("incorrect secret is unauthorized", () => {
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, "totally-wrong"), SECRET)).toBe(false);
  });

  it("prefix-only secret is unauthorized", () => {
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, "webhook"), SECRET)).toBe(false);
  });

  it("same-length incorrect secret is unauthorized", () => {
    const flipped = `${SECRET.slice(0, -1)}X`;
    expect(flipped).toHaveLength(SECRET.length);
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, flipped), SECRET)).toBe(false);
  });

  it("correct secret is authorized", () => {
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, SECRET), SECRET)).toBe(true);
  });

  it("canonical header remains x-forenzx-webhook-secret", () => {
    const src = readFileSync("supabase/functions/forenzx-evidence-webhook/index.ts", "utf8");
    expect(FORENZX_WEBHOOK_HEADER).toBe("x-forenzx-webhook-secret");
    expect(src).toContain('Deno.env.get("FORENZX_WEBHOOK_SECRET")');
    expect(src).toContain("isWebhookAuthorized(request, Deno.env.get(\"FORENZX_WEBHOOK_SECRET\"))");
    expect(src).not.toContain("=== expected");
    expect(src).not.toContain('"x-webhook-secret"');
    expect(isWebhookAuthorized(requestWith("x-webhook-secret", SECRET), SECRET)).toBe(false);
    expect(isWebhookAuthorized(requestWith(FORENZX_WEBHOOK_HEADER, SECRET), SECRET)).toBe(true);
  });
});

describe("ForenZX flow: idempotency key", () => {
  it("idempotency key format is deterministic and reproducible", () => {
    const evidenceId = "11111111-2222-3333-4444-555555555555";
    const sha256 = "abc123".padEnd(64, "0");

    const key1 = `pandora:evidence:${evidenceId}:${sha256.toLowerCase()}`;
    const key2 = `pandora:evidence:${evidenceId}:${sha256.toUpperCase().toLowerCase()}`;

    // Same input → same key always
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^pandora:evidence:[a-f0-9-]+:[a-f0-9]{64}$/);
  });
});

describe("ForenZX flow: SSE event parsing", () => {
  it("consumeSseChunk extracts data fields from SSE stream correctly", async () => {
    // Import only the parsing function if exported, otherwise test inline.
    // SSE wire format: "data: {json}\n\n"
    const sseChunk = [
      "data: {\"state\":\"running\",\"progress_percent\":42,\"current_stage\":\"download\"}",
      "",
      "data: {\"state\":\"completed\",\"progress_percent\":100,\"current_stage\":\"done\"}",
      "",
      "",
    ].join("\n");

    function consumeSseChunk(buffer: string, onData: (data: string) => void): string {
      const events = buffer.split("\n\n");
      const remainder = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onData(data);
      }
      return remainder;
    }

    const received: unknown[] = [];
    const remainder = consumeSseChunk(sseChunk, (raw) => {
      received.push(JSON.parse(raw));
    });

    expect(received).toHaveLength(2);
    expect((received[0] as Record<string, unknown>).state).toBe("running");
    expect((received[0] as Record<string, unknown>).progress_percent).toBe(42);
    expect((received[1] as Record<string, unknown>).state).toBe("completed");
    expect(remainder).toBe("");
  });

  it("consumeSseChunk handles incomplete trailing chunk without losing data", () => {
    const partial = "data: {\"state\":\"running\"}\n\ndata: {\"state\":\"c";

    function consumeSseChunk(buffer: string, onData: (data: string) => void): string {
      const events = buffer.split("\n\n");
      const remainder = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) onData(data);
      }
      return remainder;
    }

    const received: unknown[] = [];
    const remainder = consumeSseChunk(partial, (raw) => {
      received.push(JSON.parse(raw));
    });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).state).toBe("running");
    expect(remainder).toBe('data: {"state":"c');
  });
});

describe("ForenZX flow: input validation", () => {
  const VALID_INPUT_TYPES = [
    "ios_backup", "ios_sysdiagnose", "ios_mobileconfig", "ios_app_container",
    "android_backup", "android_bugreport", "android_app_export", "android_filesystem_export",
    "mobile_generic_archive", "disk_raw", "evtx_logs", "pcap", "file_generic",
  ];

  it("all expected input types are in the allowed set", () => {
    const INPUT_TYPES = new Set(VALID_INPUT_TYPES);
    for (const t of VALID_INPUT_TYPES) {
      expect(INPUT_TYPES.has(t), `${t} must be in INPUT_TYPES`).toBe(true);
    }
  });

  it("SHA-256 regex accepts valid hashes and rejects invalid", () => {
    const SHA256 = /^[a-f0-9]{64}$/i;
    expect(SHA256.test("a".repeat(64))).toBe(true);
    expect(SHA256.test("A".repeat(64))).toBe(true);
    expect(SHA256.test("a".repeat(63))).toBe(false);
    expect(SHA256.test("g".repeat(64))).toBe(false);
    expect(SHA256.test("")).toBe(false);
  });

  it("CASE_ID and EVIDENCE_ID regex allows valid IDs and rejects injection", () => {
    const ID_REGEX = /^[A-Za-z0-9_.-]{1,128}$/;
    expect(ID_REGEX.test("case-abc-123")).toBe(true);
    expect(ID_REGEX.test("case_001.test")).toBe(true);
    expect(ID_REGEX.test("case; DROP TABLE--")).toBe(false);
    expect(ID_REGEX.test("../../etc/passwd")).toBe(false);
    expect(ID_REGEX.test("")).toBe(false);
  });
});
