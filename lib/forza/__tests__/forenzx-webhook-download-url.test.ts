// @vitest-environment node
/**
 * ForenZX Download URL guard and presign-for-hub invariant tests.
 *
 * Covers:
 *  - isValidDownloadUrl / assertValidDownloadUrl reject forbidden URLs
 *  - POST /api/forenzx/presign-for-hub rejects caller-supplied downloadUrl
 *  - POST /api/forenzx/presign-for-hub rejects unverified evidence
 *  - POST /api/forenzx/presign-for-hub rejects keys not in ledger
 *  - POST /api/forenzx/presign-for-hub returns presigned URL for verified evidence
 *
 * Run with: npx vitest run lib/forza/__tests__/forenzx-webhook-download-url.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Test fixtures ────────────────────────────────────────────────────────────
const VALID_S3_KEY = "cases/22222222-2222-4222-8222-222222222222/evidence/dump.tar.gz";
const WEBHOOK_SECRET = "test-webhook-secret-value";

// ── Mock evidence row states ────────────────────────────────────────────────
let mockEvidenceRow: Record<string, unknown> | null = null;
let mockLookupError: { message: string } | null = null;

// ── Mocks ────────────────────────────────────────────────────────────────────
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = vi.fn();
  },
  GetObjectCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn(
    async () =>
      "https://s3.eu-central-1.amazonaws.com/forenx-vault/evidence/test-file.bin?X-Amz-Signature=abc123&expires=3600"
  ),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === "evidence_items") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: mockEvidenceRow,
                error: mockLookupError,
              }),
            }),
          }),
        };
      }
      return {};
    },
  },
}));

// ═══════════════════════════════════════════════════════════════════════════
// 1. Download URL Guard (lib/forza/forenzx-download-guard.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("isValidDownloadUrl", () => {
  let isValidDownloadUrl: typeof import("../forenzx-download-guard").isValidDownloadUrl;
  let assertValidDownloadUrl: typeof import("../forenzx-download-guard").assertValidDownloadUrl;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../forenzx-download-guard");
    isValidDownloadUrl = mod.isValidDownloadUrl;
    assertValidDownloadUrl = mod.assertValidDownloadUrl;
  });

  it("allows valid HTTPS URLs on known storage hosts", () => {
    const result = isValidDownloadUrl(
      "https://s3.eu-central-1.amazonaws.com/bucket/key?X-Amz-Signature=abc"
    );
    expect(result.ok).toBe(true);
    expect(result.host).toBe("s3.eu-central-1.amazonaws.com");
  });

  it("allows HTTPS URLs on R2 and custom endpoints", () => {
    expect(
      isValidDownloadUrl("https://my-bucket.r2.cloudflarestorage.com/key").ok
    ).toBe(true);
    expect(
      isValidDownloadUrl("https://minio.example.com:9000/bucket/key").ok
    ).toBe(true);
  });

  it("rejects HTTP protocol", () => {
    const result = isValidDownloadUrl("http://evil.com/payload.bin");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("HTTPS");
  });

  it("rejects empty / falsy URL", () => {
    expect(isValidDownloadUrl("").ok).toBe(false);
    // @ts-expect-error -- testing runtime guard
    expect(isValidDownloadUrl(null).ok).toBe(false);
    // @ts-expect-error -- testing runtime guard
    expect(isValidDownloadUrl(undefined).ok).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(isValidDownloadUrl("not-a-url").ok).toBe(false);
    expect(isValidDownloadUrl("://missing-scheme").ok).toBe(false);
  });

  it("rejects localhost", () => {
    const r = isValidDownloadUrl("https://localhost:8080/key");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Loopback");
  });

  it("rejects 127.0.0.1", () => {
    expect(isValidDownloadUrl("https://127.0.0.1/key").ok).toBe(false);
  });

  it("rejects IPv6 loopback [::1]", () => {
    expect(isValidDownloadUrl("https://[::1]/key").ok).toBe(false);
  });

  it("rejects .local and .localhost suffixes", () => {
    expect(isValidDownloadUrl("https://myhost.local/key").ok).toBe(false);
    expect(isValidDownloadUrl("https://evil.localhost/key").ok).toBe(false);
  });

  it("rejects private IP 10.x.x.x (RFC 1918)", () => {
    const r = isValidDownloadUrl("https://10.0.0.5/key");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Private IP");
  });

  it("rejects private IP 172.16-31.x.x (RFC 1918)", () => {
    expect(isValidDownloadUrl("https://172.16.0.1/key").ok).toBe(false);
    expect(isValidDownloadUrl("https://172.31.255.1/key").ok).toBe(false);
    // 172.32 is public, should pass
    expect(isValidDownloadUrl("https://172.32.0.1/key").ok).toBe(true);
  });

  it("rejects private IP 192.168.x.x (RFC 1918)", () => {
    expect(isValidDownloadUrl("https://192.168.1.1/key").ok).toBe(false);
  });

  it("rejects link-local 169.254.x.x (RFC 3927 / IMDS)", () => {
    expect(isValidDownloadUrl("https://169.254.169.254/metadata").ok).toBe(false);
  });

  it("rejects embedded credentials in URL", () => {
    const r = isValidDownloadUrl("https://user:pass@s3.example.com/key");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("credentials");
  });

  it("rejects foreign hosts when allowedHosts is provided", () => {
    const r = isValidDownloadUrl("https://evil-bucket.attacker.com/key", [
      "s3.eu-central-1.amazonaws.com",
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Foreign host");
  });

  it("allows subdomain match on allowed hosts", () => {
    const r = isValidDownloadUrl(
      "https://my-bucket.s3.eu-central-1.amazonaws.com/key",
      ["s3.eu-central-1.amazonaws.com"]
    );
    expect(r.ok).toBe(true);
  });

  it("assertValidDownloadUrl throws on invalid URL", () => {
    expect(() => assertValidDownloadUrl("http://bad.com/key")).toThrow(
      "Security validation failed"
    );
  });

  it("assertValidDownloadUrl does not throw on valid URL", () => {
    expect(() =>
      assertValidDownloadUrl("https://s3.example.com/key")
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. POST /api/forenzx/presign-for-hub invariants
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/forenzx/presign-for-hub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLookupError = null;
    mockEvidenceRow = {
      id: "11111111-1111-4111-8111-111111111111",
      s3_object_key: VALID_S3_KEY,
      hash_verification_status: "verified",
    };

    process.env.FORENZX_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.FORENZX_S3_REGION = "eu-central-1";
    process.env.FORENZX_S3_ACCESS_KEY_ID = "AKIATEST";
    process.env.FORENZX_S3_SECRET_ACCESS_KEY = "test-secret";
    process.env.FORENZX_S3_BUCKET = "forenx-vault-test";
    process.env.FORENZX_PRESIGNED_EXPIRY_SECONDS = "3600";
  });

  function makeRequest(body: unknown, secret = WEBHOOK_SECRET) {
    return new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forenzx-webhook-secret": secret,
      },
      body: JSON.stringify(body),
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );
    const request = makeRequest({ s3_object_key: VALID_S3_KEY }, "wrong-secret");
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("rejects request containing caller-supplied downloadUrl with 400", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    const request = makeRequest({
      s3_object_key: VALID_S3_KEY,
      downloadUrl: "https://evil.com/payload",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("downloadUrl");
    expect(body.error).toContain("prohibited");
  });

  it("rejects request containing caller-supplied download_url with 400", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    const request = makeRequest({
      s3_object_key: VALID_S3_KEY,
      download_url: "https://evil.com/payload",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("rejects s3_object_key not found in evidence ledger with 404", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    mockEvidenceRow = null;

    const request = makeRequest({ s3_object_key: "unknown/key.bin" });
    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  it("rejects unverified evidence with 403", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    mockEvidenceRow = {
      ...mockEvidenceRow,
      hash_verification_status: "checking",
    };

    const request = makeRequest({ s3_object_key: VALID_S3_KEY });
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("rejects path traversal in s3_object_key with 400", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    const request = makeRequest({
      s3_object_key: "cases/../../../etc/passwd",
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("path traversal");
  });

  it("returns presigned URL for verified ledger evidence item (200)", async () => {
    const { POST } = await import(
      "../../../app/api/forenzx/presign-for-hub/route"
    );

    const request = makeRequest({ s3_object_key: VALID_S3_KEY });
    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      download_url: string;
      expires_at: string;
      filename: string;
      s3_key: string;
    };
    expect(body.download_url).toContain("https://");
    expect(body.download_url).toContain("X-Amz-Signature");
    expect(body.filename).toBe("dump.tar.gz");
    expect(body.s3_key).toBe(VALID_S3_KEY);
    expect(body.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
