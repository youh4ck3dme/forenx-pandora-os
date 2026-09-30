import { describe, it, expect, vi, beforeEach } from "vitest";
import { callLlm, isRetryableProviderFailure } from "../llm.server";
import type { MistralMessage, MistralResult } from "../mistral.server";

// Mock mistral.server
vi.mock("../mistral.server", () => {
  return {
    mistralConfigured: vi.fn(),
    mistralModel: vi.fn(() => "mistral-large-latest"),
    timeoutForPurpose: vi.fn(() => 35000),
    callMistral: vi.fn(),
    callMistralOcr: vi.fn(),
  };
});

// Mock gemini.server
vi.mock("../gemini.server", () => {
  return {
    geminiConfigured: vi.fn(),
    geminiModel: vi.fn(() => "gemini-flash-lite-latest"),
    callGemini: vi.fn(),
  };
});

// Mock privacy gateway
vi.mock("../privacy-gateway", () => {
  return {
    applyPrivacyGateway: vi.fn((messages: MistralMessage[]) => ({ messages })),
  };
});

import { mistralConfigured, callMistral } from "../mistral.server";
import { geminiConfigured, callGemini } from "../gemini.server";

describe("LLM Router & Gemini Fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const testMessages: MistralMessage[] = [
    { role: "user", content: "Return exactly: FORENX_TEST_OK" },
  ];

  it("should use Mistral as primary when both are configured and Mistral succeeds", async () => {
    vi.mocked(mistralConfigured).mockReturnValue(true);
    vi.mocked(geminiConfigured).mockReturnValue(true);

    const okResult: MistralResult = {
      status: "ok",
      content: "FORENX_MISTRAL_OK",
      usage: { prompt: 10, completion: 5 },
      model: "mistral-large-latest",
    };
    vi.mocked(callMistral).mockResolvedValue(okResult);

    const result = await callLlm({ messages: testMessages });

    expect(result.status).toBe("ok");
    expect(result.provider).toBe("mistral");
    if (result.status === "ok") {
      expect(result.content).toBe("FORENX_MISTRAL_OK");
    }
    expect(callMistral).toHaveBeenCalledTimes(1);
    expect(callGemini).not.toHaveBeenCalled();
  });

  it("should fall back to Gemini on Mistral timeout", async () => {
    vi.mocked(mistralConfigured).mockReturnValue(true);
    vi.mocked(geminiConfigured).mockReturnValue(true);

    const timeoutResult: MistralResult = {
      status: "timeout",
      message: "Volanie AI prekročilo časový limit.",
    };
    vi.mocked(callMistral).mockResolvedValue(timeoutResult);

    const geminiOkResult: MistralResult = {
      status: "ok",
      content: "FORENX_GEMINI_OK",
      usage: { prompt: 12, completion: 6 },
      model: "gemini-flash-lite-latest",
    };
    vi.mocked(callGemini).mockResolvedValue(geminiOkResult);

    const result = await callLlm({ messages: testMessages });

    expect(result.status).toBe("ok");
    expect(result.provider).toBe("gemini");
    if (result.status === "ok") {
      expect(result.content).toBe("FORENX_GEMINI_OK");
      expect(result.model).toBe("gemini-flash-lite-latest");
    }
    expect(callMistral).toHaveBeenCalledTimes(1);
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it("should fall back to Gemini on Mistral rate_limited", async () => {
    vi.mocked(mistralConfigured).mockReturnValue(true);
    vi.mocked(geminiConfigured).mockReturnValue(true);

    const rateLimitedResult: MistralResult = {
      status: "rate_limited",
      message: "Poskytovateľ je momentálne vyťažený.",
      retryAfterSeconds: 5,
    };
    vi.mocked(callMistral).mockResolvedValue(rateLimitedResult);

    const geminiOkResult: MistralResult = {
      status: "ok",
      content: "FORENX_GEMINI_OK",
      usage: { prompt: 15, completion: 4 },
      model: "gemini-flash-lite-latest",
    };
    vi.mocked(callGemini).mockResolvedValue(geminiOkResult);

    const result = await callLlm({ messages: testMessages });

    expect(result.status).toBe("ok");
    expect(result.provider).toBe("gemini");
    expect(callGemini).toHaveBeenCalledTimes(1);
  });

  it("should NOT fall back to Gemini on Mistral 401/403 credential rejection", async () => {
    vi.mocked(mistralConfigured).mockReturnValue(true);
    vi.mocked(geminiConfigured).mockReturnValue(true);

    const authErrorResult: MistralResult = {
      status: "failed",
      message: "Mistral odmietol kľúč (neplatný alebo bez oprávnenia).",
    };
    vi.mocked(callMistral).mockResolvedValue(authErrorResult);

    const result = await callLlm({ messages: testMessages });

    expect(result.status).toBe("failed");
    expect(result.provider).toBe("mistral");
    if (result.status === "failed") {
      expect(result.message).toContain("odmietol kľúč");
    }
    expect(callMistral).toHaveBeenCalledTimes(1);
    expect(callGemini).not.toHaveBeenCalled();
  });

  it("should identify retryable vs non-retryable provider failures correctly", () => {
    expect(
      isRetryableProviderFailure({ status: "timeout", message: "Timeout" }),
    ).toBe(true);

    expect(
      isRetryableProviderFailure({
        status: "rate_limited",
        message: "429 Too Many Requests",
      }),
    ).toBe(true);

    expect(
      isRetryableProviderFailure({
        status: "failed",
        message: "Spojenie s poskytovateľom zlyhalo.",
      }),
    ).toBe(true);

    expect(
      isRetryableProviderFailure({
        status: "failed",
        message: "Mistral odmietol kľúč (neplatný alebo bez oprávnenia).",
      }),
    ).toBe(false);

    expect(
      isRetryableProviderFailure({
        status: "failed",
        message: "Poskytovateľ vrátil chybu 400.",
      }),
    ).toBe(false);
  });
});
