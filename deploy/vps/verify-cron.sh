#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS - S3 EVIDENCE VAULT VERIFICATION CRON RUNNER
# ==============================================================================
# Blueprint P3: Na VPS explicitne sprevádzkovať plánovač verifikácie.
# Spúšťa serverové streamované overenie SHA-256 integrity dôkazov v Hetzner S3.
#
# Použitie cez crontab:
#   */2 * * * * /var/www/pandora-browser/deploy/vps/verify-cron.sh >> /var/log/pandora-verify.log 2>&1
# ==============================================================================

set -euo pipefail

APP_DIR="${PANDORA_APP_DIR:-/var/www/pandora-browser}"
ENDPOINT="${VERIFY_ENDPOINT:-http://127.0.0.1:3000/api/vault/verify}"
SECRET="${CRON_SECRET:-}"

# 1. Ak nie je nastavená premenná prostredia, pokúsiť sa načítať z .env.local alebo systémového súboru
if [ -z "$SECRET" ]; then
  if [ -f "$APP_DIR/.env.local" ]; then
    SECRET=$(grep -E '^CRON_SECRET=' "$APP_DIR/.env.local" | cut -d '=' -f2- | tr -d '"' | tr -d "'" || true)
  elif [ -f "/etc/pandora/cron.secret" ]; then
    SECRET=$(cat "/etc/pandora/cron.secret" | tr -d '\n\r ')
  fi
fi

# 2. Fail-closed: Bez tajomstva o dĺžke min 32 znakov sa verifikácia nespustí
if [ -z "$SECRET" ] || [ "${#SECRET}" -lt 32 ]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] [ERROR] CRON_SECRET nie je nakonfigurovaný alebo je príliš krátky (min 32 znakov). Verifikácia zastavená." >&2
  exit 1
fi

# 3. Vykonanie požiadavky na lokálny Next.js server s 300s limitom
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HTTP_RESPONSE=$(curl -s -S --max-time 300 -w "\n%{http_code}" \
  -H "Authorization: Bearer $SECRET" \
  -H "User-Agent: Pandora-VPS-Verification-Worker/1.0" \
  "$ENDPOINT?limit=25" 2>&1 || true)

HTTP_BODY=$(echo "$HTTP_RESPONSE" | sed '$d')
HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n 1)

if [ "$HTTP_STATUS" = "200" ]; then
  echo "[$TIMESTAMP] [OK] Overenie integrity úspešné: $HTTP_BODY"
else
  echo "[$TIMESTAMP] [FAIL] Overenie integrity zlyhalo (HTTP $HTTP_STATUS): $HTTP_BODY" >&2
  exit 1
fi
