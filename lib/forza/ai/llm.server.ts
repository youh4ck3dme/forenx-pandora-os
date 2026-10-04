/**
 * Serverová AI vrstva: Mistral API ako primárny poskytovateľ,
 * s automatickým záložným prepnutím (fallback) na Google Gemini API
 * pri prechodných výpadkoch poskytovateľa (timeout, 429, 5xx, sieťová chyba).
 *
 * Kľúče MISTRAL_API_KEY a GEMINI_API_KEY sú výhradne serverové tajomstvá —
 * nikdy sa nedostanú do klientského balíka.
 */
import {
  callMistral,
  callMistralOcr,
  mistralConfigured,
  mistralModel,
  timeoutForPurpose,
  type MistralMessage,
  type MistralPurpose,
  type MistralResult,
} from "./mistral.server";
import {
  callGemini,
  geminiConfigured,
  geminiModel,
} from "./gemini.server";
import {
  AI_EXECUTION_DEADLINE_EXCEEDED,
  createAiExecutionBudget,
  AiDeadlineExceededError,
  MAX_AI_EXECUTION_SECONDS,
  AI_JOB_DEADLINE_MS,
  type AiExecutionBudget,
} from "./execution-budget";
import { applyPrivacyGateway } from "./privacy-gateway";
import { newTraceId } from "@/lib/forza/trace";

export {
  MAX_AI_EXECUTION_SECONDS,
  AI_JOB_DEADLINE_MS,
  AI_EXECUTION_DEADLINE_EXCEEDED,
  AiDeadlineExceededError,
  createAiExecutionBudget,
  type AiExecutionBudget,
};

export type LlmProvider = "mistral" | "gemini";
export type LlmResult = MistralResult & { provider?: LlmProvider };

export function llmConfigured(purpose: MistralPurpose = "chat"): boolean {
  return mistralConfigured(purpose) || geminiConfigured();
}

export function activeProvider(
  purpose: MistralPurpose = "chat",
): LlmProvider | null {
  if (mistralConfigured(purpose)) return "mistral";
  if (geminiConfigured()) return "gemini";
  return null;
}

export function preferredLlmModel(provider: LlmProvider = "mistral"): string {
  return provider === "gemini" ? geminiModel() : mistralModel();
}

export function providerDisplayName(provider: LlmProvider): string {
  return provider === "gemini" ? "Google Gemini" : "Mistral";
}

/**
 * Určuje, či ide o prechodnú chybu infraštruktúry poskytovateľa,
 * pri ktorej je bezpečné aktivovať záložného poskytovateľa (fallback).
 * Neopakuje pri: 400 (chybná požiadavka), 401/403 (neplatný kľúč), validačných chybách.
 */
export function isRetryableProviderFailure(result: MistralResult): boolean {
  if (result.status === "ok") return false;
  if (result.status === "timeout" || result.status === "rate_limited") {
    return true;
  }
  if (result.status === "failed") {
    // Explicitné vylúčenie autentifikačných a klientských chýb
    if (
      result.message.includes("odmietol kľúč") ||
      result.message.includes("bez oprávnenia") ||
      result.message.includes("chybu 400") ||
      result.message.includes("chybu 401") ||
      result.message.includes("chybu 403")
    ) {
      return false;
    }
    // Sieťové výpadky a serverové chyby 5xx
    if (
      result.message.includes("Spojenie s poskytovateľom zlyhalo") ||
      result.message.includes("chybu 500") ||
      result.message.includes("chybu 502") ||
      result.message.includes("chybu 503") ||
      result.message.includes("chybu 504")
    ) {
      return true;
    }
  }
  return false;
}

