#!/usr/bin/env bash
# =============================================================================
# Rollback posledného staging-update.sh: predchádzajúci commit + predchádzajúci
# release (.next/standalone je symlink na .deploy/releases/<id>), plný PM2
# reštart, overenie. DB sa nemení.
#
#   scripts/deploy/staging-rollback.sh          # vypíše, čo urobí
#   scripts/deploy/staging-rollback.sh --yes    # vykoná rollback
#
# Prvé nasadenie (žiadny predchádzajúci release): proces, ktorý update spustil,
# sa zastaví a odstráni, Git sa vráti — nič sa nepredstiera. Exit != 0 = zlyhanie.
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
STATE="$APP_DIR/.deploy"
[ -f "$STATE/previous-commit" ] || die "chýba $STATE/previous-commit — nie je z čoho vrátiť"
PREV="$(cat "$STATE/previous-commit")"
PREV_RELEASE="$(cat "$STATE/previous-release" 2>/dev/null || true)"
PM2_EXISTED="$(cat "$STATE/pm2-existed" 2>/dev/null || echo 1)"
git cat-file -e "$PREV^{commit}" 2>/dev/null || die "commit $PREV neexistuje"
if [ -n "$PREV_RELEASE" ] && [ ! -f "$PREV_RELEASE/server.js" ]; then
  die "predchádzajúci release chýba alebo je neúplný: $PREV_RELEASE"
fi

echo "Rollback: $(git log -1 --format='%h %s' HEAD)  →  $(git log -1 --format='%h %s' "$PREV")"
if [ -n "$PREV_RELEASE" ]; then echo "  release → $PREV_RELEASE"
else echo "  prvé nasadenie: žiadny predchádzajúci release — nový proces sa zastaví"; fi
if [ "$YES" -ne 1 ]; then echo "Spusti s --yes na vykonanie."; exit 0; fi

# Pracovný strom bol pred update čistý (staging-update.sh to vyžaduje).
if git symbolic-ref -q HEAD >/dev/null; then git reset --quiet --hard "$PREV"
else git checkout --quiet --detach "$PREV"; fi

LIVE="$APP_DIR/.next/standalone"
if [ -z "$PREV_RELEASE" ]; then
  # Prvé nasadenie: nie je čo obnoviť — nenechaj bežať chybný build.
  if [ "$PM2_EXISTED" = "0" ]; then pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
  else pm2 stop "$PM2_APP" >/dev/null 2>&1 || true; fi
  pm2 save >/dev/null 2>&1 || true
  rm -f "$LIVE"
  echo "Rollback prvého nasadenia: proces '$PM2_APP' zastavený, Git vrátený na $(git rev-parse --short HEAD)." >&2
  echo "Staging NEBEŽÍ — nasaď opravenú verziu." >&2
  exit 2
fi

ln -sfn "$PREV_RELEASE" "$LIVE.tmp"
mv -Tf "$LIVE.tmp" "$LIVE"

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
