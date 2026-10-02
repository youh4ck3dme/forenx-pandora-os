#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS — VPS ALERT WATCHDOG & INTEGRITY MONITOR
# ==============================================================================
# Blueprint P5 & docs/ALERTING.md:
# Sledovanie systémových prahov na VPS a odosielanie alertov operátorom:
#   - disk_usage_80pct  (>= 80 %)
#   - disk_usage_90pct  (>= 90 %)
#   - repeated_5xx_errors (>= 5 chýb za posledných 5 min v Apache logoch)
#   - db_storage_unavailable (/api/health/public)
#
# Použitie:
#   /var/www/pandora-browser/deploy/vps/alert-watchdog.sh
#   /var/www/pandora-browser/deploy/vps/alert-watchdog.sh --test-alert
# ==============================================================================

set -euo pipefail

LOG_FILE="/var/log/pandora-alerts.log"
APP_DIR="${PANDORA_APP_DIR:-/var/www/pandora-browser}"
HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-http://127.0.0.1:3005/api/health/public}"
APACHE_LOG="${APACHE_ERROR_LOG:-/var/log/apache2/pandora_error.log}"
WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# Načítanie ALERT_WEBHOOK_URL z .env.local ak existuje
if [ -z "$WEBHOOK_URL" ] && [ -f "$APP_DIR/.env.local" ]; then
  WEBHOOK_URL=$(grep -E '^ALERT_WEBHOOK_URL=' "$APP_DIR/.env.local" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
fi

send_alert() {
  local alert_id="$1"
  local severity="$2"
  local message="$3"
  local action="$4"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local payload
  payload=$(cat <<EOF
{
  "system": "PΛND0RΛ FORENX OS",
  "event": "SECURITY_INTEGRITY_ALERT",
  "timestamp": "$timestamp",
  "alert_id": "$alert_id",
  "severity": "$severity",
  "message": "$message",
  "host": "pandora.whoiswho.at",
  "environment": "production",
  "recommended_action": "$action"
}
EOF
)

  echo "[$timestamp] [ALERT] [$severity] $alert_id: $message" >&2
  if [ -w "$(dirname "$LOG_FILE")" ]; then
    echo "[$timestamp] [$severity] $alert_id: $message | Akcia: $action" >> "$LOG_FILE" 2>/dev/null || true
  fi

  if [ -n "$WEBHOOK_URL" ]; then
    curl -s -X POST -H "Content-Type: application/json" \
      --max-time 10 \
      -d "$payload" \
      "$WEBHOOK_URL" > /dev/null 2>&1 || echo "[$timestamp] [WARN] Odoslanie webhooku zlyhalo." >&2
  fi
}

# 1. Režim testovacieho alertu
if [ "${1:-}" = "--test" ] || [ "${1:-}" = "--test-alert" ]; then
  echo "Spúšťam odoslanie testovacieho alertu..."
  send_alert "test_alert_delivery" "HIGH" "[TEST] Testovacie overenie varovného kanála PANDORA ForenX OS" "Potvrdiť prijatie alertu v operátorskej konzole."
  echo "Testovací alert bol odoslaný/zaznamenaný."
  exit 0
fi

# 2. Kontrola kapacity disku VPS
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ -n "$DISK_USAGE" ]; then
  if [ "$DISK_USAGE" -ge 90 ]; then
    send_alert "disk_usage_90pct" "CRITICAL" "Kritické zaplnenie disku VPS: ${DISK_USAGE}%" "Spustiť safe-vps-cleanup.sh na okamžité uvoľnenie miesta."
  elif [ "$DISK_USAGE" -ge 80 ]; then
    send_alert "disk_usage_80pct" "MEDIUM" "Zvýšené zaplnenie disku VPS: ${DISK_USAGE}%" "Skontrolovať staré docker images a aplikačné logy."
  fi
fi

# 3. Kontrola 5xx chýb v Apache logu za posledných 5 minút
if [ -f "$APACHE_LOG" ]; then
  ERR_5XX_COUNT=$(grep -E ' 50[0-9] ' "$APACHE_LOG" 2>/dev/null | tail -n 50 | wc -l || true)
  if [ "$ERR_5XX_COUNT" -ge 5 ]; then
    send_alert "repeated_5xx_errors" "HIGH" "Detekovaných ${ERR_5XX_COUNT} chýb 5xx v proxy logu za posledné obdobie." "Skontrolovať stav aplikácie v docker-compose."
  fi
fi

# 4. Kontrola dostupnosti aplikačného health endpointu
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_ENDPOINT" 2>/dev/null || echo "000")
if [ "$HEALTH_STATUS" != "200" ]; then
  send_alert "db_storage_unavailable" "CRITICAL" "Healthcheck na $HEALTH_ENDPOINT vrátil HTTP status $HEALTH_STATUS." "Preveriť beh Next.js kontajnera, Supabase a S3 Trezoru."
fi
