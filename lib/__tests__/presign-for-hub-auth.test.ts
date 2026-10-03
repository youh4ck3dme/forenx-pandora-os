// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "ev-1", s3_object_key: "case/file.pdf", hash_verification_status: "verified" },
        error: null,
      }),
    }),
  },
}));

vi.mock("@/lib/forza/forenzx-evidence-presign.server", () => ({
  generateEvidencePresignedUrl: vi.fn().mockResolvedValue({
    url: "https://hel1.your-objectstorage.com/bucket/case/file.pdf?sig=ok",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    filename: "file.pdf",
    s3Key: "case/file.pdf",
  }),
}));

vi.mock("@/lib/forza/forenzx-download-guard", () => ({
  isValidDownloadUrl: vi.fn().mockReturnValue({ ok: true }),
}));

describe("POST /api/forenzx/presign-for-hub — auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, FORENZX_WEBHOOK_SECRET: "test-secret-value-32chars-exactly!!" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 401 with no auth", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3_object_key: "case/file.pdf" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong Bearer token", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-secret",
      },
      body: JSON.stringify({ s3_object_key: "case/file.pdf" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong x-forenzx-webhook-secret", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forenzx-webhook-secret": "wrong-secret",
      },
      body: JSON.stringify({ s3_object_key: "case/file.pdf" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects caller-supplied downloadUrl", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-value-32chars-exactly!!`,
      },
      body: JSON.stringify({
        s3_object_key: "case/file.pdf",
        downloadUrl: "https://evil.example.com/malware",
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/downloadUrl.*prohibited/i);
  });

  it("rejects caller-supplied bucket", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forenzx-webhook-secret": "test-secret-value-32chars-exactly!!",
      },
      body: JSON.stringify({ s3_object_key: "case/file.pdf", bucket: "attacker-bucket" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/bucket.*prohibited/i);
  });

  it("rejects path traversal in s3_object_key", async () => {
    const { POST } = await import("../../app/api/forenzx/presign-for-hub/route");
    const req = new NextRequest("http://localhost/api/forenzx/presign-for-hub", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer test-secret-value-32chars-exactly!!`,
      },
      body: JSON.stringify({ s3_object_key: "case/../../../etc/passwd" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/path traversal/i);
  });
});
