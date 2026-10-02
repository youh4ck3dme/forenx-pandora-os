// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  evaluateThresholds,
  formatAlertPayload,
  dispatchAlert,
} from "../../scripts/test-alert-dispatch.mjs";

describe("P5 — Alert thresholds evaluation (docs/ALERTING.md)", () => {
  it("detekuje disk_usage_80pct a disk_usage_90pct správne", () => {
    const normal = evaluateThresholds({ diskUsagePercent: 75 });
    expect(normal).toEqual([]);

    const warn = evaluateThresholds({ diskUsagePercent: 82 });
    expect(warn.length).toBe(1);
    expect(warn[0].id).toBe("disk_usage_80pct");
    expect(warn[0].severity).toBe("medium");

    const crit = evaluateThresholds({ diskUsagePercent: 92 });
    expect(crit.length).toBe(1);
    expect(crit[0].id).toBe("disk_usage_90pct");
    expect(crit[0].severity).toBe("critical");
  });

  it("detekuje repeated_5xx_errors", () => {
    const low = evaluateThresholds({ recent5xxCount: 4 });
    expect(low).toEqual([]);

    const high = evaluateThresholds({ recent5xxCount: 5 });
    expect(high.some((a) => a.id === "repeated_5xx_errors")).toBe(true);
  });

  it("detekuje db_storage_unavailable pri public health fail", () => {
    const fail = evaluateThresholds({ publicHealth: { ok: false, error: "Database offline" } });
    expect(fail.some((a) => a.id === "db_storage_unavailable")).toBe(true);

    const ok = evaluateThresholds({ publicHealth: { ok: true } });
    expect(ok.some((a) => a.id === "db_storage_unavailable")).toBe(false);
  });

  it("detekuje AI anomálie (timeouty > 60s a failure rate > 10%)", () => {
    const alerts = evaluateThresholds({
      ai: {
        total: 100,
        failed: 12,
        timeouts_over_60s: 2,
        failure_rate_percent: 12,
      },
    });

    expect(alerts.some((a) => a.id === "ai_timeouts_over_60s")).toBe(true);
    expect(alerts.some((a) => a.id === "ai_failure_rate_over_10pct")).toBe(true);
  });

  it("detekuje kritické S3 zlyhanie nad 1%", () => {
    const alerts = evaluateThresholds({
      s3: {
        uploads: 200,
        failed: 3,
        failure_rate_percent: 1.5,
      },
    });

    expect(alerts.some((a) => a.id === "s3_failure_rate_over_1pct")).toBe(true);
    const s3Alert = alerts.find((a) => a.id === "s3_failure_rate_over_1pct");
    expect(s3Alert?.severity).toBe("critical");
  });

  it("detekuje vysoký počet supabase chýb (>= 10)", () => {
    const low = evaluateThresholds({ supabase: { errors_24h: 9 } });
    expect(low.some((a) => a.id === "supabase_errors_high")).toBe(false);

    const high = evaluateThresholds({ supabase: { errors_24h: 10 } });
    expect(high.some((a) => a.id === "supabase_errors_high")).toBe(true);
  });

  it("formátuje alert payload so správnou štruktúrou", () => {
    const payload = formatAlertPayload(
      { id: "s3_failure_rate_over_1pct", severity: "critical", message: "Chyba integrity" },
      { host: "pandora.whoiswho.at", env: "production" },
    );

    expect(payload.system).toBe("PΛND0RΛ FORENX OS");
    expect(payload.alert_id).toBe("s3_failure_rate_over_1pct");
    expect(payload.severity).toBe("CRITICAL");
    expect(payload.host).toBe("pandora.whoiswho.at");
    expect(payload.recommended_action).toContain("LEGAL HOLD");
  });

  it("dispatchAlert zaloguje lokálne pri chýbajúcom webhooku a odošle pri nastavenom", async () => {
    const payload = formatAlertPayload({
      id: "disk_usage_90pct",
      severity: "critical",
      message: "Disk full",
    });

    // 1. Bez webhooku
    const resNoWebhook = await dispatchAlert(payload, undefined);
    expect(resNoWebhook.delivered).toBe(false);
    expect(resNoWebhook.reason).toBe("NO_WEBHOOK_CONFIGURED");

    // 2. So simulovaným webhookom
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const resWebhook = await dispatchAlert(payload, "https://webhook.example.com/alerts");
    expect(resWebhook.delivered).toBe(true);
    expect(resWebhook.status).toBe(200);

    fetchSpy.mockRestore();
  });
});
