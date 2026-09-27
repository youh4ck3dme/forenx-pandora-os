import { describe, it, expect } from "vitest";
import {
  CaseIdSchema,
  EvidenceIdSchema,
  Sha256HashSchema,
  ForensicEvidenceItemSchema,
  ok,
  err,
} from "../forza/vault-types";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/vault/route";

describe("Forensic Evidence Vault (Hetzner S3 & Types)", () => {
  describe("Zod & Branded Type Validation", () => {
    it("validates and brands valid SHA-256 hashes in lower case", () => {
      const validHash = "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855";
      const parsed = Sha256HashSchema.parse(validHash);
      expect(parsed).toBe(validHash.toLowerCase());
    });

    it("rejects invalid SHA-256 hash strings", () => {
      expect(() => Sha256HashSchema.parse("invalid-short-hash")).toThrow();
      expect(() => Sha256HashSchema.parse("g".repeat(64))).toThrow();
    });

    it("validates and brands CaseId", () => {
      const parsed = CaseIdSchema.parse("CASE-KS-2026-881");
      expect(parsed).toBe("CASE-KS-2026-881");
    });

    it("validates full ForensicEvidenceItemSchema", () => {
      const sample = {
        id: "ev-12345",
        caseId: "CASE-KS-2026-881",
        fileName: "rozsudok.pdf",
        fileSizeBytes: 1024,
        mimeType: "application/pdf",
        sha256Hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        s3StorageKey: "cases/CASE-KS-2026-881/documents/test.pdf",
        s3Bucket: "forenx-vault-sk",
        uploadedAt: new Date().toISOString(),
        uploadedBy: "investigator-test",
        integrityStatus: "verified" as const,
        aiAnalyzed: false,
        tags: ["zmluva" as const],
      };

      const parsed = ForensicEvidenceItemSchema.parse(sample);
      expect(parsed.fileName).toBe("rozsudok.pdf");
      expect(parsed.integrityStatus).toBe("verified");
    });

    it("supports Result pattern helpers ok and err", () => {
      const success = ok({ evidenceCount: 5 });
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.value.evidenceCount).toBe(5);
      }

      const failure = err({ kind: "IntegrityMismatch" as const, clientHash: "a", serverHash: "b" });
      expect(failure.ok).toBe(false);
      if (!failure.ok) {
        expect(failure.error.kind).toBe("IntegrityMismatch");
      }
    });
  });

  describe("Vault API Route Handler", () => {
    it("GET /api/vault returns 400 when caseId is missing", async () => {
      const req = new NextRequest("http://localhost:3000/api/vault");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it("GET /api/vault?caseId=CASE-001 returns empty item list for new case", async () => {
      const req = new NextRequest("http://localhost:3000/api/vault?caseId=CASE-001");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.caseId).toBe("CASE-001");
      expect(json.items).toEqual([]);
    });

    it("fails closed when production S3 credentials are absent", async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, NODE_ENV: "production" };
      delete process.env.S3_ACCESS_KEY_ID;
      delete process.env.S3_SECRET_ACCESS_KEY;
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      try {
        const req = new NextRequest("http://localhost:3000/api/vault?caseId=CASE-001");
        const res = await GET(req);
        expect(res.status).toBe(503);
      } finally {
        process.env = originalEnv;
      }
    });

    it("POST /api/vault rejects upload with integrity mismatch (Anti-tampering CWE-345)", async () => {
      const formData = new FormData();
      formData.append("file", new Blob(["tajny obsah spisu"], { type: "application/pdf" }), "zmluva.pdf");
      formData.append("caseId", "CASE-KS-2026");
      formData.append("clientSha256", "0".repeat(64)); // Fake / mismatched hash

      const mockReq = {
        formData: async () => formData,
      } as unknown as NextRequest;

      const res = await POST(mockReq);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("KRITICKÉ ZLYHANIE INTEGRITY");
    });

    it("POST /api/vault accepts valid upload when SHA-256 matches and returns verified evidence item", async () => {
      const crypto = await import("node:crypto");
      const content = "doverny sudny material 2026";
      const realHash = crypto.createHash("sha256").update(Buffer.from(content)).digest("hex");

      const formData = new FormData();
      formData.append("file", new Blob([content], { type: "application/pdf" }), "zmluva_platna.pdf");
      formData.append("caseId", "CASE-KS-2026-881");
      formData.append("clientSha256", realHash);

      const mockReq = {
        formData: async () => formData,
      } as unknown as NextRequest;

      const res = await POST(mockReq);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.item.fileName).toBe("zmluva_platna.pdf");
      expect(json.item.sha256Hash).toBe(realHash);
      expect(json.item.integrityStatus).toBe("verified");
    });

    it("GET /api/vault generates fresh on-demand presigned URL (solves Flaw 4)", async () => {
      const req = new NextRequest("http://localhost:3000/api/vault?storageKey=cases/CASE-001/doc.pdf&action=presign");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.url).toBeDefined();
      expect(json.expiresIn).toBe(300);
    });
  });
});
