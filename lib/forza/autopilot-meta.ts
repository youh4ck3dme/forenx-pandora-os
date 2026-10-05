/**
 * Proveniencia Forenzného Autopilota — idempotency, truncácia, source refs.
 */
import { PROMPT_VERSION } from "@/lib/ai/redact";
import { canonicalSha256 } from "./provenance/canonical";
import {
  AUTOPILOT_CHUNK_CHARS,
  AUTOPILOT_DOCUMENT_CHAR_LIMIT,
} from "@/lib/ai-prompt";
import type {
  AutopilotAnalysisMeta,
  AutopilotChunkMeta,
  ForensicDossier,
} from "@/lib/types";
import { formatSourceRef } from "@/lib/types";

export { PROMPT_VERSION };

const HEURISTIC_NOTE =
  "registryAnalysis / crossBorderAnalysis sú AI odhady z textu spisu — nie live ORSR, RPVS ani Dimitri API.";

/** Stabilný kľúč: rovnaký spis + prompt → rovnaká analýza.
 *  Partial retries get a distinct key so they create a new run record rather than
 *  colliding with the original full-run idempotency slot. */
export async function buildAutopilotIdempotencyKey(input: {
  caseId: string;
  documentText: string;
  promptVersion?: string;
  retryChunkIndexes?: number[];
}): Promise<string> {
  const version = input.promptVersion ?? PROMPT_VERSION;
  const chunkSuffix =
    input.retryChunkIndexes && input.retryChunkIndexes.length > 0
      ? `|retry:${[...input.retryChunkIndexes].sort((a, b) => a - b).join(",")}`
      : "";
  const payload = `${input.caseId}|${version}|${input.documentText.length}|${fnv1a(input.documentText)}${chunkSuffix}`;
  return `ap:${payload}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function collectSourceReferences(dossier: ForensicDossier): string[] {
  const refs = new Set<string>();
  for (const ev of dossier.facts?.timeline ?? []) {
    const formatted = formatSourceRef(ev.sourceRef) || ev.source?.trim();
    if (formatted) refs.add(formatted);
  }
  for (const t of dossier.facts?.traces ?? []) {
    const formatted = formatSourceRef(t.sourceRef) || t.paragraph?.trim();
    if (formatted) refs.add(formatted);
  }
  for (const a of dossier.defenseAttack?.attacks ?? []) {
    const formatted = formatSourceRef(a.sourceRef) || a.paragraph?.trim();
    if (formatted) refs.add(formatted);
  }
  for (const e of dossier.evidenceStrength?.traces ?? []) {
    const formatted = formatSourceRef(e.sourceRef) || e.paragraph?.trim();
    if (formatted) refs.add(formatted);
  }
  return Array.from(refs).slice(0, 80);
}

export function buildAnalysisMeta(input: {
  caseId: string;
  documentIds: string[];
  inputChars: number;
  analyzedChars: number;
  chunkCount: number;
  chunks: AutopilotChunkMeta[];
  model: string;
  provider?: string;
  idempotencyKey: string;
  evidenceInputs?: { evidenceId: string; sha256: string }[];
  derivedInputSha256?: string;
  promptSha256?: string;
  resultSha256?: string;
  analysisStatus: AutopilotAnalysisMeta["analysisStatus"];
  sourceReferences: string[];
  isDemo?: boolean;
}): AutopilotAnalysisMeta {
  const truncated =
    input.inputChars > AUTOPILOT_DOCUMENT_CHAR_LIMIT ||
    input.chunkCount > 1 ||
    input.analyzedChars < input.inputChars;
  return {
    promptVersion: PROMPT_VERSION,
    ...(input.promptSha256 ? { promptSha256: input.promptSha256 } : {}),
    model: input.model,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.evidenceInputs ? { evidenceInputs: input.evidenceInputs } : {}),
    ...(input.derivedInputSha256 ? { derivedInputSha256: input.derivedInputSha256 } : {}),
    ...(input.resultSha256 ? { resultSha256: input.resultSha256 } : {}),
    createdAt: new Date().toISOString(),
    analysisStatus: input.analysisStatus,
    documentIds: input.documentIds,
    sourceReferences: input.sourceReferences,
    idempotencyKey: input.idempotencyKey,
    truncation: {
      inputChars: input.inputChars,
      analyzedChars: input.analyzedChars,
      truncated,
      chunkCount: input.chunkCount,
      chunkLimit: AUTOPILOT_CHUNK_CHARS,
      documentLimit: AUTOPILOT_DOCUMENT_CHAR_LIMIT,
    },
    chunks: input.chunks,
    ...(input.isDemo ? { isDemo: true } : {}),
    heuristicModulesNote: HEURISTIC_NOTE,
  };
}

export function attachAnalysisMeta(
  dossier: ForensicDossier,
  meta: AutopilotAnalysisMeta,
): ForensicDossier {
  return {
    ...dossier,
    generatedAt: meta.createdAt,
    analysisMeta: meta,
  };
}

export function isDemoDossier(dossier: ForensicDossier | null): boolean {
  if (!dossier) return false;
  return (
    dossier.analysisMeta?.isDemo === true ||
    dossier.analysisMeta?.analysisStatus === "demo"
  );
}


export function assertAnalysisProvenance(meta: {
  evidenceInputs?: { evidenceId: string; sha256: string }[];
  derivedInputSha256?: string;
  promptVersion?: string;
  promptSha256?: string;
} | undefined, citedEvidenceIds: readonly string[]): void {
  if (citedEvidenceIds.length === 0) return;
  if (!meta?.derivedInputSha256 || !meta.promptVersion || !meta.promptSha256 || !meta.evidenceInputs?.length) {
    throw new Error("analysis provenance is incomplete");
  }
  const byId = new Map(meta.evidenceInputs.map((item) => [item.evidenceId, item.sha256]));
  for (const id of citedEvidenceIds) {
    const sha = byId.get(id);
    if (!sha || !/^[a-f0-9]{64}$/.test(sha)) throw new Error("analysis provenance is incomplete");
  }
}

export function collectCitedEvidenceIds(dossier: {
  facts?: { timeline?: { sourceRef?: { evidenceId?: string } }[]; traces?: { sourceRef?: { evidenceId?: string } }[] };
  defenseAttack?: { attacks?: { sourceRef?: { evidenceId?: string } }[] };
  evidenceStrength?: { traces?: { sourceRef?: { evidenceId?: string } }[] };
}): string[] {
  const ids = new Set<string>();
  const take = (ref?: { evidenceId?: string }) => {
    if (ref?.evidenceId) ids.add(ref.evidenceId);
  };
  for (const event of dossier.facts?.timeline ?? []) take(event.sourceRef);
  for (const trace of dossier.facts?.traces ?? []) take(trace.sourceRef);
  for (const attack of dossier.defenseAttack?.attacks ?? []) take(attack.sourceRef);
  for (const trace of dossier.evidenceStrength?.traces ?? []) take(trace.sourceRef);
  return [...ids];
}

export function assertSavedDossierProvenance(
  stored: { analysisMeta?: Parameters<typeof assertAnalysisProvenance>[0] } | null,
  incoming: Parameters<typeof collectCitedEvidenceIds>[0] & { analysisMeta?: unknown },
): void {
  if (stored?.analysisMeta && JSON.stringify(incoming.analysisMeta) !== JSON.stringify(stored.analysisMeta)) {
    throw new Error("analysis provenance cannot be rewritten");
  }
  if (stored?.analysisMeta && authoritativeFindingSha256(incoming) !== authoritativeFindingSha256(stored)) {
    throw new Error("authoritative finding payload cannot change under the same analysis run");
  }
  assertAnalysisProvenance(stored?.analysisMeta, collectCitedEvidenceIds(incoming));
}

const PRESENTATION_FIELDS = new Set(["analysisMeta", "caseTitle", "generatedAt"]);

export function authoritativeFindingPayload(dossier: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dossier).filter(([key, value]) => !PRESENTATION_FIELDS.has(key) && value !== undefined),
  );
}

export function authoritativeFindingSha256(dossier: object): string {
  return canonicalSha256(authoritativeFindingPayload(dossier));
}
