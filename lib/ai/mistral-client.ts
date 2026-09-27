import { z } from "zod";
import { applyPrivacyGateway, type GatewayMessage } from "@/lib/forza/ai/privacy-gateway";
import { redactPii } from "@/lib/forza/ai/pii-redactor";
import {
  ApiKey,
  ImageUrl,
  ModelName,
  ChatMessage,
  Result,
  MistralError,
  ok,
  err,
  ApiKeySchema,
  ImageUrlSchema,
  ModelNameSchema,
  ChatMessageSchema,
  MistralChunkSchema,
  MistralImageResponseSchema,
  MistralErrorPayloadSchema,
} from "./types";

export interface CompletionStreamOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** P0-04: korelačné trace id (x-trace-id) pre odchádzajúcu požiadavku. */
  readonly traceId?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ImageGenerationOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_STREAM_TIMEOUT_MS = 60_000;
const DEFAULT_IMAGE_TIMEOUT_MS = 30_000;
const MAX_BUFFER_LINE_LENGTH = 1_048_576; // 1 MB bezpečnostný limit na jeden riadok proti Buffer Bomb

function extractErrorMessage(status: number, raw: unknown): string {
  const parsed = MistralErrorPayloadSchema.safeParse(raw);
  if (parsed.success && parsed.data.error) {
    if (typeof parsed.data.error === "string") return parsed.data.error;
    if (parsed.data.error.message) return parsed.data.error.message;
  }
  if (parsed.success && parsed.data.message) {
    return parsed.data.message;
  }
  return `HTTP požiadavka zlyhala so statusom ${status}.`;
}

/**
 * Bezpečný streamovací klient pre Mistral AI Chat Completions.
 */
export async function createChatCompletionStream(
  messages: readonly ChatMessage[],
  rawApiKey: string,
  options: CompletionStreamOptions = {}
): Promise<Result<ReadableStream<Uint8Array>, MistralError>> {
  const keyValidation = ApiKeySchema.safeParse(rawApiKey);
  if (!keyValidation.success) {
    return err({
      kind: "ValidationError",
      message: "Neplatný formát API kľúča.",
      details: keyValidation.error,
    });
  }
  const apiKey: ApiKey = keyValidation.data;

  const msgValidation = z.array(ChatMessageSchema).min(1).safeParse(messages);
  if (!msgValidation.success) {
    return err({
      kind: "ValidationError",
      message: "Neplatné vstupné správy pre chat.",
      details: msgValidation.error,
    });
  }

  const model: ModelName = ModelNameSchema.parse(options.model ?? "mistral-large-latest");
  const timeoutMs = options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;

  // GDPR brána (P1-04): nesystémové správy prejdú redakciou PII (rodné čísla,
  // IBAN, mená svedkov/obetí, e-maily, telefóny) pred odoslaním poskytovateľovi.
  const { messages: redactedMessages } = applyPrivacyGateway(
    msgValidation.data as GatewayMessage[],
  );

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "text/event-stream",
        ...(options.traceId ? { "x-trace-id": options.traceId } : {}),
      },
      body: JSON.stringify({
        model,
        messages: redactedMessages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.json().catch(() => null);
      const message = extractErrorMessage(response.status, rawError);

      if (response.status === 401 || response.status === 403) {
        return err({ kind: "AuthError", status: response.status, message });
      }
      if (response.status === 429) {
        const retryHeader = response.headers.get("Retry-After");
        const retryAfterMs = retryHeader ? Number.parseInt(retryHeader, 10) * 1000 : undefined;
        const validRetry = typeof retryAfterMs === "number" && !Number.isNaN(retryAfterMs) ? retryAfterMs : undefined;
        return err({ kind: "RateLimitError", status: 429, message, retryAfterMs: validRetry });
      }
      return err({ kind: "NetworkError", status: response.status, message });
    }

    if (!response.body) {
      return err({ kind: "StreamError", message: "HTTP odpoveď neobsahuje streamovacie telo." });
    }

    return ok(response.body);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return err({
        kind: "TimeoutError",
        timeoutMs,
        message: `Sieťové volanie bolo prerušené po vypršaní hard limitu ${timeoutMs}ms.`,
      });
    }
    return err({
      kind: "NetworkError",
      status: 0,
      message: error instanceof Error ? error.message : "Neznáma sieťová chyba.",
    });
  } finally {
    clearTimeout(timeoutTimer);
  }
}

/**
 * Deterministický stavový SSE Parser s ochranou proti TCP fragmentácii,
 * Buffer Bomb útokom, multibyte UTF-8 korupcii a garantovaným uvoľnením locku.
 */
