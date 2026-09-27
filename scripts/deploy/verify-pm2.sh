#!/usr/bin/env bash
# =============================================================================
# Overenie PM2 procesu Pandory na VPS / stagingu. IBA ČÍTANIE — nič nemení.
#
#   scripts/deploy/verify-pm2.sh [--public https://pandora.whoiswho.at]
#
# Premenné: APP_DIR (default /var/www/pandora-browser), PM2_APP (pandora-browser),
#           PORT (3005), HEALTH_PATH (/), HEALTH_TIMEOUT (30 s).
# Výstup: tabuľka CHECK | STATUS | DETAIL; exit 1 pri akomkoľvek FAIL.
# Hodnoty tajných premenných sa nikdy nevypisujú.
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/var/www/pandora-browser}"
PM2_APP="${PM2_APP:-pandora-browser}"
PORT="${PORT:-3005}"
HEALTH_PATH="${HEALTH_PATH:-/}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-30}"
PUBLIC_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --public) PUBLIC_URL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "Neznámy parameter: $1" >&2; exit 2 ;;
  esac
done

FAILS=0
WARNS=0
row() { # status check detail
  printf '%-8s | %-34s | %s\n' "$1" "$2" "$3"
  case "$1" in FAIL) FAILS=$((FAILS + 1)) ;; WARN) WARNS=$((WARNS + 1)) ;; esac
}

printf '%-8s | %-34s | %s\n' "STATUS" "CHECK" "DETAIL"
printf '%s\n' "---------+------------------------------------+----------------------------------------"

for bin in pm2 node curl; do
  if command -v "$bin" >/dev/null 2>&1; then row PASS "nástroj: $bin" "$(command -v "$bin")"
  else row FAIL "nástroj: $bin" "chýba v PATH"; fi
done
if [ "$FAILS" -gt 0 ]; then echo; echo "FAIL: chýbajú nástroje."; exit 1; fi

# --- PM2 stav cez `pm2 jlist` (JSON), parsovaný v Node — žiadne env hodnoty okrem povolených
JLIST="$(pm2 jlist 2>/dev/null || echo '[]')"
PM2_SUMMARY="$(PM2_JSON="$JLIST" APP="$PM2_APP" node -e '
  let list = [];
  try { list = JSON.parse(process.env.PM2_JSON || "[]"); } catch { list = []; }
  const procs = list.filter((p) => p.name === process.env.APP);
  const env = procs[0]?.pm2_env ?? {};
  const args = [].concat(env.node_args ?? []).join(" ");
  const out = {
    count: procs.length,
    online: procs.filter((p) => p.pm2_env?.status === "online").length,
    statuses: [...new Set(procs.map((p) => p.pm2_env?.status))].join(","),
    restarts: procs.reduce((n, p) => n + (p.pm2_env?.restart_time ?? 0), 0),
    unstable: procs.reduce((n, p) => n + (p.pm2_env?.unstable_restarts ?? 0), 0),
    mode: env.exec_mode ?? "",
    nodeEnv: env.env?.NODE_ENV ?? env.NODE_ENV ?? "",
    port: String(env.env?.PORT ?? env.PORT ?? ""),
    host: env.env?.HOSTNAME ?? env.HOSTNAME ?? "",
    envFile: (args.match(/--env-file=(\S+)/) ?? [])[1] ?? "",
    cwd: env.pm_cwd ?? "",
    script: env.pm_exec_path ?? "",
    memMb: Math.round(procs.reduce((n, p) => n + (p.monit?.memory ?? 0), 0) / 1048576),
  };
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
')"
val() { printf '%s\n' "$PM2_SUMMARY" | sed -n "s/^$1=//p"; }

COUNT="$(val count)"; ONLINE="$(val online)"
if [ "${COUNT:-0}" -eq 0 ]; then
  row FAIL "PM2 proces '$PM2_APP'" "neexistuje (pm2 start ecosystem.config.cjs)"
else
  if [ "$ONLINE" -eq "$COUNT" ]; then row PASS "PM2 inštancie online" "$ONLINE/$COUNT"
  else row FAIL "PM2 inštancie online" "$ONLINE/$COUNT (stavy: $(val statuses))"; fi
  [ "$(val mode)" = "cluster_mode" ] && row PASS "exec_mode" "cluster" || row WARN "exec_mode" "$(val mode) (očakávané cluster)"
  [ "$(val nodeEnv)" = "production" ] && row PASS "NODE_ENV" "production" || row FAIL "NODE_ENV" "'$(val nodeEnv)' (musí byť production)"
  [ "$(val port)" = "$PORT" ] && row PASS "PORT" "$PORT" || row FAIL "PORT" "'$(val port)' (očakávané $PORT)"
  [ "$(val host)" = "127.0.0.1" ] && row PASS "HOSTNAME (bind)" "127.0.0.1" || row FAIL "HOSTNAME (bind)" "'$(val host)' — musí byť 127.0.0.1"
  ENV_FILE="$(val envFile)"
  if [ -z "$ENV_FILE" ]; then row FAIL "node_args --env-file" "chýba"
  elif [ ! -f "$ENV_FILE" ]; then row FAIL "node_args --env-file" "súbor neexistuje: $ENV_FILE"
  else
    MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
    if [ "$MODE" = "600" ] || [ "$MODE" = "400" ]; then row PASS "env súbor" "$ENV_FILE (práva $MODE)"
    else row FAIL "env súbor" "$ENV_FILE má práva $MODE — nastav chmod 600"; fi
  fi
  UNSTABLE="$(val unstable)"; RESTARTS="$(val restarts)"
  [ "${UNSTABLE:-0}" -eq 0 ] && row PASS "nestabilné reštarty" "0 (reštarty spolu: $RESTARTS)" \
    || row FAIL "nestabilné reštarty" "$UNSTABLE (crash loop?) — pm2 logs $PM2_APP"
  row INFO "pamäť (všetky inštancie)" "$(val memMb) MB"
  row INFO "skript" "$(val script)"
