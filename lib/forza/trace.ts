/**
 * P0-04 — Correlation & Trace IDs.
 *
 * Jednoznačné trasovanie požiadaviek cez API routes, serverové funkcie a
 * odchádzajúce LLM volania: každá požiadavka dostane x-trace-id (UUIDv4),
 * ktorý sa vracia v hlavičke odpovede, posiela na Mistral / VPS worker a
 * vkladá sa do štruktúrovaných logov.
 *
 * Logy NESMÚ obsahovať PII ani API kľúče — na to slúži sanitizeForLog()
 * (redakcia PII + maskovanie bearer tokenov a API kľúčov).
 *
 * Modul je bezpečný pre server aj browser (žiadne node-only importy);
 * trace id sa propaguje explicitne, nie cez async_hooks.
 */
import { redactPii } from "./ai/pii-redactor";

export const TRACE_HEADER = "x-trace-id";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nový trace identifikátor (UUIDv4); v prostrediach bez WebCrypto fallback. */
export function newTraceId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // Deterministicky neurčitý fallback (server bez WebCrypto).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.trunc(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/** Prevezme platný trace id z hlavičky (UUIDv4), inak null. */
export function traceIdFromHeader(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export function tracePrefix(traceId?: string | null): string {
  return traceId ? `[trace:${traceId}] ` : "";
}

const MAX_LOG_VALUE = 4000;

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]"],
  [/\b(?:sk|sb_publishable|sb_secret)[-_][A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]"],
  [/\b(?:Authorization|api[-_]?key|apikey|secret|password|token)["']?\s*[:=]\s*["'][^"']{4,}["']/gi, "[REDACTED_SECRET]"],
];

/**
 * Bezpečná hodnota pre log: redakcia PII (rodné čísla, IBAN, mená svedkov…)
 * a maskovanie API kľúčov / bearer tokenov; dlhé hodnoty skrátené.
 */
export function sanitizeForLog(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = `${value.name}: ${value.message}`;
  } else if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = redactPii(text).text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.length > MAX_LOG_VALUE
    ? `${text.slice(0, MAX_LOG_VALUE)}…[truncated]`
    : text;
}

/** Štruktúrovaný chybový log s trace id, bez PII a bez tajomstiev. */
export function tracedError(
  traceId: string | null | undefined,
  message: string,
  meta?: unknown,
): void {
  const suffix = meta === undefined ? "" : ` ${sanitizeForLog(meta)}`;
  console.error(`${tracePrefix(traceId)}${message}${suffix}`);
}

/** Štruktúrovaný varovný log s trace id, bez PII a bez tajomstiev. */
export function tracedWarn(
  traceId: string | null | undefined,
  message: string,
  meta?: unknown,
): void {
  const suffix = meta === undefined ? "" : ` ${sanitizeForLog(meta)}`;
  console.warn(`${tracePrefix(traceId)}${message}${suffix}`);
}

/**
 * Obalie handler API route: prevezme/vytvorí trace id, vykoná handler
 * v jeho kontexte a do odpovede pridá hlavičku x-trace-id.
 */
export async function withTraceRoute<T extends Response>(
  request: Request,
  handler: (traceId: string) => Promise<T>,
): Promise<T> {
  const inbound =
    typeof request.headers?.get === "function"
      ? request.headers.get(TRACE_HEADER)
      : null;
  const traceId = traceIdFromHeader(inbound) ?? newTraceId();
  const response = await handler(traceId);
  response.headers.set(TRACE_HEADER, traceId);
  return response;
}
