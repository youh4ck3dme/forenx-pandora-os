import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  NON_EVIDENTIARY_STATUS,
  FORENSIC_EVIDENCE_CANDIDATE_STATUS,
  computeSha256,
  createResearchArtifact,
  createForensicEvidenceArtifact,
} from "../screenshot-acquisition";

describe("Screenshot Evidentiary Model (Blueprint v1.0 Bod 15)", () => {
  let tempDir: string;
  let samplePng: Buffer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pandora-screenshot-test-"));
    // Valid 1x1 PNG sample buffer
    samplePng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("Default Research Artifact", () => {
    it("marks default screenshot strictly as NON_EVIDENTIARY_RESEARCH_ARTIFACT", () => {
      const fixedDate = new Date("2026-10-04T08:00:00.000Z");
      const result = createResearchArtifact(samplePng, tempDir, fixedDate);

      expect(result.evidentiaryStatus).toBe(NON_EVIDENTIARY_STATUS);
      expect(result.evidentiaryStatus).toBe("NON_EVIDENTIARY_RESEARCH_ARTIFACT");
      expect(result.fileName).toContain("research-screenshot-");
      expect(result.sha256).toBe(computeSha256(samplePng));
      expect(result.fileSize).toBe(samplePng.byteLength);
      expect(fs.existsSync(result.filePath)).toBe(true);

      const savedBytes = fs.readFileSync(result.filePath);
      expect(computeSha256(savedBytes)).toBe(result.sha256);
    });
  });

  describe("Forensic Acquisition Flow", () => {
    const validCaseId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

    it("requires a valid UUID caseId and fails closed when missing or invalid", () => {
      const invalidInputs = [
        { caseId: "" },
        { caseId: "not-a-uuid" },
        { caseId: "12345" },
        { caseId: "../traversal" },
      ];

      for (const input of invalidInputs) {
        expect(() =>
          createForensicEvidenceArtifact(samplePng, input as any, {
            sourceUrl: "https://example.com/suspect",
            tabTitle: "Suspect Portal",
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Pandora/2.0",
            evidenceDir: tempDir,
          }),
        ).toThrow(/Neplatné caseId/);
      }
    });

    it("successfully creates a forensic evidence record bound to case with SHA-256 and metadata", () => {
      const fixedDate = new Date("2026-10-04T08:15:00.000Z");
      const record = createForensicEvidenceArtifact(
        samplePng,
        {
          caseId: validCaseId,
          title: "Bankový prevod podozrivého",
          notes: "Zachytená transakčná obrazovka",
        },
        {
          sourceUrl: "https://banking.example.com/tx/987654",
          tabTitle: "Prehľad transakcií — Internet Banking",
          userAgent: "Mozilla/5.0 Pandora/2.0 ForensicBrowser",
          evidenceDir: tempDir,
          viewport: { width: 1920, height: 1080 },
        },
        fixedDate,
      );

      expect(record.evidentiaryStatus).toBe(FORENSIC_EVIDENCE_CANDIDATE_STATUS);
      expect(record.evidentiaryStatus).toBe("FORENSIC_EVIDENCE_CANDIDATE_PENDING_LEDGER_INGEST");
      expect(record.caseId).toBe(validCaseId);
      expect(record.evidenceId).toMatch(
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      );
      expect(record.mimeType).toBe("image/png");
      expect(record.sha256).toBe(computeSha256(samplePng));
      expect(record.sourceUrl).toBe("https://banking.example.com/tx/987654");
      expect(record.tabTitle).toBe("Prehľad transakcií — Internet Banking");
      expect(record.capturedAt).toBe(fixedDate.toISOString());
      expect(record.browserMetadata.userAgent).toContain("Pandora/2.0");
      expect(record.browserMetadata.viewport).toEqual({ width: 1920, height: 1080 });

      // Audit event
      expect(record.auditEvent.action).toBe("EVIDENCE_ACQUIRED_FROM_BROWSER");
      expect(record.auditEvent.details).toContain(record.sha256);
      expect(record.auditEvent.details).toContain(record.sourceUrl);

      // File integrity
      expect(fs.existsSync(record.filePath)).toBe(true);
      const onDisk = fs.readFileSync(record.filePath);
      expect(computeSha256(onDisk)).toBe(record.sha256);
    });

    it("ensures tampered bytes mismatch the expected ledger SHA-256", () => {
      const originalSha = computeSha256(samplePng);
      const tamperedPng = Buffer.concat([samplePng, Buffer.from([0x00, 0xff])]);
      const tamperedSha = computeSha256(tamperedPng);

      expect(tamperedSha).not.toBe(originalSha);
    });
  });
});