fi

# --- Bind len na loopback
if command -v ss >/dev/null 2>&1; then
  LISTEN="$(ss -ltnH "( sport = :$PORT )" 2>/dev/null | awk '{print $4}' | sort -u | tr '\n' ' ')"
  NON_LOOPBACK="$(printf '%s\n' $LISTEN | grep -Ev '^(127\.0\.0\.1|\[::1\]):'"$PORT"'$' || true)"
  if [ -z "$LISTEN" ]; then row FAIL "port $PORT počúva" "nikto nepočúva"
  elif [ -n "$NON_LOOPBACK" ]; then
    row FAIL "port $PORT len loopback" "nelokálny bind: $(printf '%s' "$NON_LOOPBACK" | tr '\n' ' ')"
  else row PASS "port $PORT len loopback" "$LISTEN"; fi
else
  row WARN "port $PORT len loopback" "ss nie je dostupné"
fi

# --- HTTP health (priamo na aplikáciu, bez nginx)
CODE="000"; ELAPSED=0
while [ "$ELAPSED" -lt "$HEALTH_TIMEOUT" ]; do
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "http://127.0.0.1:$PORT$HEALTH_PATH" || true)"
  case "$CODE" in 2??|3??) break ;; esac
  sleep 2; ELAPSED=$((ELAPSED + 2))
done
case "$CODE" in
  2??|3??) row PASS "HTTP 127.0.0.1:$PORT$HEALTH_PATH" "$CODE" ;;
  *) row FAIL "HTTP 127.0.0.1:$PORT$HEALTH_PATH" "$CODE po ${HEALTH_TIMEOUT}s" ;;
esac

# --- Chyby v logoch (posledných 200 riadkov)
ERR_LOG="$APP_DIR/logs/pm2-error.log"
if [ -f "$ERR_LOG" ]; then
  N="$(tail -n 200 "$ERR_LOG" | grep -Eci 'error|unhandled|EADDRINUSE|ECONNREFUSED' || true)"
  [ "${N:-0}" -eq 0 ] && row PASS "pm2-error.log (200 r.)" "bez chýb" || row WARN "pm2-error.log (200 r.)" "$N riadkov s chybou — pm2 logs $PM2_APP --err"
else
  row INFO "pm2-error.log" "neexistuje ($ERR_LOG)"
fi

# --- Nasadený commit vs origin/main (informatívne)
if [ -d "$APP_DIR/.git" ]; then
  HEAD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
  MAIN_SHA="$(git -C "$APP_DIR" rev-parse --short origin/main 2>/dev/null || echo '?')"
  [ "$HEAD_SHA" = "$MAIN_SHA" ] && row PASS "nasadený commit" "$HEAD_SHA = origin/main" \
    || row INFO "nasadený commit" "$HEAD_SHA (origin/main: $MAIN_SHA, bez fetch)"
fi

# --- PM2 perzistencia po reboote
if [ -f "${PM2_HOME:-$HOME/.pm2}/dump.pm2" ]; then row PASS "pm2 save (dump)" "existuje"
else row WARN "pm2 save (dump)" "chýba — po reboote sa proces nespustí (pm2 save)"; fi

# --- Verejná vrstva cez nginx (voliteľné)
if [ -n "$PUBLIC_URL" ]; then
  HDRS="$(curl -sI -m 10 "$PUBLIC_URL" || true)"
  printf '%s' "$HDRS" | grep -qi '^strict-transport-security:' && row PASS "HSTS ($PUBLIC_URL)" "prítomné" || row FAIL "HSTS ($PUBLIC_URL)" "chýba"
  printf '%s' "$HDRS" | grep -qi '^content-security-policy:' && row PASS "CSP" "prítomné" || row FAIL "CSP" "chýba"
  if printf '%s' "$HDRS" | grep -Eqi '^server: nginx/[0-9]'; then row FAIL "server_tokens" "verzia nginx je viditeľná"
  else row PASS "server_tokens" "verzia skrytá"; fi
fi

echo
if [ "$FAILS" -gt 0 ]; then echo "VÝSLEDOK: FAIL ($FAILS chýb, $WARNS varovaní)"; exit 1; fi
echo "VÝSLEDOK: PASS ($WARNS varovaní)"
