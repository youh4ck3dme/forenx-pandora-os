// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearVaultFallback,
  getPresignedDossierUrl,
  getPresignedUploadUrl,
  uploadCaseDocument,
  verifyFallbackSignature,
} from "../storage/s3-vault";

const S3_VARS = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];

function params(url: string) {
  const parsed = new URL(url);
  return {
    expires: Number(parsed.searchParams.get("expires")),
    sig: parsed.searchParams.get("sig") ?? "",
  };
}

describe("vault fallback signatures", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const name of S3_VARS) delete process.env[name];
    (process.env as Record<string, string>).NODE_ENV = "test";
    process.env.VAULT_FALLBACK_SECRET = "x".repeat(40);
    clearVaultFallback();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearVaultFallback();
  });

  it("signs with a keyed HMAC that verifies and cannot be recomputed without the secret", async () => {
    const url = await getPresignedDossierUrl("cases/c1/doc.pdf", 300);
    const { expires, sig } = params(url);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyFallbackSignature("get", "cases/c1/doc.pdf", expires, sig)).toBe(true);

    // Other key, purpose, object or expiry → rejected.
    expect(verifyFallbackSignature("put", "cases/c1/doc.pdf", expires, sig)).toBe(false);
    expect(verifyFallbackSignature("get", "cases/c2/doc.pdf", expires, sig)).toBe(false);
    expect(verifyFallbackSignature("get", "cases/c1/doc.pdf", expires + 1, sig)).toBe(false);
    process.env.VAULT_FALLBACK_SECRET = "y".repeat(40);
    expect(verifyFallbackSignature("get", "cases/c1/doc.pdf", expires, sig)).toBe(false);
  });

  it("rejects expired and malformed signatures", async () => {
    const url = await getPresignedUploadUrl("cases/c1/up.pdf", { expiresIn: 60 });
    const { expires, sig } = params(url);
    expect(verifyFallbackSignature("put", "cases/c1/up.pdf", expires, sig)).toBe(true);
    expect(verifyFallbackSignature("put", "cases/c1/up.pdf", expires, sig, expires + 1)).toBe(false);
    expect(verifyFallbackSignature("put", "cases/c1/up.pdf", expires, "abc")).toBe(false);
  });

  it("rejects a short configured secret", async () => {
    process.env.VAULT_FALLBACK_SECRET = "short";
    await expect(getPresignedDossierUrl("k", 60)).rejects.toThrow(/aspoň 32/);
  });

  it("fails hard in production when S3 is not configured", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    await expect(getPresignedDossierUrl("k", 60)).rejects.toThrow(/v produkcii zakázaný/);
    await expect(getPresignedUploadUrl("k")).rejects.toThrow(/v produkcii zakázaný/);
    await expect(
      uploadCaseDocument("case-1", {
        name: "a.pdf",
        buffer: Buffer.from("x"),
        mimeType: "application/pdf",
        sha256: "a".repeat(64),
      }),
    ).rejects.toThrow(/v produkcii zakázaný/);
  });
});
