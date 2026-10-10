// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  bindAuthoritativeEvidenceMetadata,
  validateReportSources,
} from "../ai/asset-timeline-engine";
import type { ForensicAssetCorrelationReport } from "../ai/asset-timeline-schema";
import { createHash } from "node:crypto";
import { loadLedgerDocuments } from "../evidence-source";

const binding = [{ evidenceId: "evidence-1", sha256: "a".repeat(64) }];
const report = {
  caseExecutiveSummary: "test",
  temporalCorridors: [{
    corridorId: "c1", severity: "LOW", precision: "UNKNOWN", timeDeltaHours: null,
    forensicPattern: "EXIT_PRED_RAZIOU_A_VYBEROM", forensicDeduction: "test",
    primaryTransaction: {
      date: "2026-01-01", amount: 1, currency: "EUR", sender: "A", receiver: "B", description: "x",
      evidenceQuote: "Dostatočne dlhá citácia dôkazu", sourceEvidenceId: "evidence-1",
      sourcePage: 99, sourceParagraph: "99", sourceSha256: "b".repeat(64),
    },
    corporateOrCadastralAction: {
      actionDate: "2026-01-02", registryType: "ORSR", actionType: "VYMAZ_STATUTARA", affectedEntity: "B",
      evidenceQuote: "Dostatočne dlhá citácia akcie", sourceEvidenceId: "evidence-1",
      sourcePage: 100, sourceParagraph: "100", sourceSha256: "b".repeat(64),
    },
  }],
  nomineeRiskEntities: [{
    fullName: "A", role: "director", company: "B", strawManIndicators: [], riskScore: 1,
    sourceEvidenceQuote: "Dostatočne dlhá citácia osoby", sourceEvidenceId: "evidence-1",
    sourcePage: 101, sourceParagraph: "101", sourceSha256: "b".repeat(64), classification: "INDICATOR",
  }],
  legalAssessment: {
    suggestedQualification: "x", subjectiveAspectAssessment: "x", objectiveAspectAssessment: "x",
    confidence: "LOW", status: "SUPPORTED", sourceReferences: [{ evidenceId: "evidence-1", evidenceQuote: "Dostatočne dlhá citácia právneho záveru", page: 1, paragraph: "1", sha256: "b".repeat(64) }],
  },
  proceduralActions: [{ section: "x", target: "x", justification: "x", status: "SUGGESTED", sourceReferences: [{ evidenceId: "evidence-1", evidenceQuote: "Dostatočne dlhá citácia procesného kroku", page: 1, paragraph: "1", sha256: "b".repeat(64) }] }],
} as ForensicAssetCorrelationReport;

