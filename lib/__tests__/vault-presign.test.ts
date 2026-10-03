import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/vault/presign/route";

describe("Direct-to-S3 Presigned Upload API (/api/vault/presign)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, NODE_ENV: "test" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("rejects request with missing or empty caseId", async () => {
    const req = new NextRequest("http://localhost:3000/api/vault/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "",
        fileName: "spis.pdf",
        fileSizeBytes: 1024,
        mimeType: "application/pdf",
        sha256Hash: "a".repeat(64),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  it("rejects file exceeding 250 MB limit", async () => {
    const req = new NextRequest("http://localhost:3000/api/vault/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "CASE-KS-2026-881",
        fileName: "obrovsky_disk.dd",
        fileSizeBytes: 260 * 1024 * 1024, // 260 MB
        mimeType: "application/octet-stream",
        sha256Hash: "b".repeat(64),
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.[0]?.message).toContain("250 MB");
  });

  it("rejects invalid non-64-hex SHA-256 hash", async () => {
    const req = new NextRequest("http://localhost:3000/api/vault/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caseId: "CASE-KS-2026-881",
        fileName: "spis.pdf",
        fileSizeBytes: 5000,
        mimeType: "application/pdf",
        sha256Hash: "bad-hash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.details?.[0]?.message).toContain("SHA-256");
  });

  it("generates valid SigV4 presigned upload URL and deterministic storage key", async () => {
    const validHash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const caseId = "00000000-0000-4000-8000-000000000001";
    const req = new NextRequest("http://localhost:3000/api/vault/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-dev-user-id": "investigator-test-01",
      },
      body: JSON.stringify({
        caseId,
        fileName: "rozsudok.pdf",
        fileSizeBytes: 1048576,
        mimeType: "application/pdf",
        sha256Hash: validHash,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.uploadUrl).toBeDefined();
    expect(json.storageKey).toBe(
      `cases/${caseId}/evidence/${validHash}-rozsudok.pdf`,
    );
    expect(json.expiresInSeconds).toBe(300);
    expect(json.requiredHeaders["Content-Type"]).toBe("application/pdf");
  });
});
