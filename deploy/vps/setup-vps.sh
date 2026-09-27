#!/usr/bin/env bash
# ==============================================================================
# PΛND0RΛ FORENX OS - AUTOMATED VPS INSTALLATION & DEPLOYMENT SCRIPT
# Pre Ubuntu 22.04 / 24.04 LTS & Debian 12
# Doména: pandora.whoiswho.at
#
# Tento skript:
# 1. Nainštaluje Node.js 22 LTS, PM2 a Nginx (ak chýbajú)
# 2. Nastaví Nginx s 600s timeoutom pre neobmedzené Mistral AI volania
# 3. Vygeneruje Let's Encrypt SSL certifikát
# 4. Skompiluje Next.js standalone build
# 5. Spustí aplikáciu cez PM2 s automatickým reštartom po páde či reboote VPS
# ==============================================================================

set -e

DOMAIN="pandora.whoiswho.at"
APP_DIR="/var/www/pandora-browser"

echo "========================================================"
echo "  🚀 PΛND0RΛ FORENX OS - VPS DEPLOYMENT FOR $DOMAIN"
echo "========================================================"

# 1. Aktualizácia systému a základných balíkov
echo "📦 Aktualizácia balíkov..."
sudo apt update && sudo apt install -y curl wget git nginx certbot python3-certbot-nginx

# 2. Inštalácia Node.js 22 LTS
if ! command -v node &> /dev/null; then
    echo "📦 Inštalácia Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 3. Inštalácia PM2 globálne
if ! command -v pm2 &> /dev/null; then
    echo "📦 Inštalácia PM2 process managera..."
    sudo npm install -g pm2
fi

# 4. Príprava adresára aplikácie
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

cd $APP_DIR

# 5. Inštalácia závislostí a Standalone Build
echo "🔨 Inštalácia npm modulov a kompilácia Standalone buildu..."
npm ci
export STANDALONE="true"
npm run build

# 6. Skopírovanie statických súborov do standalone priečinka (vyžaduje Next.js)
echo "📁 Príprava standalone assetov..."
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/

# 7. Konfigurácia Nginx s 600s AI timeoutom
echo "🌐 Nastavovanie Nginx reverznej proxy..."
sudo cp deploy/vps/nginx-pandora.conf /etc/nginx/sites-available/$DOMAIN
sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/
sudo nginx -t

# 8. SSL Certifikát
echo "🔒 Získanie Let's Encrypt SSL certifikátu..."
sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@whoiswho.at --redirect || true

sudo systemctl reload nginx

# 9. Spustenie aplikácie cez PM2
echo "⚡ Spúšťanie PΛND0RΛ cez PM2..."
pm2 delete pandora-browser 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup | tail -n 1 | sudo bash || true

echo "========================================================"
echo "  🎉 NASADENIE DOKONČENÉ!"
echo "  Aplikácia beží na: https://$DOMAIN"
echo "  Mistral AI timeout: 600 sekúnd bez limitu Vercelu"
echo "========================================================"
