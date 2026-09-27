#!/usr/bin/env bash
# ============================================================================
# sync-vercel-env.sh - presunie kazdu premennu z env suboru do Vercelu
# (prostredie production) a nasledne nasadi produkciu.
#
# Pouzitie:
#   ./scripts/sync-vercel-env.sh .env.production          # iba synchronizacia
#   ./scripts/sync-vercel-env.sh .env.production --deploy # sync + vercel --prod
#
# Pozadavky: nainstalovany a prihlaseny vercel CLI (npm i -g vercel),
#            projekt musi byt prepojeny (vercel link).
# ============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${1:-.env.production}"
DEPLOY="${2:-}"

if [ ! -f "$ENV_FILE" ]; then
  echo "CHYBA: subor $ENV_FILE neexistuje." >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "CHYBA: vercel CLI nie je nainstalovany. Spusti: npm i -g vercel" >&2
  exit 1
fi

ADDED=0
SKIPPED=0
FAILED=0

# CRLF/BOM-safe citanie: preskoci komentarove a prazdne riadky
while IFS='=' read -r key value; do
  # odstran BOM, medzery a \r (Windows konce riadkov)
  key="$(printf '%s' "$key" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  value="$(printf '%s' "$value" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

  # odstran uvodzovky okolo hodnoty
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"

  case "$key" in
    ""|\#*) continue ;;
  esac

  if [ -z "$value" ]; then
    echo "PRESKOCENE (prazdna hodnota): $key"
    SKIPPED=$((SKIPPED+1))
    continue
  fi

  if printf '%s\n' "$value" | vercel env add "$key" production >/dev/null 2>&1; then
    echo "OK: $key"
    ADDED=$((ADDED+1))
  else
    echo "PRESKOCENE (uz existuje alebo chyba): $key"
    SKIPPED=$((SKIPPED+1))
  fi
done < "$ENV_FILE"

echo
echo "Hotovo: pridane=$ADDED preskocene=$SKIPPED"
echo "Pozor: existujuce hodnoty sa NEaktualizuju. Zmeny sprav cez:"
echo "  vercel env rm <NAZOV> production && vercel env add <NAZOV> production"

if [ "$DEPLOY" = "--deploy" ]; then
  echo
  echo "Nasabuvam produkciu (vercel --prod)..."
  vercel --prod
fi
