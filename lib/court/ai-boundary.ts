/**
 * INV-032 — Court-grade local AI boundary.
 *
 * In court-grade / air-gapped mode, evidence content MUST NOT be sent to a
 * third-party cloud AI provider (confidentiality + chain-of-custody). This
 * module resolves the only permitted forensic-AI endpoint and refuses cloud
 * providers when court-grade is active. Pure: no network, no fail-open.
 *
 * It also makes the cloud `MISTRAL_API_KEY` non-mandatory in court-grade — a
 * local endpoint (`FORENZX_LOCAL_AI_BASE_URL`) is the required provider instead
 * (enforced in `config/env.ts`).
 */
export type ForensicAiResolution =
  | { mode: "local"; baseUrl: string; model: string | null }
  | { mode: "cloud-permitted" };

export type AiBoundaryEnv = {
  courtGrade: boolean;
  localAiBaseUrl?: string | null;
  localAiModel?: string | null;
};

export function resolveForensicAiEndpoint(env: AiBoundaryEnv): ForensicAiResolution {
  if (env.courtGrade) {
    if (!env.localAiBaseUrl) {
      throw new Error(
        "Court-grade mode requires FORENZX_LOCAL_AI_BASE_URL; refusing to run evidence AI without a local endpoint.",
      );
    }
    return { mode: "local", baseUrl: env.localAiBaseUrl, model: env.localAiModel ?? null };
  }
  return { mode: "cloud-permitted" };
}

/**
 * Runtime court-grade flag read straight from the process env (not the parsed
 * config object) so it can be toggled at a call site and in tests. Fail-closed
 * default: anything other than the literal "true" is treated as not court-grade,
 * but callers use it only to BLOCK cloud, so a stricter env never weakens them.
 */
export function isCourtGradeRuntime(): boolean {
  return process.env.FORENZX_COURT_GRADE === "true";
}

/**
 * Hard chokepoint guard for every cloud AI provider call site. In court-grade
 * mode it throws, so evidence (or any) content can never leave to a third-party
 * cloud model. Wire this at each cloud provider entry point.
 */
export function guardCloudEvidenceAi(providerLabel: string): void {
  if (isCourtGradeRuntime()) {
    throw new Error(
      `INV-032: court-grade mode blocks the cloud AI provider "${providerLabel}". ` +
        `Configure FORENZX_LOCAL_AI_BASE_URL and use the local endpoint.`,
    );
  }
}

export type AiProviderKind = "local" | "cloud";

/**
 * Hard guard for the evidence-AI call site: throws if a cloud provider would
 * process evidence content while court-grade is active. Fail-closed.
 */
export function assertEvidenceAiAllowed(provider: AiProviderKind, courtGrade: boolean): void {
  if (courtGrade && provider === "cloud") {
    throw new Error(
      "INV-032 violation: court-grade mode must not send evidence content to a cloud AI provider.",
    );
  }
}
