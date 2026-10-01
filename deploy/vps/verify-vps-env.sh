#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS — VPS Production Environment & Permission Verification
# Invariant: Never print secret values to terminal/log. Check SET / MISSING only.
# ==============================================================================

set -euo pipefail

ENV_FILE="/opt/pandora-os/.env.production"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "./.env.production" ]; then
    ENV_FILE="./.env.production"
  else
    echo "❌ CHYBA: .env.production sa nenašiel ani v /opt/pandora-os/ ani v aktuálnom adresári."
    exit 1
  fi
fi

echo "=========================================================="
echo "  🔍 PΛND0RΛ FORENX — VPS .env.production AUDIT"
echo "  Súbor: $ENV_FILE"
echo "=========================================================="

# 1. Kontrola oprávnení súboru (musí byť 600 = rw-------)
PERMS=$(stat -c "%a" "$ENV_FILE" 2>/dev/null || stat -f "%Lp" "$ENV_FILE" 2>/dev/null || echo "unknown")
echo -n "🔒 Oprávnenia súboru (požadované 600): $PERMS ... "
if [ "$PERMS" = "600" ]; then
  echo "✅ OK"
else
  echo "⚠️ UPOZORNENIE (odporúča sa: chmod 600 $ENV_FILE)"
fi

# 2. Načítanie a kontrola kľúčových premenných bez výpisu hodnôt
REQUIRED_VARS=(
  "NEXT_PUBLIC_BASE_URL"
  "NEXT_PUBLIC_SUPABASE_URL"
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "S3_ENDPOINT"
  "S3_REGION"
  "S3_BUCKET"
  "S3_ACCESS_KEY_ID"
  "S3_SECRET_ACCESS_KEY"
  "CRON_SECRET"
  "MISTRAL_API_KEY"
  "FORENZX_WEBHOOK_SECRET"
)

MISSING_COUNT=0
INSECURE_URL_COUNT=0

printf "\n%-32s | %-12s | %-15s\n" "NÁZOV PREMENNEJ" "STAV" "BEZPEČNOSŤ"
echo "---------------------------------+--------------+----------------"

for VAR in "${REQUIRED_VARS[@]}"; do
  # Extrakcia hodnoty zo súboru bez jej vypisovania
  VAL=$(grep "^${VAR}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d ' ' || true)
  
  if [ -z "$VAL" ]; then
    printf "%-32s | ❌ MISSING   | ⚠️ Nenastavené\n" "$VAR"
    MISSING_COUNT=$((MISSING_COUNT + 1))
  else
    # Kontrola dĺžky / formátu
    LEN=${#VAL}
    SEC_STATUS="✅ OK (${LEN} znakov)"
    
    # Špecifické kontroly
    if [[ "$VAR" == *"URL"* || "$VAR" == "S3_ENDPOINT" ]]; then
      if [[ "$VAL" == http://* ]]; then
        SEC_STATUS="❌ NEBEZPEČNÉ (http://)"
        INSECURE_URL_COUNT=$((INSECURE_URL_COUNT + 1))
      elif [[ "$VAL" == https://* ]]; then
        SEC_STATUS="✅ HTTPS"
      fi
    elif [ "$VAR" = "CRON_SECRET" ]; then
      if [ "$LEN" -lt 32 ]; then
        SEC_STATUS="⚠️ Slabé (<32 znakov)"
      fi
    fi
    
    printf "%-32s | ✅ SET       | %s\n" "$VAR" "$SEC_STATUS"
  fi
done

echo "---------------------------------+--------------+----------------"

if [ "$MISSING_COUNT" -eq 0 ] && [ "$INSECURE_URL_COUNT" -eq 0 ]; then
  echo -e "\n🎉 BRÁNA 2.2 SPLNENÁ: Všetky produkčné premenné sú nastavené a zabezpečené."
  exit 0
else
  echo -e "\n❌ BRÁNA 2.2 ZLYHALA: Chýba $MISSING_COUNT premenných, detegovaných $INSECURE_URL_COUNT nešifrovaných HTTP URL."
  exit 1
fi
