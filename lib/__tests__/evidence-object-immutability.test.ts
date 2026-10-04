// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearVaultFallback,
  deleteCaseVault,
  downloadCaseDocument,
  getPresignedUploadUrl,
  setEvidenceKeyStateLookup,
  uploadCaseDocument,
  type EvidenceObjectState,
} from "../storage/s3-vault";

const ORIGINAL = Buffer.from("ORIGINAL-EVIDENCE-BYTES");
const TAMPERED = Buffer.from("TAMPERED-EVIDENCE-BYTES");
const ORIGINAL_HASH = createHash("sha256").update(ORIGINAL).digest("hex");

function states(map: Record<string, EvidenceObjectState>) {
  setEvidenceKeyStateLookup(async (key) => map[key] ?? "absent");
}

describe("authoritative evidence object immutability", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    clearVaultFallback();
    setEvidenceKeyStateLookup(null);
  });

  afterEach(() => {
    process.env = originalEnv;
    clearVaultFallback();
    setEvidenceKeyStateLookup(null);
  });

  it("stores original bytes and still allows a pending retry", async () => {
    const key = await uploadCaseDocument("case-1", {
      name: "spis.bin",
      buffer: ORIGINAL,
      mimeType: "application/octet-stream",
      sha256: ORIGINAL_HASH,
    }, { folder: "evidence" });
    expect((await downloadCaseDocument(key))?.buffer.equals(ORIGINAL)).toBe(true);
    states({ [key]: "pending" });
    await expect(uploadCaseDocument("case-1", {
      name: "spis.bin",
      buffer: ORIGINAL,
      mimeType: "application/octet-stream",
      sha256: ORIGINAL_HASH,
    }, { folder: "evidence" })).resolves.toBe(key);
    expect((await downloadCaseDocument(key))?.buffer.equals(ORIGINAL)).toBe(true);
  });

  it("rejects a same-key overwrite after the object is verified", async () => {
    const key = await uploadCaseDocument("case-1", {
      name: "spis.bin",
      buffer: ORIGINAL,
      mimeType: "application/octet-stream",
      sha256: ORIGINAL_HASH,
    }, { folder: "evidence" });
    states({ [key]: "verified" });
    await expect(uploadCaseDocument("case-1", {
      name: "spis.bin",
      buffer: ORIGINAL,
      mimeType: "application/octet-stream",
      sha256: ORIGINAL_HASH,
    }, { folder: "evidence" })).rejects.toThrow(/immutable/);
    await expect(getPresignedUploadUrl(key, { sha256: ORIGINAL_HASH })).rejects.toThrow(/immutable/);
    expect((await downloadCaseDocument(key))?.buffer.equals(ORIGINAL)).toBe(true);
    expect(TAMPERED.equals(ORIGINAL)).toBe(false);
  });

  it("blocks delete and recreate of a verified object", async () => {
    const key = await uploadCaseDocument("case-1", {
      name: "spis.bin",
      buffer: ORIGINAL,
      mimeType: "application/octet-stream",
      sha256: ORIGINAL_HASH,
    }, { folder: "evidence" });
    states({ [key]: "verified" });
    await expect(deleteCaseVault("case-1")).rejects.toThrow(/immutable/);
    expect((await downloadCaseDocument(key))?.buffer.equals(ORIGINAL)).toBe(true);
    await expect(getPresignedUploadUrl(key, { sha256: ORIGINAL_HASH })).rejects.toThrow(/immutable/);
  });
});
