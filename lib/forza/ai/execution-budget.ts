/**
 * AI EXECUTION BUDGET & DEADLINE ENGINE
 *
 * Každá AI úloha má maximálny pracovný budget 500 sekúnd.
 *
 * MAX_AI_EXECUTION_SECONDS = 500
 * AI_JOB_DEADLINE_MS = 500_000
 *
 * Toto NIE JE timeout, ktorý núti každú požiadavku čakať 500 sekúnd.
 * AI končí okamžite po dokončení svojej práce:
 * - jednoduchá klasifikácia: 2–10 s
 * - sumarizácia: 5–30 s
 * - väčšia dokumentová analýza: 30–180 s
 * - komplexná forenzná analýza: môže využiť až 500 s
 *
 * 500 sekúnd je hard ceiling pre celý job.
 * Do rozpočtu sa počíta:
 * - Mistral requesty (primárny poskytovateľ)
 * - retry / backoff čakanie
 * - Gemini fallback (sekundárny poskytovateľ)
 * - parsing
 * - schema validation
 * - post-processing
 * - tool / MCP volania
 *
 * Provider retry nesmie resetovať deadline.
 * Pred každým ďalším provider/tool callom sa vypočíta remainingTime = deadline - Date.now().
 * Ak remainingTime <= 0, job končí kontrolovanou chybou: AI_EXECUTION_DEADLINE_EXCEEDED.
 */

export const MAX_AI_EXECUTION_SECONDS = 500;
export const AI_JOB_DEADLINE_MS = 500_000;
export const AI_EXECUTION_DEADLINE_EXCEEDED = "AI_EXECUTION_DEADLINE_EXCEEDED" as const;

export function getEffectiveDeadlineMs(): number {
  if (typeof process !== "undefined" && process.env) {
    const rawMs = process.env["AI_JOB_DEADLINE_MS"];
    if (rawMs) {
      const parsed = Number(rawMs);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const rawSec = process.env["MAX_AI_EXECUTION_SECONDS"];
    if (rawSec) {
      const parsed = Number(rawSec);
      if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
    }
  }
  return AI_JOB_DEADLINE_MS;
}

export class AiDeadlineExceededError extends Error {
  readonly code = AI_EXECUTION_DEADLINE_EXCEEDED;

  constructor(message = `${AI_EXECUTION_DEADLINE_EXCEEDED}: Celkový časový limit 500 sekúnd pre AI úlohu bol vyčerpaný.`) {
    super(message);
    this.name = "AiDeadlineExceededError";
    Object.setPrototypeOf(this, AiDeadlineExceededError.prototype);
  }
}

export interface AiExecutionBudget {
  readonly startTime: number;
  readonly deadline: number;
  readonly budgetMs: number;
  getRemainingMs(): number;
  isExpired(): boolean;
  checkDeadline(phase?: string): void;
  clampTimeout(requestedTimeoutMs?: number): number;
}

export type BudgetInitOptions =
  | number
  | {
      deadline?: number;
      budgetMs?: number;
      startTime?: number;
    };

export function createAiExecutionBudget(
  options?: BudgetInitOptions,
): AiExecutionBudget {
  const now = Date.now();
  let startTime = now;
  let budgetMs = getEffectiveDeadlineMs();
  let deadline = startTime + budgetMs;

  if (typeof options === "number") {
    if (Number.isFinite(options) && options > 0) {
      budgetMs = options;
      deadline = startTime + budgetMs;
    }
  } else if (options && typeof options === "object") {
    if (typeof options.startTime === "number" && Number.isFinite(options.startTime)) {
      startTime = options.startTime;
    }
    if (typeof options.budgetMs === "number" && Number.isFinite(options.budgetMs) && options.budgetMs > 0) {
      budgetMs = options.budgetMs;
      deadline = startTime + budgetMs;
    }
    if (typeof options.deadline === "number" && Number.isFinite(options.deadline)) {
      deadline = options.deadline;
      budgetMs = Math.max(0, deadline - startTime);
    }
  }

  return {
    startTime,
    deadline,
    budgetMs,
    getRemainingMs(): number {
      return deadline - Date.now();
    },
    isExpired(): boolean {
      return deadline - Date.now() <= 0;
    },
    checkDeadline(phase?: string): void {
      if (deadline - Date.now() <= 0) {
        const detail = phase ? ` vo fáze '${phase}'` : "";
        throw new AiDeadlineExceededError(
          `${AI_EXECUTION_DEADLINE_EXCEEDED}: Celkový limit 500s bol vyčerpaný${detail}.`,
        );
      }
    },
    clampTimeout(requestedTimeoutMs?: number): number {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new AiDeadlineExceededError();
      }
      if (typeof requestedTimeoutMs === "number" && requestedTimeoutMs > 0) {
        return Math.min(requestedTimeoutMs, remaining);
      }
      return remaining;
    },
  };
}

export function isDeadlineExceededMessage(message?: string): boolean {
  if (!message) return false;
  return message.includes(AI_EXECUTION_DEADLINE_EXCEEDED);
}
