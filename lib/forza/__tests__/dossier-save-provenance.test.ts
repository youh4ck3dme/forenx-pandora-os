import { describe, expect, it, vi } from "vitest";
import { handleSaveCaseDossier } from "../ai.functions";

const meta = {
  promptVersion: "2026.09.2",
  promptSha256: "b".repeat(64),
  model: "test-model",
  provider: "test-provider",
  evidenceInputs: [{ evidenceId: "e1", sha256: "a".repeat(64) }],
  derivedInputSha256: "c".repeat(64),
  createdAt: "2026-10-05T00:00:00.000Z",
  analysisStatus: "complete",
  documentIds: ["e1"],
  sourceReferences: [],
  idempotencyKey: "run-1",
  truncation: { inputChars: 1, analyzedChars: 1, truncated: false, chunkCount: 1, chunkLimit: 1, documentLimit: 1 },
  chunks: [],
};

function dossier(evidenceId: string, analysisMeta = meta) {
  return {
    caseId: "case-1",
    caseTitle: "Spis",
    defendabilityIndex: 1,
    generatedAt: "2026-10-05T00:00:00.000Z",
    analysisMeta,
    facts: { timeline: [{ sourceRef: { evidenceId } }], traces: [] },
    defenseAttack: { attacks: [] },
    evidenceStrength: { traces: [], paragraphs: [] },
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

describe("dossier save provenance", () => {
  it("allows the owner to save the same evidence binding", async () => {
    const db = supabase(dossier("e1"));
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: dossier("e1") as never }, db.client as never)).resolves.toMatchObject({ success: true });
    expect(db.update).toHaveBeenCalled();
  });

  it("rejects rebinding a finding from e1 to e2", async () => {
    const db = supabase(dossier("e1"));
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: dossier("e2") as never }, db.client as never)).rejects.toThrow(/incomplete|same analysis run/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("rejects a rewritten analysis meta", async () => {
    const db = supabase(dossier("e1"));
    const forged = dossier("e1", { ...meta, evidenceInputs: [{ evidenceId: "e2", sha256: "d".repeat(64) }] });
    await expect(handleSaveCaseDossier({ caseId: "case-1", dossier: forged as never }, db.client as never)).rejects.toThrow(/rewritten/);
    expect(db.update).not.toHaveBeenCalled();
  });
});
