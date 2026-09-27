#!/usr/bin/env bash
# =============================================================================
# Staging / VPS: bezpečný `git pull main` + rebuild + PM2 reload.
#
#   scripts/deploy/staging-update.sh                  # DRY RUN: iba plán, nič nemení
#   scripts/deploy/staging-update.sh --apply          # vykoná update
#   scripts/deploy/staging-update.sh --apply --ack-migrations
#
# Zásady:
# - NIKDY nespúšťa DB migrácie. Ak pull prináša nové súbory v supabase/migrations/,
#   --apply skončí, kým ich výslovne nepotvrdíš (--ack-migrations) — migrácie sa
#   aplikujú samostatne (supabase db push), podľa docs/DEPLOYMENT.md.
# - Iba fast-forward na cieľ (default origin/main); čistý pracovný strom.
# - Build beží v ODDELENOM adresári (git worktree $BUILD_DIR), nie v živom — beziaci
#   server počas buildu nestratí súbory. Nový build sa pred výmenou spustí na
#   dočasnom porte a musí odpovedať.
# - Výmena: .next/standalone → .next/standalone.prev, nový build na miesto,
#   `pm2 reload` (cluster, postupne), overenie verify-pm2.sh. Pri zlyhaní
#   automatický rollback na predchádzajúci commit aj build.
#
# Premenné: APP_DIR (/var/www/pandora-browser), BUILD_DIR (/var/www/pandora-build),
#           PM2_APP (pandora-browser), PORT (3005), SMOKE_PORT (3905), REF (origin/main),
#           BUILD_CMD ("npm ci --no-audit --no-fund && npm run build:vps").
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/pandora-browser}"
BUILD_DIR="${BUILD_DIR:-/var/www/pandora-build}"
PM2_APP="${PM2_APP:-pandora-browser}"
PORT="${PORT:-3005}"
SMOKE_PORT="${SMOKE_PORT:-3905}"
REF="${REF:-origin/main}"
BUILD_CMD="${BUILD_CMD:-npm ci --no-audit --no-fund && npm run build:vps}"
APPLY=0
ACK_MIGRATIONS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --ack-migrations) ACK_MIGRATIONS=1; shift ;;
    --ref) REF="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "Neznámy parameter: $1" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die()  { printf '\nCHYBA: %s\n' "$*" >&2; exit 1; }

# ----------------------------------------------------------------- preflight
say "Preflight ($([ "$APPLY" -eq 1 ] && echo APPLY || echo 'DRY RUN'))"
for bin in git node npm pm2 curl; do
  command -v "$bin" >/dev/null 2>&1 || die "chýba nástroj: $bin"
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 6 ]; }; then
  die "Node $(node -v) nepodporuje --env-file (treba >= 20.6)"
fi
info "node $(node -v), pm2 $(pm2 -v 2>/dev/null | tail -n 1)"

[ -d "$APP_DIR/.git" ] || die "$APP_DIR nie je git repozitár"
cd "$APP_DIR"
[ -f .env.production ] || die "$APP_DIR/.env.production neexistuje"
ENV_MODE="$(stat -c '%a' .env.production 2>/dev/null || echo '?')"
[ "$ENV_MODE" = "600" ] || [ "$ENV_MODE" = "400" ] || die ".env.production má práva $ENV_MODE — nastav chmod 600"

if [ -n "$(git status --porcelain)" ]; then
  git status --short | head -n 20
  die "pracovný strom v $APP_DIR nie je čistý (lokálne zmeny by sa prepísali)"
fi

FREE_MB="$(df -Pm "$(dirname "$BUILD_DIR")" | awk 'NR==2 {print $4}')"
[ "${FREE_MB:-0}" -ge 2048 ] || die "málo miesta na disku: ${FREE_MB} MB (treba >= 2048 MB)"
info "voľné miesto: ${FREE_MB} MB"

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then PM2_EXISTS=1; info "PM2 proces '$PM2_APP' existuje"
else PM2_EXISTS=0; info "PM2 proces '$PM2_APP' neexistuje — po update sa spustí"; fi

# --------------------------------------------------------------------- plan
say "Plán"
git fetch --prune origin
CURRENT="$(git rev-parse HEAD)"
TARGET="$(git rev-parse "$REF^{commit}")" || die "neznámy cieľ: $REF"
info "aktuálne: $(git log -1 --format='%h %s' "$CURRENT")"
info "cieľ:     $(git log -1 --format='%h %s' "$TARGET") ($REF)"

if [ "$CURRENT" = "$TARGET" ]; then
  say "Staging je aktuálny — nič na vykonanie."
  exit 0
fi
git merge-base --is-ancestor "$CURRENT" "$TARGET" \
  || die "cieľ nie je fast-forward od aktuálneho commitu (lokálne commity alebo prepísaná história)"

info "nové commity: $(git rev-list --count "$CURRENT..$TARGET")"
git log --oneline --no-decorate "$CURRENT..$TARGET" | head -n 30 | sed 's/^/      /'

NEW_MIGRATIONS="$(git diff --name-only --diff-filter=A "$CURRENT" "$TARGET" -- supabase/migrations/ || true)"
CHANGED_MIGRATIONS="$(git diff --name-only --diff-filter=MR "$CURRENT" "$TARGET" -- supabase/migrations/ || true)"
if [ -n "$NEW_MIGRATIONS$CHANGED_MIGRATIONS" ]; then
  say "POZOR: zmeny v DB migráciách (tento skript ich NEAPLIKUJE)"
  [ -n "$NEW_MIGRATIONS" ] && printf '%s\n' "$NEW_MIGRATIONS" | sed 's/^/    nová:     /'
  [ -n "$CHANGED_MIGRATIONS" ] && printf '%s\n' "$CHANGED_MIGRATIONS" | sed 's/^/    zmenená:  /'
  info "Kód z cieľa môže tieto DB objekty používať. Migrácie aplikuj samostatne (docs/DEPLOYMENT.md, sekcia 2)."
  if [ "$APPLY" -eq 1 ] && [ "$ACK_MIGRATIONS" -ne 1 ]; then
    die "update zastavený: potvrď --ack-migrations, že nasadzuješ kód bez týchto migrácií (alebo sú už aplikované)"
  fi
