// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createChatCompletionStream,
  generateMistralImage,
} from "../mistral-client";
import {
  generateCompletionStream,
  generateImage,
} from "@/lib/services/ai-service";

const VALID_API_KEY = "mistral_live_secret_key_998877665544";

// 800101000 % 11 = 6 → platná kontrolná číslica SK rodného čísla.
const PII_MESSAGE =
  "Zápisnica: rodné číslo 800101/0006, účet SK3112000000198742637541. " +
  "Svedok Ján Novák vypovedal o prevode.";

function emptySseResponse(): Response {
  const empty = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
  return new Response(empty, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function imageResponse(): Response {
  return new Response(
    JSON.stringify({ data: [{ url: "https://images.example.test/img.png" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

interface SentBody {
  messages: Array<{ role: string; content: string }>;
  prompt?: string;
  contents?: Array<{ parts: Array<{ text: string }> }>;
  [key: string]: unknown;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>): SentBody {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  expect(init?.body).toBeTruthy();
  return JSON.parse(String(init?.body)) as SentBody;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GDPR brána — redakcia PII pred odoslaním na externé API (P1-04)", () => {
  it("mistral-client: nesystémové správy sú redigované pred fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await createChatCompletionStream(
      [
        { role: "system", content: "Politika: systémová správa ostáva bez zmeny." },
        { role: "user", content: PII_MESSAGE },
      ],
      VALID_API_KEY,
    );

    expect(result.ok).toBe(true);
    const body = sentBody(fetchMock);
    const userMessage = body.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toContain("[RODNÉ_ČÍSLO]");
    expect(userMessage?.content).toContain("[IBAN]");
    expect(userMessage?.content).toContain("Svedok [SUBJEKT]");
    expect(userMessage?.content).not.toContain("800101");
    expect(userMessage?.content).not.toContain("SK3112000000198742637541");
    expect(userMessage?.content).not.toContain("Ján Novák");
  });

  it("mistral-client: systémová správa sa nerediguje", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse());
    vi.stubGlobal("fetch", fetchMock);

    const system = "Policy: kontakt audit@forenx.sk je kontakt správcu.";
    await createChatCompletionStream(
      [
        { role: "system", content: system },
        { role: "user", content: "Bez PII." },
      ],
      VALID_API_KEY,
    );

    const body = sentBody(fetchMock);
    expect(body.messages[0].content).toBe(system);
  });

  it("mistral-client: prompt generovania obrázka je redigovaný", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMistralImage(
      `Koláž s dokladom rodné číslo 800101/0006 a menom svedok Peter Horváth.`,
      VALID_API_KEY,
    );

    expect(result.ok).toBe(true);
    const body = sentBody(fetchMock);
    expect(body.prompt).toContain("[RODNÉ_ČÍSLO]");
    expect(body.prompt).toContain("[SUBJEKT]");
    expect(body.prompt).not.toContain("800101");
    expect(body.prompt).not.toContain("Peter Horváth");
  });

  it("ai-service (Mistral/OpenAI cesta): správy sú redigované pred fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCompletionStream(
      [{ role: "user", content: PII_MESSAGE }],
      VALID_API_KEY,
      { model: "mistral-large-latest" },
    );

    expect(result.ok).toBe(true);
    const body = sentBody(fetchMock);
    const userMessage = body.messages.find(
      (m: { role: string }) => m.role === "user",
    );
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toContain("[RODNÉ_ČÍSLO]");
    expect(userMessage?.content).toContain("[IBAN]");
    expect(userMessage?.content).not.toContain("800101");
    expect(userMessage?.content).not.toContain("Ján Novák");
  });

  it("ai-service (Gemini cesta): obsah je redigovaný pred fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptySseResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCompletionStream(
      [{ role: "user", content: `Výpoveď: obeta Anna Modrá, tel. 0905 123 456.` }],
      "gemini-test-key",
      { model: "gemini-flash-latest" },
    );

    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "generativelanguage.googleapis.com",
    );
    const body = sentBody(fetchMock);
    const content = body.contents?.[0]?.parts[0]?.text;
    expect(content).toContain("obeta [SUBJEKT]");
    expect(content).toContain("[TELEFÓN]");
    expect(content).not.toContain("Anna Modrá");
    expect(content).not.toContain("0905");
  });

  it("ai-service: prompt generovania obrázka (OpenAI) je redigovaný", async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse());
    vi.stubGlobal("fetch", fetchMock);

    const url = await generateImage(
      `Ilustrácia: doklad rodné číslo 800101/0006.`,
      "sk-openai-test",
    );

    expect(url).toContain("https://images.example.test/img.png");
    const body = sentBody(fetchMock);
    expect(body.prompt).toContain("[RODNÉ_ČÍSLO]");
    expect(body.prompt).not.toContain("800101");
  });
});
