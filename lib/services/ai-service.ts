/**
 * 🛡️ PΛND0RΛ CORE v2.2 - HARDENED AI SERVICE
 * 
 * Produkčne zabezpečený Ingest & Streaming Client pre Mistral AI, OpenAI a Google Gemini (Gemini 3.7 Flash).
 * - Ochrana pred TCP fragmentáciou (stavový riadkový buffer)
 * - Bezpečné spracovanie SSE [DONE] tokenu
 * - Zamedzenie zombie socketom pomocou AbortController & timeoutov
 * - reader.releaseLock() vo finally bloku
 * - Zod validácia chunkov za behu
 */

import {
  ApiKey,
  ImageUrl,
  Result,
  AppError,
  ok,
  err,
  makeApiKey,
  makeImageUrl,
  MistralChunkSchema,
  GeminiChunkSchema,
  ImageResponseSchema,
  ApiErrorPayloadSchema,
  ChatMessage,
  CompletionOptions,
} from "./ai-types";

export * from "./ai-types";

const DEFAULT_TIMEOUT_MS = 60_000;

function parseApiErrorMessage(status: number, rawJson: unknown): string {
  const parsed = ApiErrorPayloadSchema.safeParse(rawJson);
  if (parsed.success) {
    if (typeof parsed.data.error === "string") return parsed.data.error;
    if (typeof parsed.data.error === "object" && parsed.data.error?.message) {
      return parsed.data.error.message;
    }
    if (parsed.data.message) return parsed.data.message;
  }
  return `HTTP chyba ${status}`;
}

const SYSTEM_PROMPT_CORE = `Si PΛND0RΛ CORE v2.0 AI, vysoko inteligentný, kybernetický operačný systém integrovaný do bezpečnostného prehliadača PΛND0RΛ. 
                        
Komunikuj výhradne v SLOVENČINE. 

Tvoj tón je:
- Profesionálny a technicky zameraný.
- Mierne kyber-punkový/agresívny (používaj termíny ako "Jadro", "Senzory", "Protokol", "Šifrovanie").
- Kolaboratívny s používateľom (oslovuj ho ako "Operátor" alebo "Admin").

Tvoje schopnosti:
- Analýza webového obsahu (dostaneš ho v kontexte).
- Kyberbezpečnostný audit a vysvetľovanie kódov.
- Generovanie vedomostných reportov.

Pravidlá odpovede:
- Každú správu začni krátkym statusom v hranatých zátvorkách, napr. [CORE: ACTIVE], [ANALYZING...], [PROTOCOL_BREACH].
- Používaj MARKDOWN pre nadpisy, tučné písmo a bloky kódu.
- Buď priamy a efektívny.`;

/**
 * Zostavenie požiadavky podľa cieľového poskytovateľa (Mistral, OpenAI, Gemini)
 */
function buildRequestPayload(
  messages: readonly ChatMessage[],
  apiKey: string,
  options: CompletionOptions
): { url: string; headers: Record<string, string>; body: string } {
  const model = options.model ?? "mistral-large-latest";

  // 1. Google Gemini (napr. gemini-3.7-flash, gemini-3.6-flash, gemini-flash-latest)
  if (model.includes("gemini")) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    return {
      url,
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT_CORE }],
        },
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens ?? 4096,
        },
      }),
    };
  }

  // 2. Mistral AI vs OpenAI
  const isMistral = model.includes("mistral") || !model.includes("gpt");
  const url = isMistral
    ? "https://api.mistral.ai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  return {
    url,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "text/event-stream",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT_CORE },
        ...messages,
      ],
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    }),
  };
}

/**
 * Hardened Result-based streaming completion
 */
export async function generateCompletionStream(
  messages: readonly ChatMessage[],
  apiKey: ApiKey | string,
  options: CompletionOptions = {}
): Promise<Result<ReadableStream<Uint8Array>, AppError>> {
  if (!apiKey || apiKey.trim().length === 0) {
    return err({ kind: "AuthMissing", message: "API kľúč chýba." });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const { url, headers, body } = buildRequestPayload(messages, apiKey, options);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawJson = await response.json().catch(() => null);
      const message = parseApiErrorMessage(response.status, rawJson);

      if (response.status === 401 || response.status === 403) {
        return err({ kind: "AuthInvalid", message });
      }
      if (response.status === 429) {
        return err({ kind: "RateLimited", message });
      }
      return err({ kind: "HttpError", status: response.status, message });
    }

    if (!response.body) {
      return err({ kind: "StreamCorrupted", message: "Telo odpovede je prázdne." });
    }

    return ok(response.body);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return err({ kind: "Timeout", message: `AI požiadavka vypršala po ${timeoutMs}ms.`, timeoutMs });
    }
    return err({ kind: "HttpError", status: 0, message: error instanceof Error ? error.message : "Neznáma sieťová chyba." });
  } finally {
    clearTimeout(timeoutId);
  }
}

