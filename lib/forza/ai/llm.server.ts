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
import { applyPrivacyGateway } from "./privacy-gateway";
import { newTraceId } from "@/lib/forza/trace";

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
}): Promise<LlmResult> {
  const purpose = options.purpose ?? "chat";
  const traceId = options.traceId ?? newTraceId();
  // Centrálna brána: žiadna nesystémová správa neodíde bez redakcie PII.
  const { messages } = applyPrivacyGateway(options.messages);

  const callParams = {
    ...options,
    messages,
    purpose,
    traceId,
    timeoutMs: options.timeoutMs ?? timeoutForPurpose(purpose),
  };

  // 1. Ak je nakonfigurovaný Mistral, je vždy primárnou voľbou.
  if (mistralConfigured(purpose)) {
    const mistralResult = await callMistral(callParams);

    if (mistralResult.status === "ok") {
      return { ...mistralResult, provider: "mistral" };
    }

    // 2. Kontrola, či je chyba prechodná a či je dostupný Gemini fallback
    if (isRetryableProviderFailure(mistralResult) && geminiConfigured()) {
      console.warn(
        `[AI Router] Primárny poskytovateľ Mistral zlyhal prechodne (${mistralResult.status}), aktivujem Gemini fallback...`,
      );
      const geminiResult = await callGemini(callParams);
      if (geminiResult.status === "ok") {
        return { ...geminiResult, provider: "gemini" };
      }
      console.error(
        `[AI Router] Záložný poskytovateľ Gemini taktiež zlyhal (${geminiResult.status}): ${geminiResult.message}`,
      );
    }

    // Vráti výsledok primárneho poskytovateľa (alebo ne-retryovateľnú chybu)
    return { ...mistralResult, provider: "mistral" };
  }

  // 3. Ak Mistral nie je nakonfigurovaný, ale Gemini je
  if (geminiConfigured()) {
    const geminiResult = await callGemini(callParams);
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
): Promise<string> {
  if (!mistralConfigured("analysis")) {
    throw new Error(
      "OCR nie je nakonfigurované (chýba MISTRAL_API_KEY alebo MISTRAL_API_KEY_ANALYSIS).",
    );
  }
  return callMistralOcr(fileBuffer, fileName);
}