export async function callLlm(options: {
  messages: MistralMessage[];
  maxTokens?: number;
  purpose?: MistralPurpose;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** P0-04: korelačné trace id; ak chýba, vygeneruje sa nové (UUIDv4). */
  traceId?: string;
  /** Absolútny deadline celého AI jobu (timestamp v ms od epochy). */
  deadline?: number;
  /** Alternatívny celkový budget v ms (predvolený: AI_JOB_DEADLINE_MS = 500 000 ms). */
  budgetMs?: number;
  /** Už existujúci budget kontext. */
  budget?: AiExecutionBudget;
}): Promise<LlmResult> {
  const purpose = options.purpose ?? "chat";
  const traceId = options.traceId ?? newTraceId();

  // Inicializácia budgetu: 500s hard ceiling pre celý job
  const budget =
    options.budget ??
    createAiExecutionBudget(
      options.deadline ? { deadline: options.deadline } : options.budgetMs,
    );

  // Kontrola hard-ceiling pred začatím
  const remainingAtStart = budget.getRemainingMs();
  if (remainingAtStart <= 0) {
    return {
      status: "timeout",
      message: `${AI_EXECUTION_DEADLINE_EXCEEDED}: Celkový pracovný limit 500s bol vyčerpaný pred začatím požiadavky.`,
      provider: "mistral",
    };
  }

  // Centrálna brána: žiadna nesystémová správa neodíde bez redakcie PII.
  const { messages } = applyPrivacyGateway(options.messages);

  // Bežný limit účelu (napr. chat 35s, analýza 300s) ohraničený zostávajúcim budgetom.
  // Krátke úlohy nesmú byť spomaľované týmto limitom — ostáva ich bežný timeoutMs.
  const requestedTimeout = options.timeoutMs ?? timeoutForPurpose(purpose);
  const effectiveTimeout = Math.min(requestedTimeout, remainingAtStart);

  const callParams = {
    ...options,
    messages,
    purpose,
    traceId,
    timeoutMs: effectiveTimeout,
    deadline: budget.deadline,
  };

  // 1. Ak je nakonfigurovaný Mistral, je vždy primárnou voľbou (PRIMARY_PROVIDER).
  if (mistralConfigured(purpose)) {
    const mistralResult = await callMistral(callParams);

    if (mistralResult.status === "ok") {
      return { ...mistralResult, provider: "mistral" };
    }

    // Ak Mistral skončil prekročením celkového deadline
    if (mistralResult.message?.includes(AI_EXECUTION_DEADLINE_EXCEEDED)) {
      return { ...mistralResult, provider: "mistral" };
    }

    // 2. Kontrola, či je chyba prechodná a či je dostupný Gemini fallback (SECONDARY_PROVIDER / FALLBACK)
    if (isRetryableProviderFailure(mistralResult) && geminiConfigured()) {
      const remainingForGemini = budget.getRemainingMs();
      if (remainingForGemini <= 0) {
        return {
          status: "timeout",
          message: `${AI_EXECUTION_DEADLINE_EXCEEDED}: Po pokuse s Mistral nezostal žiadny čas na záložného poskytovateľa Gemini.`,
          provider: "mistral",
        };
      }

      console.warn(
        `[AI Router] Primárny poskytovateľ Mistral zlyhal prechodne (${mistralResult.status}), aktivujem Gemini fallback (zostáva ${Math.round(remainingForGemini / 1000)}s z budgetu 500s)...`,
      );

      const geminiTimeout = Math.min(requestedTimeout, remainingForGemini);
      const geminiResult = await callGemini({
        ...callParams,
        timeoutMs: geminiTimeout,
        deadline: budget.deadline,
      });

      if (geminiResult.status === "ok") {
        return { ...geminiResult, provider: "gemini" };
      }
      console.error(
        `[AI Router] Záložný poskytovateľ Gemini taktiež zlyhal (${geminiResult.status}): ${geminiResult.message}`,
      );
      if (geminiResult.message?.includes(AI_EXECUTION_DEADLINE_EXCEEDED)) {
        return { ...geminiResult, provider: "gemini" };
      }
    }

    // Vráti výsledok primárneho poskytovateľa (alebo ne-retryovateľnú chybu)
    return { ...mistralResult, provider: "mistral" };
  }

  // 3. Ak Mistral nie je nakonfigurovaný, ale Gemini je
  if (geminiConfigured()) {
    const remainingForGemini = budget.getRemainingMs();
    if (remainingForGemini <= 0) {
      return {
        status: "timeout",
        message: `${AI_EXECUTION_DEADLINE_EXCEEDED}: Časový limit bol vyčerpaný pred volaním Gemini.`,
        provider: "gemini",
      };
    }

    const geminiTimeout = Math.min(requestedTimeout, remainingForGemini);
    const geminiResult = await callGemini({
      ...callParams,
      timeoutMs: geminiTimeout,
      deadline: budget.deadline,
    });
    return { ...geminiResult, provider: "gemini" };
  }

  return {
    status: "not_configured",
    message: "Žiadny AI poskytovateľ nie je nakonfigurovaný.",
  };
}

/** OCR fallback po extrakcii textovej vrstvy používa výhradne Mistral OCR. */
export async function extractWithOcrFallback(
  fileBuffer: Buffer,
  fileName: string,
  options?: { deadline?: number; budget?: AiExecutionBudget },
): Promise<string> {
  if (
    options?.budget?.isExpired() ||
    (options?.deadline && options.deadline - Date.now() <= 0)
  ) {
    throw new AiDeadlineExceededError();
  }
  if (!mistralConfigured("analysis")) {
    throw new Error(
      "OCR nie je nakonfigurované (chýba MISTRAL_API_KEY alebo MISTRAL_API_KEY_ANALYSIS).",
    );
  }
  return callMistralOcr(fileBuffer, fileName);
}

