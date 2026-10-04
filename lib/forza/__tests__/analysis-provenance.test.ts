import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertAnalysisProvenance, buildAnalysisMeta } from "../autopilot-meta";

const T1 = "extracted text T1";
const T2 = "extracted text T2";
const H1 = "a".repeat(64);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function metaFor(text: string) {
  return buildAnalysisMeta({
    caseId: "case-1",
    documentIds: ["e1"],
    inputChars: text.length,
    analyzedChars: text.length,
    chunkCount: 1,
    chunks: [],
    model: "test-model",
    provider: "test-provider",
    idempotencyKey: "run-1",
    analysisStatus: "complete",
    sourceReferences: [],
    evidenceInputs: [{ evidenceId: "e1", sha256: H1 }],
    derivedInputSha256: digest(text),
    promptSha256: digest("2026.09.2"),
  });
}

describe("analysis provenance", () => {
  it("keeps the original derived-input digest after later extraction drift", () => {
    const findingMeta = metaFor(T1);
    const later = digest(T2);
    expect(findingMeta.derivedInputSha256).toBe(digest(T1));
    expect(findingMeta.derivedInputSha256).not.toBe(later);
    expect(findingMeta.evidenceInputs).toEqual([{ evidenceId: "e1", sha256: H1 }]);
    expect(() => assertAnalysisProvenance(findingMeta, ["e1"])).not.toThrow();
  });

  it("fails closed when a cited finding has no evidence or input digest", () => {
    const bare = buildAnalysisMeta({
      caseId: "case-1",
      documentIds: ["e1"],
      inputChars: 1,
      analyzedChars: 1,
      chunkCount: 1,
      chunks: [],
      model: "test-model",
      idempotencyKey: "run-1",
      analysisStatus: "complete",
      sourceReferences: [],
    });
    expect(() => assertAnalysisProvenance(bare, ["e1"])).toThrow(/incomplete/);
  });

  it("rejects rebinding the finding to a different evidence id", () => {
    const findingMeta = metaFor(T1);
    expect(() => assertAnalysisProvenance(findingMeta, ["e2"])).toThrow(/incomplete/);
  });
});