describe("runAssetTimelineForensics server invariants", () => {
  const bytes = Buffer.from("server extracted evidence text");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ledgerRow = (overrides: Record<string, unknown> = {}) => ({
    id: "evidence-1", file_name: "evidence.txt", file_size: bytes.byteLength,
    sha256_hash: sha256, s3_object_key: "cases/case-1/evidence/evidence.txt", hash_verification_status: "verified", ...overrides,
  });
  const ledgerDeps = (row: ReturnType<typeof ledgerRow>, object = bytes) => ({
    fetchRows: async () => [row],
    download: async () => object,
    extract: async () => object.toString("utf8"),
  });

  it("rejects unknown evidence", async () => {
    const result = await loadLedgerDocuments("case-1", ["missing"], { ...ledgerDeps(ledgerRow()), fetchRows: async () => [] });
    expect(result.rejected[0]?.reason).toBe("not_found");
  });

  it("rejects evidence belonging to another case", async () => {
    const result = await loadLedgerDocuments("case-1", ["evidence-1"], ledgerDeps(ledgerRow({ s3_object_key: "cases/other/evidence/evidence.txt" })));
    expect(result.rejected[0]?.reason).toBe("other_case");
  });

  it("rejects unverified evidence", async () => {
    const result = await loadLedgerDocuments("case-1", ["evidence-1"], ledgerDeps(ledgerRow({ hash_verification_status: "pending" })));
    expect(result.rejected[0]?.reason).toBe("not_verified");
  });

  it("rejects stored-byte hash mismatch", async () => {
    const result = await loadLedgerDocuments("case-1", ["evidence-1"], ledgerDeps(ledgerRow(), Buffer.from("tampered")));
    expect(result.rejected[0]?.reason).toBe("hash_mismatch");
  });

  it("accepts verified evidence with matching stored bytes", async () => {
    const result = await loadLedgerDocuments("case-1", ["evidence-1"], ledgerDeps(ledgerRow()));
    expect(result.rejected).toEqual([]);
    expect(result.documents[0]).toMatchObject({ evidenceId: "evidence-1", sha256, fileSize: bytes.byteLength });
  });

  it("overwrites model hashes with the verified ledger hash", () => {
    const result = bindAuthoritativeEvidenceMetadata(report, binding);
    expect(result.temporalCorridors[0].primaryTransaction.sourceSha256).toBe("a".repeat(64));
    expect(result.temporalCorridors[0].corporateOrCadastralAction.sourceSha256).toBe("a".repeat(64));
    expect(result.nomineeRiskEntities[0].sourceSha256).toBe("a".repeat(64));
    expect(result.legalAssessment.sourceReferences[0].sha256).toBe("a".repeat(64));
  });

  it("strips unverified page and paragraph locators", () => {
    const result = bindAuthoritativeEvidenceMetadata(report, binding);
    expect(result.temporalCorridors[0].primaryTransaction).not.toHaveProperty("sourcePage");
    expect(result.temporalCorridors[0].primaryTransaction).not.toHaveProperty("sourceParagraph");
    expect(result.legalAssessment.sourceReferences[0]).not.toHaveProperty("page");
  });

  it("does not trust a hash for an unknown evidence id", () => {
    const altered = { ...report, nomineeRiskEntities: [{ ...report.nomineeRiskEntities[0], sourceEvidenceId: "unknown", sourceSha256: "b".repeat(64) }] };
    const result = bindAuthoritativeEvidenceMetadata(altered, binding);
    expect(result.nomineeRiskEntities[0]).not.toHaveProperty("sourceSha256");
  });

  it("keeps only source-backed report objects", () => {
    const filtered = validateReportSources(report, new Map([["evidence-1", "Dostatočne dlhá citácia dôkazu Dostatočne dlhá citácia akcie Dostatočne dlhá citácia osoby Dostatočne dlhá citácia právneho záveru Dostatočne dlhá citácia procesného kroku"]]));
    expect(filtered.temporalCorridors).toHaveLength(1);
  });
  it("downgrades legal and procedural claims without verifiable quotes", () => {
    const sources = new Map([["evidence-1", "Iný text dôkazu, ktorý nepodporuje právny ani procesný záver."]]);
    const filtered = validateReportSources(report, sources);
    expect(filtered.legalAssessment.status).toBe("UNVERIFIED");
    expect(filtered.legalAssessment.sourceReferences).toHaveLength(0);
    expect(filtered.proceduralActions[0]?.status).toBe("UNVERIFIED");
    expect(filtered.proceduralActions[0]?.sourceReferences).toHaveLength(0);
  });

  it("keeps supported legal/procedural claims only with literal quotes", () => {
    const sources = new Map([["evidence-1", "Dostatočne dlhá citácia právneho záveru ... Dostatočne dlhá citácia procesného kroku"]]);
    const filtered = validateReportSources(report, sources);
    expect(filtered.legalAssessment.status).toBe("SUPPORTED");
    expect(filtered.legalAssessment.sourceReferences).toHaveLength(1);
    expect(filtered.proceduralActions[0]?.status).toBe("SUGGESTED");
  });

});