/** Canonical ForenZX webhook header. No alternate names are accepted. */
export const FORENZX_WEBHOOK_HEADER = "x-forenzx-webhook-secret";

/**
 * Constant-time string compare for the Deno edge runtime.
 * Walks the full byte sequence and folds a length mismatch into the accumulator.
 * Does not return on the first differing byte. Does not throw for normal strings.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    const lb = i < left.length ? left[i] : 0;
    const rb = i < right.length ? right[i] : 0;
    diff |= lb ^ rb;
  }
  return diff === 0;
}

/** Fail closed unless the canonical header matches the trimmed env secret. */
export function isWebhookAuthorized(
  request: Request,
  expectedSecret: string | null | undefined,
): boolean {
  const expected = expectedSecret?.trim();
  if (!expected) return false;
  const provided = request.headers.get(FORENZX_WEBHOOK_HEADER);
  if (!provided) return false;
  return timingSafeEqualString(provided, expected);
}