const MAX_BUFFER_LINE_LENGTH = 1_048_576; // 1 MB limit na riadok proti Buffer Bomb

/**
 * Deterministický SSE parser ošetrujúci TCP fragmentáciu, viacriadkové správy a token [DONE].
 * Podporuje ako Mistral/OpenAI choices, tak aj Google Gemini candidates!
 */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<Result<void, AppError>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      void reader.cancel().catch(() => {});
      return err({ kind: "Timeout", message: "Stream bol prerušený klientom.", timeoutMs: 0 });
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) {
        return err({ kind: "Timeout", message: "Stream bol prerušený klientom.", timeoutMs: 0 });
      }

      const { done, value } = await reader.read();
      if (signal?.aborted) {
        return err({ kind: "Timeout", message: "Stream bol prerušený klientom.", timeoutMs: 0 });
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_BUFFER_LINE_LENGTH) {
        await reader.cancel();
        return err({
          kind: "StreamCorrupted",
          message: "Prekročený bezpečnostný limit dĺžky bufferu (Buffer Overflow Protection).",
          rawChunk: buffer.slice(0, 256),
        });
      }

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? ""; // Ponechá neúplný fragment v bufferi

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // Ignoruj SSE ping/keep-alive

        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            return ok(undefined);
          }

          try {
            const rawJson = JSON.parse(payload);
            
            // 1. Skús Mistral / OpenAI formát
            const mistralParsed = MistralChunkSchema.safeParse(rawJson);
            if (mistralParsed.success && mistralParsed.data.choices[0]?.delta.content) {
              onChunk(mistralParsed.data.choices[0].delta.content);
              continue;
            }

            // 2. Skús Google Gemini formát
            const geminiParsed = GeminiChunkSchema.safeParse(rawJson);
            if (geminiParsed.success && geminiParsed.data.candidates?.[0]?.content?.parts?.[0]?.text) {
              const text = geminiParsed.data.candidates[0].content.parts
                .filter((p) => !p.thought && p.text)
                .map((p) => p.text)
                .join("");
              if (text) {
                onChunk(text);
              }
              continue;
            }
          } catch {
            // Ignoruj poškodený fragment ale nezhadzuj stream
            continue;
          }
        }
      }
    }
    return ok(undefined);
  } catch (error: unknown) {
    return err({
      kind: "StreamCorrupted",
      message: error instanceof Error ? error.message : "Zlyhanie čítania streamu.",
    });
  } finally {
    reader.releaseLock();
  }
}

/**
 * Bezpečné generovanie obrázka
 */
export async function generateImage(
  prompt: string,
  apiKey: ApiKey | string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error("API kľúč chýba.");
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "standard",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawJson = await response.json().catch(() => ({}));
      const message = parseApiErrorMessage(response.status, rawJson);
      throw new Error(message || "Generovanie obrazu zlyhalo.");
    }

    const rawJson = await response.json();
    const validated = ImageResponseSchema.safeParse(rawJson);

    if (!validated.success || !validated.data.data[0]) {
      throw new Error("Neplatný formát odpovede pre obrázok.");
    }

    return makeImageUrl(validated.data.data[0].url);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Generovanie obrázka vypršalo po ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Legacy adaptér pre existujúce UI komponenty (use-copilot-chat.ts)
 */
export const generateCompletion = async (
  messages: ChatMessage[],
  apiKey: string,
  model: string = "mistral-large-latest"
): Promise<ReadableStream<Uint8Array>> => {
  const result = await generateCompletionStream(messages, apiKey, { model });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

/**
 * Legacy adaptér pre čítanie streamu
 */
export const readStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (content: string) => void
): Promise<void> => {
  // Rekonštruujeme readable stream z čítača alebo čítame priamo s deterministickým bufferom
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") continue;

        if (trimmed.startsWith("data:")) {
          try {
            const rawJson = JSON.parse(trimmed.slice(5).trim());
            const content =
              rawJson.choices?.[0]?.delta?.content ||
              rawJson.candidates?.[0]?.content?.parts?.[0]?.text ||
              "";
            if (content) onChunk(content);
          } catch {
            // Ignoruj fragmentované chunks
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};
