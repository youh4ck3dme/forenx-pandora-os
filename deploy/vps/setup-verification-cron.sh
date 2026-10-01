#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS - SETUP S3 VERIFICATION CRON ON VPS
# ==============================================================================
# Blueprint P3: Nainštaluje cron job pre pravidelnú verifikáciu integrity
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$SCRIPT_DIR/verify-cron.sh"
LOG_FILE="/var/log/pandora-verify.log"

echo "=========================================================="
echo "  🛡️ Inštalácia plánovača verifikácie S3 trezoru"
echo "=========================================================="

if [ ! -f "$RUNNER" ]; then
  echo "Chyba: Skript $RUNNER neexistuje." >&2
  exit 1
fi

chmod +x "$RUNNER"
echo "✅ Práva pre $RUNNER nastavené."

# Príprava logovacieho súboru s bezpečnými právami
sudo touch "$LOG_FILE" || touch "$LOG_FILE" || true
sudo chmod 640 "$LOG_FILE" 2>/dev/null || true

# Inštalácia cron úlohy každé 2 minúty
CRON_JOB="*/2 * * * * $RUNNER >> $LOG_FILE 2>&1"

# Skontrolovať, či už cron job existuje
if crontab -l 2>/dev/null | grep -Fq "$RUNNER"; then
  echo "ℹ️ Cron úloha už existuje v crontab."
else
  (crontab -l 2>/dev/null || true; echo "$CRON_JOB") | crontab -
  echo "✅ Cron úloha úspešne pridaná do crontab (interval: každé 2 minúty)."
fi

echo "=========================================================="
echo "  🎉 Plánovač verifikácie úspešne sprevádzkovaný!"
echo "  Logy: $LOG_FILE"
echo "=========================================================="
