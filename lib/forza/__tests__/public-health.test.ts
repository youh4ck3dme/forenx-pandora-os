import { describe, expect, it } from "vitest";
import {
  buildPublicHealthResponse,
  calculateAiSuccessRate,
  getAiSuccessStatus,
  getOverallHealthStatus,
} from "../public-health";

describe("public health calculations", () => {
  it("calculates live AI success rate and attention threshold", () => {
    expect(calculateAiSuccessRate(43, 6)).toBe(86);
    expect(getAiSuccessStatus(43, 6)).toBe("attention");
    expect(getAiSuccessStatus(100, 10)).toBe("ok");
    expect(getAiSuccessStatus(0, 0)).toBe("unavailable");
  });

  it("returns unavailable for invalid metric input", () => {
    expect(calculateAiSuccessRate(2, 3)).toBeNull();
    expect(getAiSuccessStatus(2, 3)).toBe("unavailable");
    expect(getOverallHealthStatus(["ok", "unavailable"])).toBe("unavailable");
  });

  it("maps database, storage and AI failures to safe public statuses", () => {
    const response = buildPublicHealthResponse(null, null, false);
    const byId = new Map(response.checks.map((check) => [check.id, check]));

    expect(byId.get("database")?.status).toBe("unavailable");
    expect(byId.get("document-storage")?.status).toBe("unavailable");
    expect(byId.get("ai-success")?.status).toBe("unavailable");
    expect(byId.get("database")?.description).not.toMatch(/stack|secret|token/i);
    expect(JSON.stringify(response)).not.toMatch(/api[_-]?key|Bearer|stack trace/i);
  });

  it("does not expose raw AI or database internals in the public response", () => {
    const response = buildPublicHealthResponse(
      {
        case_count: 4,
        latency_ms: 56,
        total_connections: 17,
        max_connections: 60,
        idle_in_transaction: 0,
        waiting_connections: 0,
        database_size_bytes: 14_200_000,
        postgres_version: "17.6",
        ai_total: 43,
        ai_failures: 6,
        error_count: 2,
      },
      1,
      true,
      {
        s3Configured: true,
        s3Available: true,
      },
    );
    const serialized = JSON.stringify(response);

    expect(serialized).toContain("56 ms");
    expect(serialized).toContain("86 % úspešnosť");
    expect(serialized).not.toContain("input_summary");
    expect(serialized).not.toContain("error_message");
    expect(serialized).not.toContain("postgresql://");

    // P5: Every check has an ISO measuredAt timestamp
    for (const check of response.checks) {
      expect(check.measuredAt).toBeDefined();
      expect(new Date(check.measuredAt!).getTime()).not.toBeNaN();
    }

    // P5: S3 vault and Supabase document storage are distinct checks
    const byId = new Map(response.checks.map((check) => [check.id, check]));
    expect(byId.get("document-storage")).toBeDefined();
    expect(byId.get("s3-vault")).toBeDefined();
    expect(byId.get("s3-vault")?.status).toBe("ok");
    expect(byId.get("s3-vault")?.value).toContain("S3 WORM");
  });

  it("evaluates AI failure attention threshold strictly before rounding (Blueprint P5)", () => {
    // 5 failures out of 49 total = 10.204% failure rate
    // If rounded first, success rate is 44/49 = 89.79% -> 90% (which would look like 10% failure)
    // Evaluated before rounding: 5/49 = 0.102 > 0.10 -> attention!
    expect(getAiSuccessStatus(49, 5)).toBe("attention");
    // 1 failure out of 11 total = 9.09% failure rate -> ok
    expect(getAiSuccessStatus(11, 1)).toBe("ok");
  });

  it("distinguishes S3 vault failure from Supabase storage success", () => {
    const response = buildPublicHealthResponse(null, 2, true, {
      s3Configured: true,
      s3Available: false,
    });
    const byId = new Map(response.checks.map((check) => [check.id, check]));
    expect(byId.get("document-storage")?.status).toBe("ok");
    expect(byId.get("s3-vault")?.status).toBe("unavailable");
  });
});

