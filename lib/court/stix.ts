/**
 * STIX threat-intel digest verification — PURE utility (INV-030 support).
 *
 * Scope boundary: the RUNTIME fail-closed enforcement of INV-030 lives in the
 * Python ForenZX MCP Hub (`forenzx-mcp-hub/core/threat_intel.py`), which is the
 * actual STIX consumer. This module is a pure cryptographic/verification helper
 * for the PANDORA/Next side (e.g. Court Pack verification): it does NO network
 * I/O, performs NO UI enforcement, and has NO fail-open fallback. It only
 * classifies a bundle against a trusted-digest allowlist and returns an explicit
 * verdict. Having this utility does NOT make INV-030 VERIFIED — that requires
 * the Hub runtime tests.
 */
import { createHash } from "node:crypto";

export type StixVerdict =
  | { result: "trusted"; digest: string }
  | { result: "untrusted"; digest: string }
  | { result: "invalid-config"; reason: string };

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type AllowlistParse =
  | { ok: true; digests: Set<string> }
  | { ok: false; reason: string };

/**
 * Parses and normalizes `FORENZX_TRUSTED_STIX_DIGESTS` (comma-separated,
 * lower-cased hex SHA-256). An empty or malformed allowlist is an explicit
 * error — never silently treated as "allow nothing" vs "allow all".
 */
export function parseStixDigestAllowlist(raw: string | undefined): AllowlistParse {
  if (raw === undefined || raw.trim() === "") {
    return { ok: false, reason: "empty-allowlist" };
  }
  const digests = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (digests.length === 0) {
    return { ok: false, reason: "empty-allowlist" };
  }
  for (const digest of digests) {
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      return { ok: false, reason: `malformed-digest:${digest.slice(0, 16)}` };
    }
  }
  return { ok: true, digests: new Set(digests) };
}

/**
 * Classifies a STIX bundle against the allowlist. The caller decides the
 * fail-closed policy; this function never fails open. `invalid-config` and
 * `untrusted` MUST both be treated as "reject" by any court-grade caller.
 */
export function evaluateStixBundle(bundleBytes: Uint8Array, allowlistRaw: string | undefined): StixVerdict {
  const parsed = parseStixDigestAllowlist(allowlistRaw);
  if (!parsed.ok) {
    return { result: "invalid-config", reason: parsed.reason };
  }
  const digest = sha256Hex(bundleBytes);
  return parsed.digests.has(digest) ? { result: "trusted", digest } : { result: "untrusted", digest };
}

/** Convenience boolean for callers that only proceed on an explicit trusted verdict. */
export function isStixTrusted(verdict: StixVerdict): boolean {
  return verdict.result === "trusted";
}
