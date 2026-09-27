#!/usr/bin/env bash
# =============================================================================
# End-to-end test of staging-update.sh / staging-rollback.sh / verify-pm2.sh
# against a REAL PM2 in a throw-away container. Uses a fake app with the same
# layout as Pandora (.next/standalone/server.js + the repo's ecosystem.config.cjs).
#
#   docker run --rm -v "<repo>:/repo:ro" node:22-bookworm bash /repo/scripts/deploy/tests/staging-e2e.sh
# =============================================================================
set -Eeuo pipefail

REPO="${REPO:-/repo}"
export APP_DIR=/var/www/pandora-browser BUILD_DIR=/var/www/pandora-build PM2_APP=pandora-browser PORT=3005
export BUILD_CMD="npm run build:vps"
export HEALTH_TIMEOUT=20
PASSED=0

ok()   { PASSED=$((PASSED + 1)); printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*" >&2; pm2 logs --nostream --lines 20 2>/dev/null | tail -n 20 >&2 || true; exit 1; }
served() { curl -s -m 5 "http://127.0.0.1:$PORT/" || echo "DOWN"; }
wait_served() { # expected version
  for _ in $(seq 1 45); do [ "$(served)" = "$1" ] && return 0; sleep 1; done
  return 1
}

echo "== setup"
apt-get update -qq >/dev/null && apt-get install -y -qq iproute2 >/dev/null
npm install -g pm2@5 --silent >/dev/null 2>&1
git config --global user.email ci@test.local
git config --global user.name ci
git config --global init.defaultBranch main

mkdir -p /srv /var/www
git init -q --bare /srv/origin.git
SEED=$(mktemp -d)
cd "$SEED"
git init -q
cp "$REPO/ecosystem.config.cjs" .
mkdir -p scripts/deploy
cp "$REPO/scripts/deploy/verify-pm2.sh" "$REPO/scripts/deploy/staging-update.sh" "$REPO/scripts/deploy/staging-rollback.sh" scripts/deploy/
printf '%s\n' '.next/' 'logs/' '.deploy/' '.env.production' 'node_modules/' > .gitignore
cat > package.json <<'JSON'
{ "name": "fake-pandora", "private": true, "scripts": { "build:vps": "node build.js" } }
JSON
cat > build.js <<'JS'
// Fake `next build` with output: standalone.
const fs = require("fs");
const version = fs.readFileSync("VERSION", "utf8").trim();
if (version === "broken-build") { console.error("build failed"); process.exit(1); }
fs.mkdirSync(".next/standalone", { recursive: true });
fs.mkdirSync(".next/static", { recursive: true });
fs.writeFileSync(".next/static/app.js", "//" + version);
fs.writeFileSync(".next/standalone/server.js", `
const http = require("http");
const version = ${JSON.stringify(version)};
if (version === "crash-on-start") process.exit(1);
// "public-bind-under-pm2": fine in the smoke test, but binds 0.0.0.0 under PM2.
const host = version === "public-bind-under-pm2" && process.env.pm_id !== undefined ? "0.0.0.0" : process.env.HOSTNAME;
http.createServer((_, res) => res.end(version)).listen(Number(process.env.PORT), host);
`);
JS
release() { # version [extra-file]
  printf '%s\n' "$1" > VERSION
  if [ -n "${2:-}" ]; then mkdir -p "$(dirname "$2")"; echo "-- $1" > "$2"; fi
  git add -A && git commit -qm "release $1" && git push -q origin HEAD:main
}
git remote add origin /srv/origin.git
release v1

git clone -q /srv/origin.git "$APP_DIR"
cd "$APP_DIR"
printf 'FAKE_SECRET=value\n' > .env.production
chmod 600 .env.production
npm run -s build:vps
env -u HOSTNAME pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null
wait_served v1 || fail "v1 does not start"
bash scripts/deploy/verify-pm2.sh >/tmp/verify.txt || { cat /tmp/verify.txt; fail "verify-pm2 on healthy v1"; }
ok "verify-pm2.sh PASS on a healthy deployment"

echo "== dry run changes nothing"
cd "$SEED" && release v2 && cd "$APP_DIR"
bash scripts/deploy/staging-update.sh >/tmp/dry.txt || fail "dry run exited non-zero"
grep -q "DRY RUN" /tmp/dry.txt || fail "dry run banner missing"
[ "$(served)" = "v1" ] || fail "dry run changed the served version"
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main~1)" ] || fail "dry run moved HEAD"
ok "dry run: plan printed, served v1, HEAD unchanged"

echo "== apply"
V1_SHA=$(git rev-parse HEAD)
bash scripts/deploy/staging-update.sh --apply >/tmp/apply.txt || { tail -n 40 /tmp/apply.txt; fail "apply v2"; }
wait_served v2 || fail "v2 not served after apply"
[ "$(cat .deploy/previous-commit)" = "$V1_SHA" ] || fail "previous-commit not recorded"
[ -d .next/standalone.prev ] || fail "previous build not kept"
ok "apply: v2 served, previous commit and build kept for rollback"

