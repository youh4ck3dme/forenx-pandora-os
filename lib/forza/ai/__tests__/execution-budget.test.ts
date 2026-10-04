import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAiExecutionBudget,
  AiDeadlineExceededError,
  MAX_AI_EXECUTION_SECONDS,
  AI_JOB_DEADLINE_MS,
  AI_EXECUTION_DEADLINE_EXCEEDED,
  getEffectiveDeadlineMs,
  isDeadlineExceededMessage,
} from "../execution-budget";

describe("AI Execution Budget (500s Hard Ceiling)", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.useFakeTimers();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  it("should have default 500s (500_000ms) ceiling", () => {
    expect(MAX_AI_EXECUTION_SECONDS).toBe(500);
    expect(AI_JOB_DEADLINE_MS).toBe(500_000);
    expect(getEffectiveDeadlineMs()).toBe(500_000);

    const budget = createAiExecutionBudget();
    expect(budget.budgetMs).toBe(500_000);
    expect(budget.deadline).toBe(budget.startTime + 500_000);
    expect(budget.isExpired()).toBe(false);
    expect(budget.getRemainingMs()).toBe(500_000);
  });

  it("should respect environment variable overrides if configured", () => {
    process.env["MAX_AI_EXECUTION_SECONDS"] = "300";
    expect(getEffectiveDeadlineMs()).toBe(300_000);

    process.env["AI_JOB_DEADLINE_MS"] = "250000";
    expect(getEffectiveDeadlineMs()).toBe(250_000);
  });

  it("should track elapsed time and compute remaining time correctly", () => {
    const budget = createAiExecutionBudget();

    // Advance 100 seconds
    vi.advanceTimersByTime(100_000);
    expect(budget.getRemainingMs()).toBe(400_000);
    expect(budget.isExpired()).toBe(false);

    // Advance another 350 seconds (total 450s elapsed)
    vi.advanceTimersByTime(350_000);
    expect(budget.getRemainingMs()).toBe(50_000);
    expect(budget.isExpired()).toBe(false);

    // Advance 60 seconds (total 510s elapsed -> deadline exceeded)
    vi.advanceTimersByTime(60_000);
    expect(budget.getRemainingMs()).toBe(-10_000);
    expect(budget.isExpired()).toBe(true);
  });

  it("should throw AiDeadlineExceededError with code AI_EXECUTION_DEADLINE_EXCEEDED when checkDeadline fails", () => {
    const budget = createAiExecutionBudget();

    // Still within budget
    expect(() => budget.checkDeadline("step_1")).not.toThrow();

    // Advance past deadline
    vi.advanceTimersByTime(500_001);

    expect(() => budget.checkDeadline("post_processing")).toThrowError(
      AiDeadlineExceededError,
    );

    try {
      budget.checkDeadline("validation");
    } catch (err) {
      expect(err).toBeInstanceOf(AiDeadlineExceededError);
      const e = err as AiDeadlineExceededError;
      expect(e.code).toBe(AI_EXECUTION_DEADLINE_EXCEEDED);
      expect(e.message).toContain("AI_EXECUTION_DEADLINE_EXCEEDED");
      expect(e.message).toContain("validation");
    }
  });

  it("should clamp individual call timeouts to remaining budget", () => {
    const budget = createAiExecutionBudget();

    // Short call (e.g. chat 35s) gets its requested 35s without artificial delay
    expect(budget.clampTimeout(35_000)).toBe(35_000);

    // Long analysis call (e.g. 300s) gets 300s
    expect(budget.clampTimeout(300_000)).toBe(300_000);

    // Now simulate 400s elapsed
    vi.advanceTimersByTime(400_000);
    // Remaining is 100s
    expect(budget.getRemainingMs()).toBe(100_000);

    // A requested 300s call is clamped to 100s remaining!
    expect(budget.clampTimeout(300_000)).toBe(100_000);

    // A requested 35s call still gets 35s because 35s <= 100s
    expect(budget.clampTimeout(35_000)).toBe(35_000);

    // Advance past deadline
    vi.advanceTimersByTime(100_001);
    expect(() => budget.clampTimeout(10_000)).toThrow(AiDeadlineExceededError);
  });

  it("should correctly identify deadline exceeded messages", () => {
    expect(
      isDeadlineExceededMessage(
        "AI_EXECUTION_DEADLINE_EXCEEDED: Celkový časový limit 500s bol vyčerpaný.",
      ),
    ).toBe(true);
    expect(isDeadlineExceededMessage("Poskytovateľ vrátil chybu 500.")).toBe(
      false,
    );
    expect(isDeadlineExceededMessage(undefined)).toBe(false);
  });
});
