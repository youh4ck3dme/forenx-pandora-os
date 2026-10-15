// @vitest-environment node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../vercel-preflight.mjs", import.meta.url));
const baseEnvironment = {
  PATH: process.env.PATH ?? "",
  SystemRoot: process.env.SystemRoot ?? "",
  STRICT_ENV_CHECK: "true",
  NEXT_PUBLIC_BASE_URL: "https://pandora.example.com",
  NEXT_PUBLIC_RP_ID: "pandora.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "server-test-key",
  S3_ENDPOINT: "https://hel1.example-objectstorage.com",
  S3_REGION: "hel1",
  S3_BUCKET: "forenx-vault-test",
  S3_ACCESS_KEY_ID: "s3-access-test",
  S3_SECRET_ACCESS_KEY: "s3-secret-test",
  FORENZX_S3_REGION: "hel1",
  FORENZX_S3_BUCKET: "forenx-vault-test",
  FORENZX_S3_ENDPOINT: "https://hel1.example-objectstorage.com",
  FORENZX_S3_ACCESS_KEY_ID: "forenzx-s3-access-test",
  FORENZX_S3_SECRET_ACCESS_KEY: "forenzx-s3-secret-test",
  FORENZX_M2M_SECRET: "m".repeat(64),
  FORENZX_EVIDENCE_WEBHOOK_URL: "https://hub.example.com/evidence-webhook",
  FORENZX_WEBHOOK_SECRET: "forenzx-webhook-test-secret",
  MISTRAL_API_KEY: "mistral-test-key",
};

function runPreflight(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."),
    env: { ...baseEnvironment, ...overrides },
    encoding: "utf8",
  });
}

describe("strict Vercel production preflight", () => {
  it("requires a complete SumUp configuration and cron secret", () => {
    const result = runPreflight();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("SUMUP_API_KEY");
    expect(result.stdout).toContain("SUMUP_MERCHANT_CODE");
    expect(result.stdout).toContain("SUMUP_ENVIRONMENT");
    expect(result.stdout).toContain("CRON_SECRET");
  });

  it("requires the ForenZX dispatch webhook configuration", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "c".repeat(64),
      FORENZX_EVIDENCE_WEBHOOK_URL: "",
      FORENZX_WEBHOOK_SECRET: "",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FORENZX_EVIDENCE_WEBHOOK_URL");
    expect(result.stdout).toContain("FORENZX_WEBHOOK_SECRET");
  });

  it("accepts live SumUp credentials without printing secret values", () => {
    const apiKey = "sumup_private_test_marker_8f6b";
    const result = runPreflight({
      SUMUP_API_KEY: apiKey,
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "c".repeat(64),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("All production cloud environment variables are configured");
    expect(result.stdout).not.toContain(apiKey);
  });

  it("rejects sandbox billing in strict production mode", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "TESTMERCHANT",
      SUMUP_ENVIRONMENT: "sandbox",
      CRON_SECRET: "c".repeat(64),
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("TEST MODE");
  });

  it("rejects a cron secret shorter than the renewal route accepts", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "too-short",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("TOO SHORT");
  });

  it("rejects an M2M secret too weak for signed evidence capabilities", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "c".repeat(64),
      FORENZX_M2M_SECRET: "short",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FORENZX_M2M_SECRET");
    expect(result.stdout).toContain("TOO SHORT");
  });

  it("rejects an insecure ForenZX S3 endpoint in production", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "c".repeat(64),
      FORENZX_S3_ENDPOINT: "http://vault.example.com",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("INVALID URL");
  });

  it("rejects an insecure evidence webhook URL in production", () => {
    const result = runPreflight({
      SUMUP_API_KEY: "sumup_private_test_marker_8f6b",
      SUMUP_MERCHANT_CODE: "LIVEMERCHANT",
      SUMUP_ENVIRONMENT: "live",
      CRON_SECRET: "c".repeat(64),
      FORENZX_EVIDENCE_WEBHOOK_URL: "http://hub.example.com/evidence-webhook",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("INVALID URL");
  });
});
