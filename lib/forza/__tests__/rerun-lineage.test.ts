import { describe, expect, it, vi } from "vitest";
import { handleSaveCaseDossier } from "../ai.functions";
import { authoritativeFindingSha256, withRerunLineage } from "../autopilot-meta";

function dossier(runId: string, text: string, derived = "d1") {
  return {
    caseId: "case-1",
    caseTitle: "Spis",
    generatedAt: "2026-10-05T00:00:00.000Z",
    analysisMeta: {
      promptVersion: "2026.09.2",
      promptSha256: "b".repeat(64),
      model: runId === "run-1" ? "model-1" : "model-2",
      provider: "test-provider",
      evidenceInputs: [{ evidenceId: "e1", sha256: "a".repeat(64) }],
      derivedInputSha256: derived.padEnd(64, "0"),
      createdAt: "2026-10-05T00:00:00.000Z",
      analysisStatus: "complete" as const,
      documentIds: ["e1"],
      sourceReferences: [],
      idempotencyKey: runId,
      truncation: { inputChars: 1, analyzedChars: 1, truncated: false, chunkCount: 1, chunkLimit: 1, documentLimit: 1 },
      chunks: [],
    },
    facts: { timeline: [{ title: text, sourceRef: { evidenceId: "e1" } }], traces: [] },
    defenseAttack: { overallRisk: "NÍZKE" as const, attacks: [] },
    evidenceStrength: { traces: [], paragraphs: [] },
    judgeReadyText: { summary: text },
  };
}

describe("analysis rerun lineage", () => {
  it("keeps R1 reconstructable after R2 replaces the active dossier", () => {
    const r1 = dossier("run-1", "P1");
    const r2 = withRerunLineage(r1, dossier("run-2", "P2", "d2"));
    const previous = r2.analysisMeta?.lineage?.[0];
    expect(r2.analysisMeta?.idempotencyKey).toBe("run-2");
    expect(r2.analysisMeta?.supersedesRunId).toBe("run-1");
    expect(previous?.runId).toBe("run-1");
    expect(previous?.finding).toMatchObject({ judgeReadyText: { summary: "P1" } });
    expect(previous?.resultSha256).toBe(authoritativeFindingSha256(r1));
    expect(previous?.derivedInputSha256).not.toBe(r2.analysisMeta?.derivedInputSha256);
  });

  it("gives a same-evidence rerun a distinct run identity", () => {
    const r1 = dossier("run-1", "P1");
    const r2 = withRerunLineage(r1, dossier("run-2", "P1-again"));
    expect(r2.analysisMeta?.idempotencyKey).not.toBe(r1.analysisMeta.idempotencyKey);
    expect(r2.analysisMeta?.lineage?.[0]?.runId).toBe("run-1");
  });

  it("rejects a client rewrite of historical lineage", async () => {
    const current = withRerunLineage(dossier("run-1", "P1"), dossier("run-2", "P2"));
    const forged = structuredClone(current);
    forged.analysisMeta!.lineage = [];
    const update = vi.fn();
    const client = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { forensic_dossier: current }, error: null }) }) }),
        update,
      }),
    };
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: forged as never }, client as never)).rejects.toThrow(/rewritten/);
    expect(update).not.toHaveBeenCalled();
  });
});