echo "== new migrations need an explicit ack"
cd "$SEED" && release v3 supabase/migrations/20990101000000_example.sql && cd "$APP_DIR"
if bash scripts/deploy/staging-update.sh --apply >/tmp/mig.txt 2>&1; then fail "apply with a new migration did not stop"; fi
grep -q "20990101000000_example.sql" /tmp/mig.txt || fail "migration not listed"
[ "$(served)" = "v2" ] || fail "served version changed without ack"
ok "apply without --ack-migrations stops and lists the migration; v2 still served"
bash scripts/deploy/staging-update.sh --apply --ack-migrations >/tmp/ack.txt || { tail -n 40 /tmp/ack.txt; fail "apply with ack"; }
wait_served v3 || fail "v3 not served after ack"
ok "apply --ack-migrations deploys v3 (migration itself is NOT executed)"

echo "== a broken build never touches the live app"
cd "$SEED" && release broken-build && cd "$APP_DIR"
if bash scripts/deploy/staging-update.sh --apply >/tmp/broken.txt 2>&1; then fail "broken build reported success"; fi
[ "$(served)" = "v3" ] || fail "broken build changed the served version"
[ "$(git log -1 --format=%s)" = "release v3" ] || fail "broken build moved HEAD"
ok "broken build: aborted before the swap, v3 still served"

echo "== a server that crashes on start is caught by the smoke test"
cd "$SEED" && release crash-on-start && cd "$APP_DIR"
if bash scripts/deploy/staging-update.sh --apply >/tmp/crash.txt 2>&1; then fail "crashing build reported success"; fi
grep -q "neodpovedá" /tmp/crash.txt || fail "smoke test did not report the failure"
[ "$(served)" = "v3" ] || fail "crashing build changed the served version"
ok "crash on start: smoke test fails, live app untouched"

echo "== a failure that only shows under PM2 triggers an automatic rollback"
cd "$SEED" && release public-bind-under-pm2 && cd "$APP_DIR"
if bash scripts/deploy/staging-update.sh --apply >/tmp/rollback.txt 2>&1; then fail "public bind was not detected"; fi
grep -q "automatický rollback" /tmp/rollback.txt || { tail -n 40 /tmp/rollback.txt; fail "no automatic rollback"; }
wait_served v3 || fail "rollback did not restore v3"
[ "$(git log -1 --format=%s)" = "release v3" ] || fail "rollback did not restore the v3 commit"
bash scripts/deploy/verify-pm2.sh >/tmp/verify2.txt || { cat /tmp/verify2.txt; fail "verify after rollback"; }
ok "PM2 verification failed (public bind) → rolled back to v3, verify PASS"

echo "== a dirty working tree blocks the update"
echo "local edit" >> ecosystem.config.cjs
if bash scripts/deploy/staging-update.sh >/tmp/dirty.txt 2>&1; then fail "dirty tree was not refused"; fi
grep -q "nie je čistý" /tmp/dirty.txt || fail "dirty tree message missing"
git checkout -q -- ecosystem.config.cjs
ok "dirty working tree refused"

echo "== verify-pm2 detects a non-loopback bind (regression: HOSTNAME leak via --update-env)"
# Real incident shape: the shell's HOSTNAME resolves to the host's own address.
LEAK_IP="$(hostname -i | awk '{print $1}')"
HOSTNAME="$LEAK_IP" pm2 restart "$PM2_APP" --update-env >/dev/null || true
sleep 5
if HEALTH_TIMEOUT=4 bash scripts/deploy/verify-pm2.sh >/tmp/leak.txt; then cat /tmp/leak.txt; fail "HOSTNAME leak not detected"; fi
grep -q "HOSTNAME (bind)" /tmp/leak.txt || fail "no HOSTNAME row"
grep -Eq "FAIL +\| HOSTNAME \(bind\)" /tmp/leak.txt || { cat /tmp/leak.txt; fail "HOSTNAME leak not flagged"; }
# Recovery from a broken bind = full restart (same as staging-rollback.sh).
(cd "$APP_DIR" && env -u HOSTNAME pm2 restart ecosystem.config.cjs --update-env >/dev/null)
pm2 reset "$PM2_APP" >/dev/null
wait_served v3 || fail "v3 not served after restart"
sleep 5
bash scripts/deploy/verify-pm2.sh >/tmp/fixed.txt || { cat /tmp/fixed.txt; fail "reload via ecosystem did not restore loopback"; }
ok "HOSTNAME leak flagged; reload via ecosystem without HOSTNAME restores 127.0.0.1"

echo "== verify-pm2 detects a stopped app"
pm2 stop "$PM2_APP" >/dev/null
if HEALTH_TIMEOUT=4 bash scripts/deploy/verify-pm2.sh >/tmp/stopped.txt; then fail "stopped app passed verification"; fi
grep -q "FAIL" /tmp/stopped.txt || fail "no FAIL rows for a stopped app"
pm2 start "$PM2_APP" >/dev/null
ok "verify-pm2.sh FAIL when the app is stopped"

echo
echo "ALL $PASSED STAGING E2E CHECKS PASSED"
