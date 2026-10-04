import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateCompletionStream,
  generateCompletion,
  generateImage,
  readSseStream,
  readStream,
  makeApiKey,
} from "../services/ai-service";

function createMockResponse(body: unknown, init: ResponseInit = {}): Response {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers);

  if (typeof body === "string") {
    return new Response(body, { status, headers });
  }

  if (body instanceof ReadableStream) {
    return new Response(body, { status, headers });
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

describe("ai-service (Ruthlessly Hardened)", () => {
  const apiKey = makeApiKey("test-valid-api-key-12345");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("generateCompletionStream", () => {
    it("vracia AuthMissing ak je API kľúč prázdny", async () => {
      const result = await generateCompletionStream([], "");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("AuthMissing");
      }
    });

    it("správne zostaví požiadavku s modelom mistral-large-latest", async () => {
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createMockResponse(mockStream)));

      const result = await generateCompletionStream([{ role: "user", content: "Analyzuj spis" }], apiKey);

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://api.mistral.ai/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${apiKey}`,
          }),
          body: expect.stringContaining('"model":"mistral-large-latest"'),
        })
      );
    });

    it("správne zostaví požiadavku pre Google Gemini (gemini-3.7-flash)", async () => {
      const mockStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close();
        },
      });

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(createMockResponse(mockStream)));

      const result = await generateCompletionStream(
        [{ role: "user", content: "Audituj bezpečnosť" }],
        apiKey,
        { model: "gemini-3.7-flash" }
      );

      expect(result.ok).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-goog-api-key": apiKey,
          }),
          body: expect.stringContaining('"system_instruction"'),
        })
      );
    });

    it("správne zachytí a vráti RateLimited chybu (429)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          createMockResponse(
            { error: { message: "Prekročený limit volaní" } },
            { status: 429 }
          )
        )
      );

      const result = await generateCompletionStream([{ role: "user", content: "Test" }], apiKey);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe("RateLimited");
        expect(result.error.message).toBe("Prekročený limit volaní");
      }
    });

    it("legacy generateCompletion vyhodí chybu pri zlyhaní API", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          createMockResponse(
            { error: { message: "Quota exceeded" } },
            { status: 429 }
          )
        )
      );

      await expect(
        generateCompletion([{ role: "user", content: "Hi" }], apiKey)
      ).rejects.toThrow("Quota exceeded");
    });
  });

  describe("readSseStream & readStream", () => {
    it("bezpečne zvládne fragmentovaný stream a token [DONE] bez pádu", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"choices": [{"delta": {"con', // Fragment 1 (neúplný JSON)
        'tent": "Forenzná"}}]}\n\n',           // Fragment 2
        'data: {"choices": [{"delta": {"content": " analýza"}}]}\n\n',
        ': ping keep-alive\n\n',             // SSE komentár
        'data: [DONE]\n\n',                  // Ukončenie streamu
      ];

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const receivedChunks: string[] = [];
      const result = await readSseStream(stream, (text) => receivedChunks.push(text));

      expect(result.ok).toBe(true);
      expect(receivedChunks).toEqual(["Forenzná", " analýza"]);
    });

    it("správne spracuje Gemini SSE stream formát", async () => {
      const encoder = new TextEncoder();
      const geminiChunks = [
        'data: {"candidates": [{"content": {"parts": [{"text": "PΛND0RΛ "}]}}]}\n\n',
        'data: {"candidates": [{"content": {"parts": [{"text": "OS"}]}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of geminiChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const received: string[] = [];
      const result = await readSseStream(stream, (text) => received.push(text));

      expect(result.ok).toBe(true);
      expect(received.join("")).toBe("PΛND0RΛ OS");
    });

    it("legacy readStream číta dáta a neuvoľňuje výnimky pri [DONE]", async () => {
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const c of chunks) controller.enqueue(encoder.encode(c));
          controller.close();
        },
      });

      const onChunk = vi.fn();
      await readStream(stream.getReader(), onChunk);

      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith("Hello");
    });
  });

  describe("generateImage", () => {
    it("vráti validnú URL na úspešné volanie", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          createMockResponse({
            data: [{ url: "https://storage.pandora.io/images/generated-evidence.png" }],
          })
        )
      );

      const url = await generateImage("graf tokov", apiKey);
      expect(url).toBe("https://storage.pandora.io/images/generated-evidence.png");
    });

    it("vyhodí zrozumiteľnú chybu pri chýbajúcom kľúči", async () => {
      await expect(generateImage("cat", "")).rejects.toThrow("API kľúč chýba.");
    });
  });
});
