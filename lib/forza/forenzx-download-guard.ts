/**
 * Security validator for ForenZX evidence download URLs.
 * Invariant (SOURCE-OF-TRUTH §6, AGENTS.md):
 *  - Presigned download must use HTTPS and an allowed, trusted storage hostname.
 *  - HTTP, localhost, 127.0.0.1, ::1, private IP ranges (RFC 1918 / RFC 3927 / RFC 4193),
 *    and foreign unverified hosts are strictly rejected (fail-closed).
 */

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/,
];

export interface DownloadUrlValidationResult {
  ok: boolean;
  reason?: string;
  host?: string;
}

export function isValidDownloadUrl(
  rawUrl: string,
  allowedHosts?: string[]
): DownloadUrlValidationResult {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, reason: "Download URL must be a non-empty string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Malformed download URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, reason: `Insecure protocol: ${parsed.protocol} (HTTPS required)` };
  }

  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Embedded credentials in download URL are forbidden" };
  }

  const host = parsed.hostname.toLowerCase();

  // Reject loopback and local names
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost")
  ) {
    return { ok: false, reason: `Loopback host forbidden: ${host}`, host };
  }

  // Reject private IP ranges
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(host)) {
      return { ok: false, reason: `Private IP host forbidden: ${host}`, host };
    }
  }

  // If explicit allowed hosts list is provided, enforce it
  if (allowedHosts && allowedHosts.length > 0) {
    const isAllowed = allowedHosts.some((allowed) => {
      const normalized = allowed.trim().toLowerCase();
      if (!normalized) return false;
      return host === normalized || host.endsWith(`.${normalized}`);
    });

    if (!isAllowed) {
      return {
        ok: false,
        reason: `Foreign host rejected: ${host} is not in allowed storage hosts list`,
        host,
      };
    }
  }

  return { ok: true, host };
}

export function assertValidDownloadUrl(rawUrl: string, allowedHosts?: string[]): void {
  const result = isValidDownloadUrl(rawUrl, allowedHosts);
  if (!result.ok) {
    throw new Error(`Security validation failed: ${result.reason}`);
  }
}
