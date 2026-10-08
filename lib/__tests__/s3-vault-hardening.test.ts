import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearVaultFallback,
  getPresignedDossierUrl,
  getS3Config,
  getPresignedUploadUrl,
  uploadCaseDocument,
} from "../storage/s3-vault";

describe("S3 vault hardening", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_ENDPOINT;
    clearVaultFallback();
  });

  afterEach(() => {
    process.env = originalEnv;
    clearVaultFallback();
  });

  it("rejects a claimed digest that does not match the uploaded bytes", async () => {
    await expect(
      uploadCaseDocument("CASE-001", {
        name: "evidence.pdf",
        buffer: Buffer.from("verified evidence"),
        mimeType: "application/pdf",
        sha256: "0".repeat(64),
      }),
    ).rejects.toThrow("nezodpovedá");
  });

  it("rejects unsafe case identifiers before constructing a storage key", async () => {
    const buffer = Buffer.from("verified evidence");
    const digest = crypto.createHash("sha256").update(buffer).digest("hex");

    await expect(
      uploadCaseDocument("../CASE-001", {
        name: "evidence.pdf",
        buffer,
        mimeType: "application/pdf",
        sha256: digest,
      }),
    ).rejects.toThrow("Case ID");
  });

  it("rejects traversal storage keys and out-of-range URL expirations", async () => {
    await expect(
      getPresignedDossierUrl("cases/CASE-001/documents/../outside.pdf", 300),
    ).rejects.toThrow("nebezpečný storageKey");
    await expect(
      getPresignedDossierUrl("cases/CASE-001/documents/evidence.pdf", 0),
    ).rejects.toThrow("1 až 604800");
  });

  it("binds content integrity headers into a presigned upload", async () => {
    process.env.S3_ENDPOINT = "https://s3.test.invalid";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    const digest = crypto.createHash("sha256").update("evidence").digest("hex");

    const url = await getPresignedUploadUrl(
      `cases/CASE-001/evidence/${digest}-evidence.pdf`,
      {
        mimeType: "application/pdf",
        sha256: digest,
        metadata: { "case-id": "CASE-001", "sha256-checksum": digest },
      },
    );

    expect(url).toContain(
      "X-Amz-SignedHeaders=content-type%3Bhost%3Bx-amz-content-sha256%3Bx-amz-meta-case-id%3Bx-amz-meta-sha256-checksum",
    );
  });

  it("ignores ambient AWS_* credentials and never defaults to the production vault endpoint", () => {
    delete process.env.S3_ENDPOINT;
    process.env.AWS_ACCESS_KEY_ID = "AKIAUNRELATED";
    process.env.AWS_SECRET_ACCESS_KEY = "unrelated-secret";
    expect(getS3Config()).toBeNull();

    process.env.S3_ACCESS_KEY_ID = "vault-key";
    process.env.S3_SECRET_ACCESS_KEY = "vault-secret";
    expect(getS3Config()).toBeNull();

    process.env.S3_ENDPOINT = "https://s3.test.invalid/";
    expect(getS3Config()).toMatchObject({ endpoint: "https://s3.test.invalid", accessKeyId: "vault-key" });
  });
});
