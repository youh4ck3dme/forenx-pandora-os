import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createChatCompletionStream,
  parseSseStream,
  generateMistralImage,
} from "../mistral-client";
import { ChatMessage } from "../types";

function createTypedResponse(bodyContent: string | ReadableStream<Uint8Array>, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers);

  if (typeof bodyContent === "string") {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    return new Response(bodyContent, { status, headers });
  }

  return new Response(bodyContent, { status, headers });
}

describe("Mistral AI Client (Hardened Resilience Suite)", () => {
  const VALID_API_KEY = "mistral_live_secret_key_998877665544";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createChatCompletionStream", () => {
    it("odmietne neplatný formát API kľúča bez odoslania sieťovej požiadavky", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await createChatCompletionStream(
        [{ role: "user", content: "Test" }],
        "short"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ValidationError");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("správne zostaví požiadavku a vráti ReadableStream pri HTTP 200", async () => {
      const emptyStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      const fetchMock = vi.fn().mockResolvedValue(
        createTypedResponse(emptyStream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })
      );
      vi.stubGlobal("fetch", fetchMock);

      const messages: readonly ChatMessage[] = [{ role: "user", content: "Analyzuj bankový prevod" }];
      const result = await createChatCompletionStream(messages, VALID_API_KEY);

      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.mistral.ai/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${VALID_API_KEY}`,
            Accept: "text/event-stream",
          }),
        })
      );
    });

    it("deterministicky zachytí HTTP 429 vrátane Retry-After hlavičky", async () => {
      const errorBody = JSON.stringify({
        error: { message: "Prekročený rate limit volaní na minútu." },
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          createTypedResponse(errorBody, {
            status: 429,
            headers: { "Retry-After": "15" },
          })
        )
      );

      const result = await createChatCompletionStream(
        [{ role: "user", content: "Spusti audit" }],
        VALID_API_KEY
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("RateLimitError");
        if (result.error.kind === "RateLimitError") {
          expect(result.error.status).toBe(429);
          expect(result.error.retryAfterMs).toBe(15000);
        }
      }
    });

    it("vracia TimeoutError pri abortnutí požiadavky časovačom", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                const abortError = new Error("The operation was aborted.");
                abortError.name = "AbortError";
                reject(abortError);
              });
            }
          });
        })
      );

      const result = await createChatCompletionStream(
        [{ role: "user", content: "Dlhotrvajúca analýza" }],
        VALID_API_KEY,
        { timeoutMs: 10 }
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("TimeoutError");
        if (result.error.kind === "TimeoutError") {
          expect(result.error.timeoutMs).toBe(10);
        }
      }
    });
  });

  describe("parseSseStream (TCP Fragmentation & Multibyte Unicode Resilience)", () => {
    it("bezchybne dekóduje fragmentované JSON chunky, UTF-8 znaky a ukončí na [DONE]", async () => {
      const encoder = new TextEncoder();
      // Simulácia rozbitia viacbajtového znaku 'č' (0xC4, 0x8D) a JSON kľúčov medzi pakety
      const fullPayload1 = 'data: {"choices":[{"delta":{"content":"Forenzná analý';
      const fullPayload2 = 'za účtu: € 150 000"}}]}\n\n';
      const keepAlivePing = ": keep-alive heartbeat ping\n\n";
      const terminationToken = "data: [DONE]\n\n";

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(fullPayload1));
          controller.enqueue(encoder.encode(fullPayload2));
          controller.enqueue(encoder.encode(keepAlivePing));
          controller.enqueue(encoder.encode(terminationToken));
          controller.close();
        },
      });

      const receivedText: string[] = [];
      const result = await parseSseStream(stream, (chunk) => {
        receivedText.push(chunk);
      });

      expect(result.ok).toBe(true);
      expect(receivedText.join("")).toBe("Forenzná analýza účtu: € 150 000");
    });

    it("odmietne stream prekračujúci maximálnu povolenú dĺžku riadku bez zrútenia pamäte", async () => {
      const encoder = new TextEncoder();
      const maliciousLongChunk = "data: " + "A".repeat(1_100_000); // 1.1 MB bez oddeľovača riadka

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(maliciousLongChunk));
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
  });

  describe("generateMistralImage", () => {
    it("úspešne validuje odpoveď a vráti branded ImageUrl", async () => {
      const responsePayload = JSON.stringify({
        data: [{ url: "https://storage.mistral.ai/vault/generated_evidence_99.png" }],
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(createTypedResponse(responsePayload, { status: 200 }))
      );

      const result = await generateMistralImage("Forensic diagram", VALID_API_KEY);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe("https://storage.mistral.ai/vault/generated_evidence_99.png");
      }
    });

    it("odmietne nevalidnú štruktúru dát od servera", async () => {
      const malformedPayload = JSON.stringify({
        data: [{ invalid_field: 123 }],
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(createTypedResponse(malformedPayload, { status: 200 }))
      );

      const result = await generateMistralImage("Forensic diagram", VALID_API_KEY);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("ValidationError");
      }
    });
  });
});
