import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChatCompletionStream, parseSseStream } from "../mistral-client";
import { ChatMessage, MistralError } from "../types";

function createMockStreamResponse(stream: ReadableStream<Uint8Array>, init: ResponseInit = {}): Response {
  return new Response(stream, {
    status: init.status ?? 200,
    headers: new Headers({ "Content-Type": "text/event-stream", ...init.headers }),
  });
}

function createMockJsonResponse(body: unknown, status = 200, headersInit: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({ "Content-Type": "application/json", ...headersInit }),
  });
}

describe("🛡️ FAULT-INJECTION RESILIENCE & STREAM AUDIT", () => {
  const VALID_KEY = "mistral_prod_secret_key_abcdef123456";
  const messages: readonly ChatMessage[] = [{ role: "user", content: "Forenzná analýza" }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. FAULT: MULTIBYTE UTF-8 BYTE SPLITTING ──────────────────
  it("FA01: Zvládne rozdelenie slovenského viacbajtového znaku 'ž' a '€' naprieč 3 sieťové pakety", async () => {
    const encoder = new TextEncoder();
    
    // Kompletný string: 'data: {"choices":[{"delta":{"content":"Ťažba: 50 000 €"}}]}\n\n'
    const part1 = encoder.encode('data: {"choices":[{"delta":{"content":"\u0164a'); // 'Ťa'
    const fullUtf8Bytes = encoder.encode('\u017Eba: 50 000 \u20AC"}}]}\n\n');         // 'žba: 50 000 €'
    
    // Roztrhnutie 2-bajtového 'ž' (0xC5, 0xBE) na dva separátne pakety
    const splitByte1 = fullUtf8Bytes.slice(0, 1); // 0xC5 (neúplný bajt)
    const restBytes = fullUtf8Bytes.slice(1);     // 0xBE + zvyšok

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(part1);
        controller.enqueue(splitByte1);
        controller.enqueue(restBytes);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    const receivedChunks: string[] = [];
    const result = await parseSseStream(stream, (chunk) => receivedChunks.push(chunk));

    expect(result.ok).toBe(true);
    expect(receivedChunks.join("")).toBe("Ťažba: 50 000 €");
  });

  // ─── 2. FAULT: SSE BUFFER BOMB (DoS ATTACK) ───────────────────
  it("FA02: Okamžite zastaví stream a uvoľní pamäť pri pokuse o Buffer Overflow (> 1 MB bez nového riadku)", async () => {
    const encoder = new TextEncoder();
    // 1.2 MB reťazec bez \n
    const maliciousPayload = "data: " + "X".repeat(1_200_000);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(maliciousPayload));
        controller.close();
      },
    });

    const result = await parseSseStream(stream, () => {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("StreamError");
      expect(result.error.message).toContain("Buffer Overflow Protection");
    }
  });

  // ─── 3. FAULT: RATE LIMIT 429 S EXPONENTIAL RETRY-AFTER ────────
  it("FA03: Správne extrahuje celočíselný čas čakania pri HTTP 429 Rate Limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        createMockJsonResponse(
          { error: { message: "Server throttled request." } },
          429,
          { "Retry-After": "45" }
        )
      )
    );

    const result = await createChatCompletionStream(messages, VALID_KEY);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("RateLimitError");
      if (result.error.kind === "RateLimitError") {
        expect(result.error.status).toBe(429);
        expect(result.error.retryAfterMs).toBe(45_000);
      }
    }
  });

  // ─── 4. FAULT: SLOWLORIS CLIENT-SIDE TIMEOUT ABORTION ──────────
  it("FA04: Deterministicky preruší čítanie streamu pri zlyhaní čítania cez AbortController", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Začiatok..."}}]}\n\n'));
        // Simulácia zamrznutého socketu (nič ďalšie sa neposiela)
      },
    });

    const receivedChunks: string[] = [];
    
    // Vyvolanie abortu po 25 ms
    setTimeout(() => controller.abort(), 25);

    const result = await parseSseStream(
      stream,
      (chunk) => receivedChunks.push(chunk),
      controller.signal
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("TimeoutError");
    }
    expect(receivedChunks).toEqual(["Začiatok..."]);
  });

  // ─── 5. FAULT: MALFORMED INTERLEAVED JSON CORRUPTION ───────────
  it("FA05: Nezhodí celý proces, ak je v strede streamu vložený poškodený non-JSON riadok", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Blok 1"}}]}\n\n',
      'data: { INVALID CORRUPTED JSON STRUCT !!!\n\n', // Poškodený chunk
      ': keep-alive heartbeat\n\n',
      'data: {"choices":[{"delta":{"content":" | Blok 2"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const stream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        for (const c of chunks) {
          ctrl.enqueue(encoder.encode(c));
        }
        ctrl.close();
      },
    });

    const receivedChunks: string[] = [];
    const result = await parseSseStream(stream, (chunk) => receivedChunks.push(chunk));

    expect(result.ok).toBe(true);
    // Poškodený riadok bol bezpečne odfiltrovaný, validné chunky prešli
    expect(receivedChunks.join("")).toBe("Blok 1 | Blok 2");
  });
});
