import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_ISSUER,
  CAPABILITY_TTL_SECONDS,
  generateEvidenceCapability,
  verifyEvidenceCapability,
  type SignedEvidenceCapability,
} from "@/lib/forenzx/capability";

const EVIDENCE = {
  id: "00000000-0000-4000-8000-0000000000e1",
  case_id: "00000000-0000-4000-8000-0000000000c1",
  sha256_hash: "a".repeat(64),
  s3_object_key: "cases/c1/e1.pdf",
};
const URL_ = "https://s3.example.test/bucket/e1.pdf?X-Amz-Signature=abc";
const T0 = new Date("2026-01-01T00:00:00Z");

function issue(): SignedEvidenceCapability {
  return generateEvidenceCapability(EVIDENCE, URL_, "e1.pdf");
}

describe("forenzx capability: HMAC integrity (M2M trust)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    vi.stubEnv("FORENZX_M2M_SECRET", "test-secret-value-1234567890");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("issues a capability bound to evidence/case/sha256 with a 15 min TTL", () => {
    const cap = issue();
    expect(cap.issuer).toBe(CAPABILITY_ISSUER);
    expect(cap.expected_sha256).toBe(EVIDENCE.sha256_hash);
    expect(cap.case_id).toBe(EVIDENCE.case_id);
    expect(cap.expires_at - cap.issued_at).toBe(CAPABILITY_TTL_SECONDS);
    expect(CAPABILITY_TTL_SECONDS).toBe(900);
    expect(cap.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same payload and time", () => {
    expect(issue().signature).toBe(issue().signature);
  });

  it("verifies an untampered capability", () => {
    const res = verifyEvidenceCapability(issue());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload.evidence_id).toBe(EVIDENCE.id);
  });

  it.each([
    ["case_id", { case_id: "00000000-0000-4000-8000-0000000000ff" }],
    ["expected_sha256", { expected_sha256: "b".repeat(64) }],
    ["download_url", { download_url: "https://evil.example.test/x" }],
    ["s3_object_key", { s3_object_key: "cases/other/e9.pdf" }],
    ["download_filename", { download_filename: "../../evil.pdf" }],
    ["expires_at (TTL extension)", { expires_at: 9_999_999_999 }],
  ])("rejects a capability with tampered %s", (_name, patch) => {
    const tampered = { ...issue(), ...patch } as SignedEvidenceCapability;
    const res = verifyEvidenceCapability(tampered);
    expect(res.ok).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const cap = issue();
    vi.stubEnv("FORENZX_M2M_SECRET", "another-secret-value-0987654321");
    const res = verifyEvidenceCapability(cap);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/Signature/);
  });

  it("rejects an expired capability", () => {
    const cap = issue();
    vi.setSystemTime(new Date(T0.getTime() + (CAPABILITY_TTL_SECONDS + 1) * 1000));
    const res = verifyEvidenceCapability(cap);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/expired/i);
  });

  it("accepts a capability right up to the expiry boundary", () => {
    const cap = issue();
    vi.setSystemTime(new Date(T0.getTime() + CAPABILITY_TTL_SECONDS * 1000));
    expect(verifyEvidenceCapability(cap).ok).toBe(true);
  });

  it("rejects a capability issued in the future beyond the 30s skew", () => {
    const cap = issue();
    vi.setSystemTime(new Date(T0.getTime() - 60_000));
    const res = verifyEvidenceCapability(cap);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toMatch(/future/i);
  });

  it("tolerates small clock skew (within 30s)", () => {
    const cap = issue();
    vi.setSystemTime(new Date(T0.getTime() - 10_000));
    expect(verifyEvidenceCapability(cap).ok).toBe(true);
  });

  it.each(["", "zz", "abcd", "0".repeat(63)])(
    "rejects malformed signature %j without throwing",
    (signature) => {
      const res = verifyEvidenceCapability({ ...issue(), signature });
      expect(res.ok).toBe(false);
    },
  );

  it("fails closed when the M2M secret is missing", () => {
    const cap = issue();
    vi.stubEnv("FORENZX_M2M_SECRET", "");
    expect(() => generateEvidenceCapability(EVIDENCE, URL_, "e1.pdf")).toThrow(
      /FORENZX_M2M_SECRET/,
    );
    const res = verifyEvidenceCapability(cap);
    expect(res.ok).toBe(false);
  });

  it("treats a whitespace-only secret as missing", () => {
    vi.stubEnv("FORENZX_M2M_SECRET", "   ");
    expect(() => issue()).toThrow(/FORENZX_M2M_SECRET/);
  });
});
