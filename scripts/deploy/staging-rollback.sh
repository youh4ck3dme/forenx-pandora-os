#!/usr/bin/env bash
# =============================================================================
# Rollback posledného staging-update.sh: predchádzajúci commit + predchádzajúci
# build (.next/standalone.prev), `pm2 reload`, overenie. DB sa nemení.
#
#   scripts/deploy/staging-rollback.sh          # vypíše, čo urobí
#   scripts/deploy/staging-rollback.sh --yes    # vykoná rollback
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/pandora-browser}"
PM2_APP="${PM2_APP:-pandora-browser}"
PORT="${PORT:-3005}"
YES=0
[ "${1:-}" = "--yes" ] && YES=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { printf '\nCHYBA: %s\n' "$*" >&2; exit 1; }

cd "$APP_DIR"
PREV_FILE="$APP_DIR/.deploy/previous-commit"
[ -f "$PREV_FILE" ] || die "chýba $PREV_FILE — nie je z čoho vrátiť"
[ -d "$APP_DIR/.next/standalone.prev" ] || die "chýba .next/standalone.prev (predchádzajúci build)"
PREV="$(cat "$PREV_FILE")"
git cat-file -e "$PREV^{commit}" 2>/dev/null || die "commit $PREV neexistuje"

echo "Rollback: $(git log -1 --format='%h %s' HEAD)  →  $(git log -1 --format='%h %s' "$PREV")"
if [ "$YES" -ne 1 ]; then echo "Spusti s --yes na vykonanie."; exit 0; fi

rm -rf "$APP_DIR/.next/standalone.failed"
[ -d "$APP_DIR/.next/standalone" ] && mv "$APP_DIR/.next/standalone" "$APP_DIR/.next/standalone.failed"
mv "$APP_DIR/.next/standalone.prev" "$APP_DIR/.next/standalone"

# Pracovný strom bol pred update čistý (staging-update.sh to vyžaduje).
if git symbolic-ref -q HEAD >/dev/null; then git reset --quiet --hard "$PREV"
else git checkout --quiet --detach "$PREV"; fi

# Plný restart (nie postupný reload): pri rollbacku je služba už narušená a chybné
# workery môžu držať port (napr. iný bind) — postupný reload by skončil na EADDRINUSE.
# Bez HOSTNAME zo shellu: `--update-env` preberá prostredie volajúceho a HOSTNAME =
# názov stroja → Next.js by počúval na IP stroja, nie na 127.0.0.1.
(cd "$APP_DIR" && env -u HOSTNAME pm2 restart ecosystem.config.cjs --update-env)
pm2 save >/dev/null
# Počítadlá reštartov od nuly: meria sa stabilita NOVÉHO stavu, nie staré incidenty.
pm2 reset "$PM2_APP" >/dev/null
sleep "${SETTLE_SECONDS:-5}"
APP_DIR="$APP_DIR" PM2_APP="$PM2_APP" PORT="$PORT" bash "$SCRIPT_DIR/verify-pm2.sh"
