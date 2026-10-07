/**
 * Serverový klient pre Google Gemini API (POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent).
 * Kľúč `GEMINI_API_KEY` je serverové tajomstvo — nikdy sa nedostane do klientského balíka.
 * Model sa nastavuje serverovou premennou `GEMINI_MODEL` (predvolený: gemini-flash-lite-latest).
 */
import { guardCloudEvidenceAi } from "@/lib/court/ai-boundary";

export const GEMINI_ENDPOINT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-flash-lite-latest";

export const REQUEST_TIMEOUT_MS = 35_000;
export const ANALYSIS_TIMEOUT_MS = 300_000;

export function timeoutForPurpose(purpose: "chat" | "analysis"): number {
  return purpose === "analysis" ? ANALYSIS_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

export type GeminiMessage = { role: "system" | "user"; content: string };
export type GeminiPurpose = "chat" | "analysis";

export type GeminiResult =
  | {
      status: "ok";
      content: string;
      usage: { prompt: number | null; completion: number | null };
      model: string;
    }
  | {
      status: "not_configured" | "timeout" | "rate_limited" | "failed";
      message: string;
      retryAfterSeconds?: number;
    };

export function geminiModel(): string {
  return process.env["GEMINI_MODEL"]?.trim() || DEFAULT_GEMINI_MODEL;
}

export function geminiApiKey(): string | undefined {
  return process.env["GEMINI_API_KEY"]?.trim() || undefined;
}

export function geminiConfigured(): boolean {
  return Boolean(geminiApiKey());
}

type GeminiCallOptions = {
  messages: GeminiMessage[];
  maxTokens?: number;
  purpose?: GeminiPurpose;
  traceId?: string;
  timeoutMs?: number;
  /** Absolútny deadline celého AI jobu (timestamp v ms od epochy). */
  deadline?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Serverové volanie Gemini s časovým limitom a normalizáciou výsledku do jednotného kontraktu.
 * Nikdy nevracia API kľúč, autorizačné hlavičky ani nespracované citlivé dáta poskytovateľa.
 */
export async function callGemini(
  options: GeminiCallOptions,
): Promise<GeminiResult> {
  guardCloudEvidenceAi("gemini"); // INV-032: fail-closed in court-grade
  const apiKey = geminiApiKey();
  if (!apiKey) {
    return {
      status: "not_configured",
      message: "Gemini AI nie je nakonfigurovaná (chýba GEMINI_API_KEY).",
    };
  }

  // Kontrola hard-ceiling deadline pred začatím
  if (options.deadline && options.deadline - Date.now() <= 0) {
    return {
      status: "timeout",
      message: "AI_EXECUTION_DEADLINE_EXCEEDED: Celkový časový limit 500s bol vyčerpaný pred odoslaním požiadavky na Gemini.",
    };
  }

  const model = geminiModel();
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs =
    options.timeoutMs ?? timeoutForPurpose(options.purpose ?? "chat");

  const remainingForAttempt = options.deadline ? options.deadline - Date.now() : timeoutMs;
  if (remainingForAttempt <= 0) {
    return {
      status: "timeout",
      message: "AI_EXECUTION_DEADLINE_EXCEEDED: Celkový časový limit 500s bol vyčerpaný pred pokusom Gemini.",
    };
  }
  const effectiveTimeoutMs = Math.min(timeoutMs, remainingForAttempt);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  // Rozdelenie na systémovú inštrukciu a používateľské správy
  const systemTexts = options.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .filter(Boolean);

  const nonSystemMessages = options.messages.filter((m) => m.role !== "system");

  const contents =
    nonSystemMessages.length > 0
      ? nonSystemMessages.map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content }],
        }))
      : [
          {
            role: "user",
            parts: [{ text: systemTexts.join("\n\n") || "Ping" }],
          },
        ];

  const payload: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: options.maxTokens ?? 1024,
    },
  };

  if (systemTexts.length > 0 && nonSystemMessages.length > 0) {
    payload["system_instruction"] = {
      parts: [{ text: systemTexts.join("\n\n") }],
    };
  }

  const url = `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const response = await doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.traceId ? { "x-trace-id": options.traceId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (response.status === 429 || response.status === 503) {
      const header = response.headers.get("retry-after");
      const after = header ? Number(header) : 2;
      return {
        status: "rate_limited",
        message: "Gemini je momentálne vyťažený. Skúste to o chvíľu.",
        retryAfterSeconds: Number.isFinite(after) ? Math.min(after, 10) : 2,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        status: "failed",
        message: "Gemini odmietol kľúč (neplatný alebo bez oprávnenia).",
      };
    }

    if (!response.ok) {
      return {
        status: "failed",
        message: `Gemini vrátil chybu ${response.status}.`,
      };
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };

    const textPart = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof textPart !== "string" || textPart.trim() === "") {
      return {
        status: "failed",
        message: "Gemini vrátil prázdnu odpoveď.",
      };
    }

    return {
      status: "ok",
      content: textPart.trim(),
      usage: {
        prompt: data.usageMetadata?.promptTokenCount ?? null,
        completion: data.usageMetadata?.candidatesTokenCount ?? null,
      },
      model,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (options.deadline && Date.now() >= options.deadline) {
        return {
          status: "timeout",
          message: "AI_EXECUTION_DEADLINE_EXCEEDED: Gemini požiadavka prekročila celkový deadline.",
        };
      }
      return {
        status: "timeout",
        message: "Volanie Gemini prekročilo časový limit.",
      };
    }
    return {
      status: "failed",
      message: "Spojenie s Gemini zlyhalo.",
    };
  } finally {
    clearTimeout(timer);
  }
}
