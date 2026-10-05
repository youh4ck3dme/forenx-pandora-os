import { authoritativeFindingSha256 } from "@/lib/forza/autopilot-meta";

export type CourtAnalysisProvenance = {
  selectedRunId: string;
  findingSha256: string;
  evidence: { evidenceId: string; sha256: string }[];
  derivedInputSha256: string;
  promptVersion: string;
  promptSha256: string;
  provider: string | null;
  model: string;
  generatedAt: string;
  supersedesRunId: string | null;
};

type LedgerHash = { id: string; sha256_hash: string; hash_verification_status: string };

export function buildCourtAnalysisProvenance(
  dossier: Record<string, unknown> | null,
  ledger: readonly LedgerHash[],
): { ok: true; record: CourtAnalysisProvenance | null } | { ok: false; reason: string } {
  const meta = dossier?.analysisMeta as Record<string, unknown> | undefined;
  if (!dossier || !meta) return { ok: true, record: null };
  const runId = typeof meta.idempotencyKey === "string" ? meta.idempotencyKey : "";
  const derived = typeof meta.derivedInputSha256 === "string" ? meta.derivedInputSha256 : "";
  const promptVersion = typeof meta.promptVersion === "string" ? meta.promptVersion : "";
  const promptSha = typeof meta.promptSha256 === "string" ? meta.promptSha256 : "";
  const model = typeof meta.model === "string" ? meta.model : "";
  const storedHash = typeof meta.resultSha256 === "string" ? meta.resultSha256 : "";
  const actualHash = authoritativeFindingSha256(dossier);
  if (!runId || !derived || !promptVersion || !promptSha || !model || storedHash !== actualHash) {
    return { ok: false, reason: "analysis provenance does not match the selected finding" };
  }
  const inputs = Array.isArray(meta.evidenceInputs) ? meta.evidenceInputs as { evidenceId?: string; sha256?: string }[] : [];
  const verified = new Map(ledger.filter((row) => row.hash_verification_status === "verified").map((row) => [row.id, row.sha256_hash.toLowerCase()]));
  const evidence = inputs.map((item) => ({ evidenceId: String(item.evidenceId ?? ""), sha256: String(item.sha256 ?? "").toLowerCase() }));
  if (evidence.length === 0 || evidence.some((item) => verified.get(item.evidenceId) !== item.sha256)) {
    return { ok: false, reason: "analysis provenance does not match the selected finding" };
  }
  const lineage = Array.isArray(meta.lineage) ? meta.lineage as { runId?: string }[] : [];
  if (lineage.some((entry) => entry.runId === runId)) {
    return { ok: false, reason: "analysis provenance does not match the selected finding" };
  }
  return {
    ok: true,
    record: {
      selectedRunId: runId,
      findingSha256: actualHash,
      evidence,
      derivedInputSha256: derived,
      promptVersion,
      promptSha256: promptSha,
      provider: typeof meta.provider === "string" ? meta.provider : null,
      model,
      generatedAt: typeof meta.createdAt === "string" ? meta.createdAt : "",
      supersedesRunId: typeof meta.supersedesRunId === "string" ? meta.supersedesRunId : null,
    },
  };
}
