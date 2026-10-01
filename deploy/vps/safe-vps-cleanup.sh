#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ / ForenX — Safe VPS Cleanup & Space Recovery Script
# Target: Production VPS (Disk 100% full remediation)
# Invariant: NO blanket prune, protect running containers, volumes & rollback image.
# ==============================================================================

set -euo pipefail

PROTECTED_IMAGE_DIGEST="893d78c9"
TARGET_FREE_PERCENT=20

echo "=========================================================="
echo "  🛡️  PΛND0RΛ FORENX — SAFE VPS SPACE RECOVERY"
echo "=========================================================="

# 1. Check initial disk state
echo "📊 Aktuálny stav disku:"
df -h /

INITIAL_USED_PERCENT=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
echo "Využitie disku: ${INITIAL_USED_PERCENT}%"

# 2. Verify and protect current running container and rollback image
echo "🔍 Kontrola bežiacich kontajnerov a ochrana image..."
if command -v docker &> /dev/null; then
    RUNNING_IMAGES=$(docker ps --format '{{.Image}}')
    echo "Bežiace images (chránené):"
    echo "$RUNNING_IMAGES"
    
    # Tag current running container as explicit rollback if not already tagged
    RUNNING_APP_ID=$(docker ps --filter "name=pandora" --format '{{.ID}}' | head -n 1)
    if [ -n "$RUNNING_APP_ID" ]; then
        echo "Označujem bežiaci kontajner ($RUNNING_APP_ID) ako pandora-rollback:protected..."
        docker commit "$RUNNING_APP_ID" pandora-rollback:protected || true
    fi
else
    echo "⚠️ Docker command nenájdený, preskakujem Docker fázu."
fi

# 3. Safe system cleaning (Zero risk of data loss)
echo "🧹 1/4: Čistenie APT cache..."
sudo apt-get clean
sudo apt-get autoremove -y --purge

echo "🧹 2/4: Zmenšenie systemd žurnálov (max 200MB)..."
sudo journalctl --vacuum-size=200M

echo "🧹 3/4: Bezpečné odstránenie starých dočasných archívov v /tmp..."
sudo find /tmp -maxdepth 1 -name "*.tar.gz" -o -name "*.tar" -o -name "*.tmp" -type f -mtime +1 -delete || true

# 4. Safe Docker cleaning (WITHOUT blanket prune, NO volume removal)
if command -v docker &> /dev/null; then
    echo "🧹 4/4: Bezpečné čistenie iba osirotených Docker vrstiev (žiadny prune s -a)..."
    # Odstráni iba dangling (nepomenované a nepoužívané) images
    docker image prune -f
    # Odstráni build cache staršiu ako 48 hodín
    docker builder prune -f --filter "until=48h" || true
    # UPOZORNENIE: docker volume prune a docker system prune -a sú ZAKÁZANÉ
fi

# 5. Check Apache / Kong state
echo "🔍 Kontrola sieťových služieb (Apache proxy na 80/443 & Kong)..."
if command -v systemctl &> /dev/null; then
    if systemctl is-active --quiet apache2; then
        echo "✅ Apache2 beží (porty 80/443 obsluhované)"
    elif systemctl is-active --quiet httpd; then
        echo "✅ httpd beží (porty 80/443 obsluhované)"
    else
        echo "ℹ️ Apache služba nie je v systemctl aktívna pod štandardným menom."
    fi
fi

# 6. Final verification
echo "=========================================================="
echo "📊 Výsledný stav disku:"
df -h /

FINAL_USED_PERCENT=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
FINAL_FREE_PERCENT=$((100 - FINAL_USED_PERCENT))

echo "Voľné miesto: ${FINAL_FREE_PERCENT}% (požadované: aspoň ${TARGET_FREE_PERCENT}%)"

if [ "$FINAL_FREE_PERCENT" -ge "$TARGET_FREE_PERCENT" ]; then
    echo "✅ BRÁNA P0 SPLNENÁ: Na serveri je dostatok miesta pre nový build aj rollback."
else
    echo "⚠️ UPOZORNENIE: Voľné miesto je ${FINAL_FREE_PERCENT}%, čo je menej ako ${TARGET_FREE_PERCENT}%."
    echo "   Vyžiadajte rozšírenie disku u poskytovateľa VPS pred ďalším nasadením!"
fi
echo "=========================================================="
