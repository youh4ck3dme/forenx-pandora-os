// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classify } from "../../scripts/release/package.mjs";

describe("release packaging filter", () => {
  it("fails closed on tracked secrets and local databases", () => {
    const { forbidden } = classify([
      ".env",
      ".env.local",
      ".env.production",
      "config/.env.staging",
      "certs/server.key",
      "keys/id_ed25519",
      "data/local.sqlite",
      "backup.dump",
    ]);
    expect(forbidden).toHaveLength(8);
  });

  it("keeps templates and app code, drops tests, logs and caches", () => {
    const { forbidden, included } = classify([
      ".env.example",
      ".env.production.example",
      ".npmrc",
      "app/page.tsx",
      "supabase/migrations/1_init.sql",
      "supabase/tests/harness.ts",
      "lib/__tests__/x.test.ts",
      "e2e/core-flows.spec.ts",
      "logs/app.log",
      "node_modules/x/index.js",
      ".next/cache/a",
      "tsconfig.tsbuildinfo",
    ]);
    expect(forbidden).toEqual([]);
    expect(included).toEqual([
      ".env.example",
      ".env.production.example",
      ".npmrc",
      "app/page.tsx",
      "supabase/migrations/1_init.sql",
    ]);
  });
});
