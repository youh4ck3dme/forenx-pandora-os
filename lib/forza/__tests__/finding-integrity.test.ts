import { describe, expect, it, vi } from "vitest";
import { handleSaveCaseDossier } from "../ai.functions";

const meta = {
  promptVersion: "2026.09.2",
  promptSha256: "b".repeat(64),
  model: "test-model",
  provider: "test-provider",
  evidenceInputs: [{ evidenceId: "e1", sha256: "a".repeat(64) }],
  derivedInputSha256: "c".repeat(64),
  resultSha256: "e".repeat(64),
  createdAt: "2026-10-05T00:00:00.000Z",
  analysisStatus: "complete",
  documentIds: ["e1"],
  sourceReferences: [],
  idempotencyKey: "run-1",
  truncation: { inputChars: 1, analyzedChars: 1, truncated: false, chunkCount: 1, chunkLimit: 1, documentLimit: 1 },
  chunks: [],
};

function dossier(text: string, analysisMeta = meta, caseTitle = "Spis") {
  return {
    caseId: "case-1",
    caseTitle,
    defendabilityIndex: 1,
    generatedAt: "2026-10-05T00:00:00.000Z",
    analysisMeta,
    facts: { timeline: [{ title: text, sourceRef: { evidenceId: "e1" } }], traces: [] },
    defenseAttack: { overallRisk: "NÍZKE", attacks: [] },
    evidenceStrength: { traces: [], paragraphs: [] },
    judgeReadyText: { summary: "P1" },
  };
}

function supabase(stored: unknown) {
  const update = vi.fn(() => ({ eq: () => ({ select: async () => ({ data: [{ id: "case-1" }], error: null }) }) }));
  return {
    update,
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { forensic_dossier: stored }, error: null }) }) }),
        update,
      }),
    },
  };
}

describe("authoritative finding integrity", () => {
  it("rejects a post-run finding rewrite that keeps run R1", async () => {
    const db = supabase(dossier("P1"));
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: dossier("P2") as never }, db.client as never)).rejects.toThrow(/same analysis run/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a partial severity change under the same run", async () => {
    const stored = dossier("P1");
    const partial = dossier("P1");
    partial.defenseAttack = { overallRisk: "KRITICKÉ", attacks: [] };
    const db = supabase(stored);
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: partial as never }, db.client as never)).rejects.toThrow(/same analysis run/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("still allows a presentation-only title change", async () => {
    const db = supabase(dossier("P1"));
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: dossier("P1", meta, "Nový názov") as never }, db.client as never)).resolves.toMatchObject({ success: true });
    expect(db.update).toHaveBeenCalled();
  });

  it("rejects binding another run result to R1 provenance", async () => {
    const db = supabase(dossier("P1"));
    const other = dossier("P2", { ...meta, idempotencyKey: "run-2" });
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: other as never }, db.client as never)).rejects.toThrow(/rewritten|same analysis run/);
    expect(db.update).not.toHaveBeenCalled();
  });
});
