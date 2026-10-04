/**
 * Forensic & Research Screenshot Acquisition Model (Blueprint v1.0, Bod 15).
 *
 * Invariant:
 *  - Default screenshot = NON-EVIDENTIARY RESEARCH ARTIFACT.
 *  - Forensic Acquisition Flow:
 *      Acquire as Evidence → case selection (UUID) → source URL → capture timestamp (ISO)
 *      → browser metadata → PNG bytes → SHA-256 → evidence record / audit event
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const NON_EVIDENTIARY_STATUS = "NON_EVIDENTIARY_RESEARCH_ARTIFACT" as const;
export const FORENSIC_EVIDENCE_CANDIDATE_STATUS =
  "FORENSIC_EVIDENCE_CANDIDATE_PENDING_LEDGER_INGEST" as const;

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ResearchScreenshotResult {
  evidentiaryStatus: typeof NON_EVIDENTIARY_STATUS;
  filePath: string;
  fileName: string;
  capturedAt: string;
  sha256: string;
  fileSize: number;
}

export interface ForensicAcquisitionInput {
  caseId: string;
  title?: string;
  notes?: string;
}

export interface ForensicEvidenceRecord {
  /**
   * A local capture cannot be evidence until it is committed, server-verified,
   * and audited through the existing evidence ledger.
   */
  evidentiaryStatus: typeof FORENSIC_EVIDENCE_CANDIDATE_STATUS;
  caseId: string;
  evidenceId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: "image/png";
  sha256: string;
  sourceUrl: string;
  tabTitle: string;
  capturedAt: string;
  browserMetadata: {
    userAgent: string;
    viewport?: { width: number; height: number };
  };
  auditEvent: {
    action: "EVIDENCE_ACQUIRED_FROM_BROWSER";
    timestamp: string;
    details: string;
  };
}

export function computeSha256(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Default acquisition: plain research artifact, explicitly marked as non-evidentiary.
 */
export function createResearchArtifact(
  pngBuffer: Buffer,
  downloadsDir: string,
  date: Date = new Date(),
): ResearchScreenshotResult {
  const dateStr = date.toISOString().replace(/[:.]/g, "-");
  const sha256 = computeSha256(pngBuffer);
  const fileName = `research-screenshot-${dateStr}.png`;
  const filePath = path.join(downloadsDir, fileName);

  fs.writeFileSync(filePath, pngBuffer);

  return {
    evidentiaryStatus: NON_EVIDENTIARY_STATUS,
    filePath,
    fileName,
    capturedAt: date.toISOString(),
    sha256,
    fileSize: pngBuffer.byteLength,
  };
}

/**
 * Formal Forensic Acquisition Flow:
 * Requires verified case UUID, hashes PNG bytes, captures provenance metadata.
 */
export function createForensicEvidenceArtifact(
  pngBuffer: Buffer,
  input: ForensicAcquisitionInput,
  context: {
    sourceUrl: string;
    tabTitle?: string;
    userAgent: string;
    evidenceDir: string;
    viewport?: { width: number; height: number };
  },
  date: Date = new Date(),
): ForensicEvidenceRecord {
  if (!input.caseId || !UUID_REGEX.test(input.caseId)) {
    throw new Error("Neplatné caseId: Forenzná akvizícia vyžaduje platné UUID prípadu.");
  }

  const sha256 = computeSha256(pngBuffer);
  const evidenceId = crypto.randomUUID();
  const dateStr = date.toISOString().replace(/[:.]/g, "-");
  const safeTitle = (input.title || context.tabTitle || "screenshot")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  const fileName = `evidence-${safeTitle}-${dateStr}-${sha256.slice(0, 8)}.png`;
  const filePath = path.join(context.evidenceDir, fileName);

  fs.writeFileSync(filePath, pngBuffer);

  return {
    evidentiaryStatus: FORENSIC_EVIDENCE_CANDIDATE_STATUS,
    caseId: input.caseId,
    evidenceId,
    fileName,
    filePath,
    fileSize: pngBuffer.byteLength,
    mimeType: "image/png",
    sha256,
    sourceUrl: context.sourceUrl || "unknown",
    tabTitle: context.tabTitle || "Bez názvu",
    capturedAt: date.toISOString(),
    browserMetadata: {
      userAgent: context.userAgent,
      ...(context.viewport ? { viewport: context.viewport } : {}),
    },
    auditEvent: {
      action: "EVIDENCE_ACQUIRED_FROM_BROWSER",
      timestamp: date.toISOString(),
      details: `Zachytený forenzný screenshot z ${context.sourceUrl || "unknown"} s SHA-256: ${sha256}`,
    },
  };
}
