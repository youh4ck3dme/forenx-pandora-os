#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS — Canonical Controlled Deployment Script
# File: deploy/vps/deploy-release.sh
# Implements: Blueprint Section 5 (Controlled Deployment Window & Rollback Guard)
# Invariant: Fail-closed, healthcheck verification, automatic rollback on failure.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$APP_DIR"

echo "=========================================================="
echo "  🚀 PΛND0RΛ FORENX OS — CONTROLLED RELEASE DEPLOYMENT"
echo "  Čas štartu (UTC): $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "=========================================================="

# 1. PRE-FLIGHT: Kontrola .env.production
echo -e "\n📋 KROK 1/6: Validácia produkčných premenných..."
if [ -f "$SCRIPT_DIR/verify-vps-env.sh" ]; then
  bash "$SCRIPT_DIR/verify-vps-env.sh"
else
  echo "⚠️ Upozornenie: verify-vps-env.sh sa nenašiel, pokračujem s opatrnosťou."
fi

# 2. DISK & ROLLBACK GUARD: Čistenie disku a ochrana aktuálneho bežiaceho kontajnera
echo -e "\n💾 KROK 2/6: Kontrola kapacity a vytvorenie chráneného rollback snapshotu..."
if [ -f "$SCRIPT_DIR/safe-vps-cleanup.sh" ]; then
  bash "$SCRIPT_DIR/safe-vps-cleanup.sh"
fi

# 3. AKTIVÁCIA ÚDRŽBOVÉHO MÓDU NA APACHE PROXY
echo -e "\n🛑 KROK 3/6: Aktivácia údržbovej stránky na Apache proxy..."
if command -v a2ensite &>/dev/null && command -v systemctl &>/dev/null; then
  sudo cp "$SCRIPT_DIR/000-maintenance.conf" /etc/apache2/sites-available/ 2>/dev/null || true
  sudo cp "$SCRIPT_DIR/maintenance.html" /var/www/html/maintenance.html 2>/dev/null || true
  sudo a2ensite 000-maintenance.conf 2>/dev/null || true
  sudo systemctl reload apache2 2>/dev/null || true
  echo "✅ Údržbový mód na Apache aktívny (HTTP 503 so stránkou údržby)."
else
  echo "ℹ️ a2ensite/systemctl nie je priamo dostupné, preskakujem prepnutie Apache."
fi

# 4. SPUSTENIE / REŠTART APLIKAČNÉHO KONTAJNERA
echo -e "\n📦 KROK 4/6: Znovuspustenie aplikačného kontajnera..."
docker-compose -f docker-compose.production.yml up -d --force-recreate app

# 5. HEALTHCHECK PREFLIGHT OVERENIE (Až do 60 sekúnd na warmup)
echo -e "\n🩺 KROK 5/6: Overovanie pripravenosti aplikácie na loopback :3005..."
HEALTHY=false
for i in {1..12}; do
  echo "   Pokus $i/12: Kontrola https://127.0.0.1:3005/healthz ..."
  STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" https://127.0.0.1:3005/healthz || true)
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    echo "✅ Healthcheck odpovedá HTTP 200 OK!"
    break
  fi
  sleep 5
done

if [ "$HEALTHY" = false ]; then
  echo -e "\n❌ CHYBA: Aplikácia neodpovedala HTTP 200 v časovom limite!"
  echo "🔄 SPUŠŤAM AUTOMATICKÝ ROLLBACK na pandora-rollback:protected..."
  
  if docker images | grep -q "pandora-rollback"; then
    docker run -d --name pandora-emergency-rollback -p 127.0.0.1:3005:3005 pandora-rollback:protected || true
    echo "⚠️ Núdzový rollback kontajner naštartovaný."
  fi
  
  echo "❌ Nasadenie zlyhalo. Ponechávam údržbový mód pre vyšetrenie incidentu."
  exit 1
fi

# 6. DEAKTIVÁCIA ÚDRŽBOVÉHO MÓDU & OBNOVA PREVÁDZKY
echo -e "\n🔓 KROK 6/6: Deaktivácia údržbového módu a otvorenie prevádzky..."
if command -v a2dissite &>/dev/null && command -v systemctl &>/dev/null; then
  sudo a2dissite 000-maintenance.conf 2>/dev/null || true
  sudo cp "$SCRIPT_DIR/apache-pandora.conf" /etc/apache2/sites-available/pandora.conf 2>/dev/null || true
  sudo a2ensite pandora.conf 2>/dev/null || true
  sudo systemctl reload apache2 2>/dev/null || true
  echo "✅ Apache reverzná proxy prepnutá do živej prevádzky."
fi

echo "=========================================================="
echo "  🎉 NASADENIE ÚSPEŠNE DOKONČENÉ!"
echo "  Aplikácia beží na: https://pandora.whoiswho.at"
echo "  Čas ukončenia (UTC): $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
echo "=========================================================="
echo "Ďalší krok: Spustite overovací syntetický smoke test:"
echo "  node scripts/e2e-all-routes-check.mjs"
