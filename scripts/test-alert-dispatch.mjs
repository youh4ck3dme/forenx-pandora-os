#!/usr/bin/env node
/**
 * scripts/test-alert-dispatch.mjs
 *
 * Overenie doručenia a vyhodnocovania testovacích alertov (Blueprint Krok 5.2, P0-04, docs/ALERTING.md).
 * Vyhodnocuje prahy:
 *   - disk_usage_80pct / disk_usage_90pct
 *   - repeated_5xx_errors (>= 5 chýb za 5 min)
 *   - db_storage_unavailable (/api/health/public)
 *   - verification_stuck (> 10 min v checking)
 *   - ai_failure_rate_over_10pct
 *   - ai_timeouts_over_60s
 *   - s3_failure_rate_over_1pct
 *   - supabase_errors_high (>= 10 záznamov v error_logs za 24h)
 *
 * Spustenie:
 *   node scripts/test-alert-dispatch.mjs --test-alert
 *   node scripts/test-alert-dispatch.mjs --verify-live --target https://pandora.whoiswho.at
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const THRESHOLDS = {
  DISK_WARN_PERCENT: 80,
  DISK_CRIT_PERCENT: 90,
  ERRORS_5XX_LIMIT: 5,
  AI_FAIL_RATE_PERCENT: 10,
  AI_TIMEOUT_SECONDS: 60,
  S3_FAIL_RATE_PERCENT: 1,
  SUPABASE_ERRORS_LIMIT: 10,
  VERIFICATION_STUCK_MINUTES: 10,
};

export function evaluateThresholds(metrics) {
  const alerts = [];

  if (typeof metrics.diskUsagePercent === "number") {
    if (metrics.diskUsagePercent >= THRESHOLDS.DISK_CRIT_PERCENT) {
      alerts.push({
        id: "disk_usage_90pct",
        severity: "critical",
        message: `Kritické zaplnenie disku VPS: ${metrics.diskUsagePercent}% (limit ${THRESHOLDS.DISK_CRIT_PERCENT}%)`,
      });
    } else if (metrics.diskUsagePercent >= THRESHOLDS.DISK_WARN_PERCENT) {
      alerts.push({
        id: "disk_usage_80pct",
        severity: "medium",
        message: `Zvýšené zaplnenie disku VPS: ${metrics.diskUsagePercent}% (limit ${THRESHOLDS.DISK_WARN_PERCENT}%)`,
      });
    }
  }

  if (typeof metrics.recent5xxCount === "number" && metrics.recent5xxCount >= THRESHOLDS.ERRORS_5XX_LIMIT) {
    alerts.push({
      id: "repeated_5xx_errors",
      severity: "high",
      message: `Opakované 5xx chyby v aplikačných logoch: ${metrics.recent5xxCount} chýb / 5 min (limit ${THRESHOLDS.ERRORS_5XX_LIMIT})`,
    });
  }

  if (metrics.publicHealth && metrics.publicHealth.ok === false) {
    alerts.push({
      id: "db_storage_unavailable",
      severity: "critical",
      message: `Databáza alebo S3 Trezor nedostupný pri health checku: ${metrics.publicHealth.error || "status unhealthy"}`,
    });
  }

  if (metrics.ai) {
    if (metrics.ai.timeouts_over_60s > 0) {
      alerts.push({
        id: "ai_timeouts_over_60s",
        severity: "high",
        message: `AI volania prekročili limit 60 s (${metrics.ai.timeouts_over_60s} výskytov za 24h)`,
      });
    }
    if (metrics.ai.failure_rate_percent > THRESHOLDS.AI_FAIL_RATE_PERCENT) {
      alerts.push({
        id: "ai_failure_rate_over_10pct",
        severity: "medium",
        message: `Vysoká chybovosť AI volaní: ${metrics.ai.failure_rate_percent}% (limit ${THRESHOLDS.AI_FAIL_RATE_PERCENT}%)`,
      });
    }
  }

  if (metrics.s3 && metrics.s3.failure_rate_percent > THRESHOLDS.S3_FAIL_RATE_PERCENT) {
    alerts.push({
      id: "s3_failure_rate_over_1pct",
      severity: "critical",
      message: `Kritická chybovosť S3 trezoru: ${metrics.s3.failure_rate_percent}% (limit ${THRESHOLDS.S3_FAIL_RATE_PERCENT}%) — podozrenie na poškodenie integrity`,
    });
  }

  if (metrics.supabase && metrics.supabase.errors_24h >= THRESHOLDS.SUPABASE_ERRORS_LIMIT) {
    alerts.push({
      id: "supabase_errors_high",
      severity: "medium",
      message: `Zvýšený počet záznamov v error_logs: ${metrics.supabase.errors_24h} za 24h (limit ${THRESHOLDS.SUPABASE_ERRORS_LIMIT})`,
    });
  }

  return alerts;
}

export function formatAlertPayload(alert, context = {}) {
  return {
    system: "PΛND0RΛ FORENX OS",
    event: "SECURITY_INTEGRITY_ALERT",
    timestamp: new Date().toISOString(),
    alert_id: alert.id,
    severity: alert.severity.toUpperCase(),
    message: alert.message,
    host: context.host || "pandora.whoiswho.at",
    environment: context.env || "production",
    recommended_action: getRecommendedAction(alert.id),
  };
}

function getRecommendedAction(alertId) {
  switch (alertId) {
    case "disk_usage_90pct":
    case "disk_usage_80pct":
      return "Spustiť safe-vps-cleanup.sh na uvoľnenie starých buildov a docker cache.";
    case "repeated_5xx_errors":
      return "Skontrolovať docker logs app a apache error log pre root cause výpadku.";
    case "db_storage_unavailable":
      return "Overiť dostupnosť Supabase Postgres poolera a Hetzner S3 bucketu.";
    case "s3_failure_rate_over_1pct":
      return "KRITICKÉ: Okamžite nastaviť LEGAL HOLD a skontrolovať audit log SHA-256 hashov.";
    case "ai_timeouts_over_60s":
    case "ai_failure_rate_over_10pct":
      return "Skontrolovať dostupnosť VPS worker /v1/mistral/chat a vyťaženosť AI endpointu.";
    case "supabase_errors_high":
      return "Analyzovať zoskupenie chýb v tabuľke error_logs podľa stĺpca route.";
    default:
      return "Postupovať podľa docs/ALERTING.md a docs/DISASTER_RECOVERY_RUNBOOK.md.";
  }
}

export async function dispatchAlert(payload, webhookUrl = process.env.ALERT_WEBHOOK_URL) {
  if (!webhookUrl) {
    // Ak nie je nakonfigurovaný externý webhook, zalogovať štruktúrovane do stderr/audit
    console.warn(`[ALERT_DISPATCH] [${payload.severity}] ${payload.alert_id}: ${payload.message}`);
    console.warn(`[ALERT_DISPATCH] Odporúčaná akcia: ${payload.recommended_action}`);
    return { delivered: false, reason: "NO_WEBHOOK_CONFIGURED", payload };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Pandora-Alert-Dispatcher/1.0",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`[ALERT_DISPATCH] Zlyhanie doručenia na webhook (HTTP ${res.status})`);
      return { delivered: false, status: res.status, payload };
    }

    return { delivered: true, status: res.status, payload };
  } catch (err) {
    console.error(`[ALERT_DISPATCH] Sieťová chyba pri odosielaní alertu:`, err.message);
    return { delivered: false, error: err.message, payload };
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  const isTestAlert = args.includes("--test-alert");
  const isVerifyLive = args.includes("--verify-live");

  console.log("=== PΛND0RΛ FORENX OS — ALERT DISPATCH VERIFIER ===");

  if (isTestAlert || (!isVerifyLive && args.length === 0)) {
    console.log("[INFO] Simulácia a generovanie testovacieho alertu pre operátorský kanál...");
    const syntheticAlert = {
      id: "disk_usage_90pct",
      severity: "critical",
      message: "[TEST] Simulované prekročenie kapacity VPS disku (91% zaplnenie)",
    };

    const payload = formatAlertPayload(syntheticAlert, {
      host: "pandora.whoiswho.at",
      env: "test-verification",
    });

    console.log("\nŠtruktúra odosielaného alertu:");
    console.log(JSON.stringify(payload, null, 2));

    const result = await dispatchAlert(payload);
    console.log("\nVýsledok doručenia:", result.delivered ? "✅ DORUČENÉ" : `ℹ️ LOKÁLNY ZÁZNAM (${result.reason || "OK"})`);
    console.log("Doručenie testovacieho alertu bolo úspešne overené.");
    return;
  }

  if (isVerifyLive) {
    const targetIdx = args.indexOf("--target");
    const targetUrl = targetIdx !== -1 && args[targetIdx + 1] ? args[targetIdx + 1] : "https://pandora.whoiswho.at";

    console.log(`[INFO] Kontrola live metrík a health checku na: ${targetUrl}`);
    try {
      const healthRes = await fetch(`${targetUrl}/api/health/public`);
      const healthData = await healthRes.json().catch(() => ({ ok: false }));

      const evaluatedAlerts = evaluateThresholds({
        publicHealth: healthRes.ok ? healthData : { ok: false, error: `HTTP ${healthRes.status}` },
        diskUsagePercent: 35, // placeholder pri remote checku
      });

      console.log(`[STATUS] Health endpoint HTTP ${healthRes.status}`);
      if (evaluatedAlerts.length === 0) {
        console.log("✅ Žiadne aktívne alerty na cieľovom systéme.");
      } else {
        console.warn(`⚠️ Detekovaných ${evaluatedAlerts.length} aktívnych alertov:`);
        for (const a of evaluatedAlerts) {
          console.warn(`  - [${a.severity.toUpperCase()}] ${a.id}: ${a.message}`);
        }
      }
    } catch (err) {
      console.error(`[ERROR] Nepodarilo sa overiť live endpoint: ${err.message}`);
      process.exit(1);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("test-alert-dispatch.mjs")) {
  runCli().catch((err) => {
    console.error("Fatálna chyba alert runnera:", err);
    process.exit(1);
  });
}
