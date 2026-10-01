// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REQUIRED,
  checkEnv,
  classify,
  exampleKeys,
  parseEnv,
} from "../../scripts/deploy/env.mjs";

function validEnv(): Map<string, string> {
  const env = new Map<string, string>();
  for (const key of REQUIRED) env.set(key, `value-for-${key.toLowerCase()}`);
  env.set("NEXT_PUBLIC_BASE_URL", "https://pandora.whoiswho.at");
  env.set("NEXT_PUBLIC_SUPABASE_URL", "https://tlmuvzrgighahnjkxoyw.supabase.co");
  env.set("SUPABASE_URL", "https://tlmuvzrgighahnjkxoyw.supabase.co");
  env.set("MISTRAL_API_KEY", "k1");
  return env;
}

describe("deploy env helper", () => {
  it("parses quotes, comments and export prefixes", () => {
    const env = parseEnv('# c\nA="x # y"\nexport B=plain # comment\nC=\'q\'\nD=\n');
    expect([...env.entries()]).toEqual([
      ["A", "x # y"],
      ["B", "plain"],
      ["C", "q"],
      ["D", ""],
    ]);
  });

  it("treats a bare trailing comment as an empty value", () => {
    expect(parseEnv("A=  # POVINNÁ").get("A")).toBe("");
    expect(parseEnv("B=#x").get("B")).toBe("");
  });

  it("derives keys from the example and classifies them", () => {
    const keys = exampleKeys();
    expect(keys).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(keys).toContain("MISTRAL_API_KEY_ANALYSIS");
    expect(classify("SUPABASE_SERVICE_ROLE_KEY")).toBe("secret");
    expect(classify("NEXT_PUBLIC_SUPABASE_URL")).toBe("public");
    expect(classify("S3_REGION")).toBe("config");
    // No secret may be exposed to the browser bundle.
    expect(keys.filter((k) => k.startsWith("NEXT_PUBLIC_")).every((k) => classify(k) === "public")).toBe(true);
  });

  it("accepts a complete production file", () => {
    expect(checkEnv(validEnv(), exampleKeys()).filter((p) => p.level === "error")).toEqual([]);
  });

  it("rejects app-domain hostname as Supabase URL (frontend/server mismatch guard)", () => {
    // Both vars pointing at the app domain — looks like misconfigured reverse-proxy or copy-paste error
    const env = validEnv();
    env.set("NEXT_PUBLIC_SUPABASE_URL", "https://pandora.whoiswho.at/supabase");
    env.set("SUPABASE_URL", "https://pandora.whoiswho.at/supabase");
    const errors = checkEnv(env, exampleKeys()).filter((p) => p.level === "error");
    const errorKeys = errors.map((p) => p.key);
    expect(errorKeys).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(errorKeys).toContain("SUPABASE_URL");
    // Issue text must name the real problem without echoing the value
    const issueTexts = errors.map((p) => p.issue).join(" ");
    // Issue must explain that *.supabase.co is required — hostname (not a secret) may appear in the message
    expect(issueTexts).toMatch(/supabase\.co/);
  });

  it("rejects a valid supabase.co URL for the wrong project ref", () => {
    const env = validEnv();
    env.set("NEXT_PUBLIC_SUPABASE_URL", "https://other-project-id.supabase.co");
    env.set("SUPABASE_URL", "https://other-project-id.supabase.co");
    const errors = checkEnv(env, exampleKeys()).filter((p) => p.level === "error");
    const errorKeys = errors.map((p) => p.key);
    expect(errorKeys).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(errorKeys).toContain("SUPABASE_URL");
    const issueTexts = errors.map((p) => p.issue).join(" ");
    expect(issueTexts).toMatch(/tlmuvzrgighahnjkxoyw/);
  });

  it("rejects frontend/server Supabase URL mismatch even when both are valid supabase.co", () => {
    const env = validEnv();
    env.set("NEXT_PUBLIC_SUPABASE_URL", "https://tlmuvzrgighahnjkxoyw.supabase.co");
    env.set("SUPABASE_URL", "https://other-project-id.supabase.co");
    const errors = checkEnv(env, exampleKeys()).filter((p) => p.level === "error");
    // SUPABASE_URL must be flagged: mismatch + wrong ref
    expect(errors.map((p) => p.key)).toContain("SUPABASE_URL");
  });

  it("accepts Hetzner's documented object-storage endpoint", () => {
    const env = validEnv();
    env.set("S3_ENDPOINT", "https://hel1.your-objectstorage.com");
    expect(checkEnv(env, exampleKeys()).filter((p) => p.level === "error")).toEqual([]);
  });

  it("requires the shared Mistral key or both dedicated keys", () => {
    const onlyChat = validEnv();
    onlyChat.delete("MISTRAL_API_KEY");
    onlyChat.set("MISTRAL_API_KEY_CHAT", "k-chat");
    const errors = checkEnv(onlyChat, exampleKeys()).filter((p) => p.level === "error").map((p) => p.key);
    expect(errors).toEqual(["MISTRAL_API_KEY_ANALYSIS"]);

    const both = validEnv();
    both.delete("MISTRAL_API_KEY");
    both.set("MISTRAL_API_KEY_CHAT", "k-chat");
    both.set("MISTRAL_API_KEY_ANALYSIS", "k-analysis");
    expect(checkEnv(both, exampleKeys()).filter((p) => p.level === "error")).toEqual([]);
  });

  it("rejects a CRON_SECRET the worker endpoint would refuse", () => {
    const env = validEnv();
    env.set("CRON_SECRET", "too-short");
    expect(checkEnv(env, exampleKeys()).map((p) => p.key)).toContain("CRON_SECRET");
    env.set("CRON_SECRET", "c".repeat(64));
    expect(checkEnv(env, exampleKeys()).filter((p) => p.level === "error")).toEqual([]);
  });

  it("reports missing, placeholder, leaked and forbidden values without echoing them", () => {
    const env = validEnv();
    env.delete("S3_SECRET_ACCESS_KEY");
    env.delete("MISTRAL_API_KEY");
    env.set("SUPABASE_SERVICE_ROLE_KEY", "your-service-role-key");
    env.set("NEXT_PUBLIC_STRIPE_SECRET_KEY", "leak-marker-9f3a2c");
    env.set("VAULT_FALLBACK_SECRET", "x".repeat(40));
    env.set("SUPABASE_URL", "https://other.supabase.co");
    env.set("NEXT_PUBLIC_BASE_URL", "http://pandora.whoiswho.at");

    const problems = checkEnv(env, exampleKeys());
    const errors = problems.filter((p) => p.level === "error").map((p) => p.key);
    expect(errors).toEqual(
      expect.arrayContaining([
        "S3_SECRET_ACCESS_KEY",
        "MISTRAL_API_KEY | MISTRAL_API_KEY_CHAT | MISTRAL_API_KEY_ANALYSIS",
        "SUPABASE_SERVICE_ROLE_KEY",
        "NEXT_PUBLIC_STRIPE_SECRET_KEY",
        "VAULT_FALLBACK_SECRET",
        "SUPABASE_URL",
        "NEXT_PUBLIC_BASE_URL",
      ]),
    );
    const text = JSON.stringify(problems);
    expect(text).not.toContain("leak-marker-9f3a2c");
    expect(text).not.toContain("your-service-role-key");
  });
});