export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (content: string) => void,
  signal?: AbortSignal
): Promise<Result<void, MistralError>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";

  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };

  if (signal) {
    if (signal.aborted) {
      void reader.cancel().catch(() => {});
      return err({ kind: "TimeoutError", timeoutMs: 0, message: "Čítanie streamu bolo prerušené klientom." });
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    while (true) {
      if (signal?.aborted) {
        return err({ kind: "TimeoutError", timeoutMs: 0, message: "Čítanie streamu bolo prerušené klientom." });
      }

      const { done, value } = await reader.read();
      if (signal?.aborted) {
        return err({ kind: "TimeoutError", timeoutMs: 0, message: "Čítanie streamu bolo prerušené klientom." });
      }
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      if (buffer.length > MAX_BUFFER_LINE_LENGTH) {
        await reader.cancel();
        return err({
          kind: "StreamError",
          message: "Prekročený bezpečnostný limit dĺžky bufferu (Buffer Overflow Protection).",
          bufferSnapshot: buffer.slice(0, 256),
        });
      }

      const lines = buffer.split(/\r?\n/);
      // Ponechaj posledný neúplný fragment v bufferi
      const lastSegment = lines.pop();
      buffer = typeof lastSegment === "string" ? lastSegment : "";

      for (const line of lines) {
        const trimmed = line.trim();
        // Ignoruj prázdne riadky a SSE keep-alive komentáre
        if (trimmed.length === 0 || trimmed.startsWith(":")) {
          continue;
        }

        if (trimmed.startsWith("data:")) {
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") {
            return ok(undefined);
          }

          try {
            const rawJson: unknown = JSON.parse(payload);
            const chunkResult = MistralChunkSchema.safeParse(rawJson);
            if (chunkResult.success) {
              const textContent = chunkResult.data.choices[0]?.delta.content;
              if (typeof textContent === "string" && textContent.length > 0) {
                onChunk(textContent);
              }
            }
          } catch {
            // Poškodený individuálny JSON nesmie položiť celý stream; pokračujeme v čítaní
            continue;
          }
        }
      }
    }

    return ok(undefined);
  } catch (error: unknown) {
    if (signal?.aborted) {
      return err({ kind: "TimeoutError", timeoutMs: 0, message: "Čítanie streamu bolo prerušené klientom." });
    }
    return err({
      kind: "StreamError",
      message: error instanceof Error ? error.message : "Zlyhanie pri čítaní sieťového streamu.",
    });
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
    reader.releaseLock();
  }
}

/**
 * Generovanie obrázkov s validáciou a timeoutom.
 */
export async function generateMistralImage(
  prompt: string,
  rawApiKey: string,
  options: ImageGenerationOptions = {}
): Promise<Result<ImageUrl, MistralError>> {
  const keyValidation = ApiKeySchema.safeParse(rawApiKey);
  if (!keyValidation.success) {
    return err({
      kind: "ValidationError",
      message: "Neplatný formát API kľúča.",
      details: keyValidation.error,
    });
  }
  const apiKey: ApiKey = keyValidation.data;

  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) {
    return err({
      kind: "ValidationError",
      message: "Prompt nesmie byť prázdny.",
      details: new z.ZodError([
        { code: "custom", message: "Prompt is empty", path: ["prompt"] },
      ]),
    });
  }

  // GDPR brána (P1-04): redakcia PII z promptu pred odoslaním poskytovateľovi.
  const safePrompt = redactPii(trimmedPrompt).text;

  const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

  if (options.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch("https://api.mistral.ai/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ prompt: safePrompt }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawError = await response.json().catch(() => null);
      const message = extractErrorMessage(response.status, rawError);
      return err({ kind: "NetworkError", status: response.status, message });
    }

    const rawJson: unknown = await response.json();
    const validated = MistralImageResponseSchema.safeParse(rawJson);
    if (!validated.success) {
      return err({
        kind: "ValidationError",
        message: "API vrátilo neočakávanú štruktúru pre obrázok.",
        details: validated.error,
      });
    }

    const firstItem = validated.data.data[0];
    if (!firstItem) {
      return err({ kind: "StreamError", message: "Zoznam obrázkov je prázdny." });
    }

    const urlValidation = ImageUrlSchema.safeParse(firstItem.url);
    if (!urlValidation.success) {
      return err({
        kind: "ValidationError",
        message: "Neplatná URL vygenerovaného obrázka.",
        details: urlValidation.error,
      });
    }

    return ok(urlValidation.data);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      return err({
        kind: "TimeoutError",
        timeoutMs,
        message: `Generovanie obrázka bolo prerušené po ${timeoutMs}ms.`,
      });
    }
    return err({
      kind: "NetworkError",
      status: 0,
      message: error instanceof Error ? error.message : "Chyba siete pri generovaní obrázka.",
    });
  } finally {
    clearTimeout(timeoutTimer);
  }
}