fi

if [ "$APPLY" -ne 1 ]; then
  say "DRY RUN — nič sa nezmenilo. Na vykonanie: $0 --apply${NEW_MIGRATIONS:+ --ack-migrations}"
  exit 0
fi

# -------------------------------------------------------------------- lock
mkdir -p "$APP_DIR/.deploy"
exec 9>"$APP_DIR/.deploy/lock"
command -v flock >/dev/null 2>&1 && { flock -n 9 || die "iný update práve beží ($APP_DIR/.deploy/lock)"; }

# -------------------------------------------------------- build (oddelene)
say "Build v oddelenom adresári $BUILD_DIR"
if [ -e "$BUILD_DIR/.git" ]; then
  git -C "$BUILD_DIR" checkout --detach --force "$TARGET"
  git -C "$BUILD_DIR" clean -fdx -e node_modules -q
else
  git worktree prune
  git worktree add --detach "$BUILD_DIR" "$TARGET"
fi
ln -sfn "$APP_DIR/.env.production" "$BUILD_DIR/.env.production"

(
  cd "$BUILD_DIR"
  if [ -f scripts/deploy/env.mjs ]; then
    node scripts/deploy/env.mjs check .env.production || { echo "ENV check zlyhal" >&2; exit 1; }
  fi
  bash -c "$BUILD_CMD"
  [ -f .next/standalone/server.js ] || { echo "build nevytvoril .next/standalone/server.js" >&2; exit 1; }
  [ -d public ] && cp -r public .next/standalone/
  mkdir -p .next/standalone/.next
  [ -d .next/static ] && cp -r .next/static .next/standalone/.next/
  true
) || die "build zlyhal — živý staging nebol zmenený"

say "Smoke test nového buildu na 127.0.0.1:$SMOKE_PORT"
(
  cd "$BUILD_DIR/.next/standalone"
  NODE_ENV=production PORT="$SMOKE_PORT" HOSTNAME=127.0.0.1 \
    node --env-file="$APP_DIR/.env.production" server.js >"$APP_DIR/.deploy/smoke.log" 2>&1 &
  echo $! >"$APP_DIR/.deploy/smoke.pid"
)
SMOKE_PID="$(cat "$APP_DIR/.deploy/smoke.pid")"
SMOKE_CODE="000"
for _ in $(seq 1 30); do
  SMOKE_CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/" || true)"
  case "$SMOKE_CODE" in 2??|3??) break ;; esac
  sleep 2
done
kill "$SMOKE_PID" 2>/dev/null || true
wait "$SMOKE_PID" 2>/dev/null || true
case "$SMOKE_CODE" in
  2??|3??) info "nový build odpovedá: HTTP $SMOKE_CODE" ;;
  *) tail -n 30 "$APP_DIR/.deploy/smoke.log" >&2 || true
     die "nový build neodpovedá (HTTP $SMOKE_CODE) — živý staging nebol zmenený" ;;
esac

# ------------------------------------------------------------------- swap
say "Výmena buildu a PM2 reload"
printf '%s\n' "$CURRENT" >"$APP_DIR/.deploy/previous-commit"
rm -rf "$APP_DIR/.next/standalone.prev"
if [ -d "$APP_DIR/.next/standalone" ]; then mv "$APP_DIR/.next/standalone" "$APP_DIR/.next/standalone.prev"; fi
mkdir -p "$APP_DIR/.next"
cp -a "$BUILD_DIR/.next/standalone" "$APP_DIR/.next/standalone"

if git symbolic-ref -q HEAD >/dev/null; then git merge --ff-only --quiet "$TARGET"
else git checkout --quiet --detach "$TARGET"; fi

if [ "$PM2_EXISTS" -eq 1 ]; then
  # Reload cez ecosystem.config.cjs bez HOSTNAME zo shellu: `--update-env` preberá prostredie
  # volajúceho a HOSTNAME = názov stroja → Next.js by počúval na IP stroja, nie na 127.0.0.1.
  (cd "$APP_DIR" && env -u HOSTNAME pm2 reload ecosystem.config.cjs --update-env)
else
  (cd "$APP_DIR" && env -u HOSTNAME pm2 start ecosystem.config.cjs)
fi
pm2 save >/dev/null
# Počítadlá reštartov od nuly: meria sa stabilita NOVÉHO stavu, nie staré incidenty.
pm2 reset "$PM2_APP" >/dev/null
sleep "${SETTLE_SECONDS:-5}"

say "Overenie"
if APP_DIR="$APP_DIR" PM2_APP="$PM2_APP" PORT="$PORT" bash "$SCRIPT_DIR/verify-pm2.sh"; then
  say "Hotovo: staging beží na $(git log -1 --format='%h %s')"
  info "rollback: scripts/deploy/staging-rollback.sh"
  exit 0
fi

say "Overenie zlyhalo — automatický rollback na $(git log -1 --format='%h' "$CURRENT")"
APP_DIR="$APP_DIR" PM2_APP="$PM2_APP" PORT="$PORT" bash "$SCRIPT_DIR/staging-rollback.sh" --yes || true
die "update bol vrátený; pozri pm2 logs $PM2_APP a $APP_DIR/.deploy/smoke.log"
