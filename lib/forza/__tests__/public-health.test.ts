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
    );
    const serialized = JSON.stringify(response);

    expect(serialized).toContain("56 ms");
    expect(serialized).toContain("86 % úspešnosť");
    expect(serialized).not.toContain("input_summary");
    expect(serialized).not.toContain("error_message");
    expect(serialized).not.toContain("postgresql://");
  });
});

