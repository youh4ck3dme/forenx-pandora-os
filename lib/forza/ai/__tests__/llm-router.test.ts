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

  describe("500s Execution Budget & Deadline-Based Execution", () => {
    it("should abort immediately with AI_EXECUTION_DEADLINE_EXCEEDED if initial deadline is already expired", async () => {
      vi.mocked(mistralConfigured).mockReturnValue(true);
      vi.mocked(geminiConfigured).mockReturnValue(true);

      const pastDeadline = Date.now() - 1000;
      const result = await callLlm({
        messages: testMessages,
        deadline: pastDeadline,
      });

      expect(result.status).toBe("timeout");
      expect(result.message).toContain("AI_EXECUTION_DEADLINE_EXCEEDED");
      expect(callMistral).not.toHaveBeenCalled();
      expect(callGemini).not.toHaveBeenCalled();
    });

    it("should clamp Gemini fallback timeout to the remaining deadline budget", async () => {
      vi.mocked(mistralConfigured).mockReturnValue(true);
      vi.mocked(geminiConfigured).mockReturnValue(true);

      // Assume job deadline is 500s from now
      const startTime = Date.now();
      const deadline = startTime + 500_000;

      // Mistral fails after simulated elapsed time (e.g. 260s)
      vi.mocked(callMistral).mockImplementation(async (opts) => {
        // Verify deadline is passed to Mistral
        expect(opts.deadline).toBe(deadline);
        return {
          status: "timeout",
          message: "Mistral požiadavka prekročila limit.",
        };
      });

      // Gemini is called as fallback
      vi.mocked(callGemini).mockImplementation(async (opts) => {
        // The timeout allocated to Gemini must not exceed the remaining time
        expect(opts.deadline).toBe(deadline);
        expect(opts.timeoutMs).toBeLessThanOrEqual(500_000);
        return {
          status: "ok",
          content: "FORENX_GEMINI_FALLBACK_OK",
          usage: { prompt: 20, completion: 10 },
          model: "gemini-flash-lite-latest",
        };
      });

      const result = await callLlm({
        messages: testMessages,
        purpose: "analysis",
        deadline,
      });

      expect(result.status).toBe("ok");
      expect(result.provider).toBe("gemini");
      expect(callMistral).toHaveBeenCalledTimes(1);
      expect(callGemini).toHaveBeenCalledTimes(1);
    });

    it("should NOT call Gemini fallback if Mistral exhausted the entire 500s budget", async () => {
      vi.mocked(mistralConfigured).mockReturnValue(true);
      vi.mocked(geminiConfigured).mockReturnValue(true);

      // Budget initialized with a very small remaining time that expires during Mistral
      const deadline = Date.now() + 50;

      vi.mocked(callMistral).mockImplementation(async () => {
        // Wait until deadline has passed
        await new Promise((r) => setTimeout(r, 60));
        return {
          status: "timeout",
          message: "AI_EXECUTION_DEADLINE_EXCEEDED: Celkový časový limit bol vyčerpaný.",
        };
      });

      const result = await callLlm({
        messages: testMessages,
        deadline,
      });

      expect(result.status).toBe("timeout");
      expect(result.message).toContain("AI_EXECUTION_DEADLINE_EXCEEDED");
      // Mistral was attempted, but Gemini was NOT called because budget was exhausted
      expect(callMistral).toHaveBeenCalledTimes(1);
      expect(callGemini).not.toHaveBeenCalled();
    });

    it("should allow short tasks to complete immediately without artificial delays", async () => {
      vi.mocked(mistralConfigured).mockReturnValue(true);
      vi.mocked(geminiConfigured).mockReturnValue(true);

      const quickResult: MistralResult = {
        status: "ok",
        content: "QUICK_CLASSIFICATION_RESULT",
        usage: { prompt: 5, completion: 2 },
        model: "mistral-large-latest",
      };
      vi.mocked(callMistral).mockResolvedValue(quickResult);

      const before = Date.now();
      const result = await callLlm({
        messages: testMessages,
        purpose: "chat",
      });
      const elapsed = Date.now() - before;

      expect(result.status).toBe("ok");
      expect(result.provider).toBe("mistral");
      // Must finish in milliseconds, NOT waiting for 500s
      expect(elapsed).toBeLessThan(1000);
      expect(callMistral).toHaveBeenCalledTimes(1);
      expect(callGemini).not.toHaveBeenCalled();
    });
  });
});

