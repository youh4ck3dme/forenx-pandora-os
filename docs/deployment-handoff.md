# Deployment Handoff — PΛND0RΛ / ForenZX

**Dátum:** 2026-10-01  
**Branch:** `fix/forza-evidence-ledger-validation`  
**Commit (release):** `ef2300d28a103a1cd946a18e981840d8d66db953`  
**Autor:** youh4ck3dme  
**Cieľ:** https://pandora.whoiswho.at  
**Supabase projekt:** `tlmuvzrgighahnjkxoyw` → https://tlmuvzrgighahnjkxoyw.supabase.co

---

## 1. Zdroj / revízia

```
Branch:  fix/forza-evidence-ledger-validation
Commit:  ef2300d28a103a1cd946a18e981840d8d66db953
Remote:  origin/fix/forza-evidence-ledger-validation (po git push)
```

Tento commit je čistý — žiadne secrets, žiadne `.env.*` súbory, žiadne `node_modules` ani `.next` výstupy (`.dockerignore` a `.gitignore` ich vylučujú).

---

## 2. Výsledky testov (lokálny build 2026-10-01)

| Krok | Príkaz | Exit | Výsledok |
|---|---|---|---|
| Typecheck | `npm run typecheck` | **0** | PASS |
| Vitest (celý suite) | `npx vitest run` | **0** | 917 pass / 3 skip / 0 fail — 111 súborov |
| git diff --check | `git diff --check` | **0** | PASS |
| Produkčný build | `npm run build` | **0** | PASS — standalone output |
| Bundle URL check | grep `.next/static/chunks/*.js` | — | `tlmuvzrgighahnjkxoyw.supabase.co` prítomná; `pandora.whoiswho.at` nie je Supabase endpoint; `placeholder-project` = mŕtva `isDev` vetva |

---

## 3. Čo bolo zmenené (týmto commitom)

| Súbor | Zmena |
|---|---|
| `deploy/nginx.conf` | CSP `connect-src` placeholder → `tlmuvzrgighahnjkxoyw.supabase.co` |
| `scripts/deploy/env.mjs` | `checkEnv` odmieta hostname iný ako `*.supabase.co` a project ref iný ako `tlmuvzrgighahnjkxoyw` |
| `lib/__tests__/deploy-env.test.ts` | fixture aktualizovaný na kanonický ref; 3 nové negatívne testy |
| + 26 ďalších súborov | Predchádzajúca práca na vetve (auth, middleware, forenzx, health endpoint, migrácie) |

**Databázové migrácie: NIE SÚ aplikované** — súbory sú v commite, ale `supabase db push` bol úmyselne nevykonaný.

---

## 4. Build postup pre Copilota (VPS Docker)

```bash
# 1. Stiahni vetvu
git fetch origin fix/forza-evidence-ledger-validation
git checkout fix/forza-evidence-ledger-validation
git log --oneline -1
# očakávané: ef2300d fix(config): enforce canonical Supabase project ref...

# 2. Over env premenné PRED buildom
node scripts/deploy/env.mjs check /opt/forenzx/env/.env.staging
# musí skončiť exit 0; ak nie, oprav chýbajúce hodnoty

# 3. Build Docker image — NEXT_PUBLIC_* sa PEČÚ do bundlu pri build time
#    Čítaj anon key bezpečne (nie z argumentu príkazu viditeľného cez ps)
read -rs ANON_KEY
docker compose -f /opt/forenzx/compose/docker-compose.yml build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://tlmuvzrgighahnjkxoyw.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  app
unset ANON_KEY

# 4. Reštart kontajnera
docker compose -f /opt/forenzx/compose/docker-compose.yml up -d --no-deps app
docker compose -f /opt/forenzx/compose/docker-compose.yml logs app --tail=50

# 5. Nasaď nginx.conf (CSP bol opravený)
sudo cp deploy/nginx.conf /etc/nginx/conf.d/pandora.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 5. Potrebné env premenné (VPS runtime)

Súbor: `/opt/forenzx/env/.env.staging`  
Overenie: `node scripts/deploy/env.mjs check /opt/forenzx/env/.env.staging`

| Premenná | Očakávaná hodnota | Poznámka |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tlmuvzrgighahnjkxoyw.supabase.co` | build ARG aj runtime |
| `SUPABASE_URL` | `https://tlmuvzrgighahnjkxoyw.supabase.co` | musí byť zhodná s NEXT_PUBLIC_ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` (z Supabase dashboard) | build ARG aj runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` (service_role) | **nikdy** `NEXT_PUBLIC_` prefix |
| `S3_ENDPOINT` | `https://hel1.your-objectstorage.com` | povinná |
| `S3_BUCKET` | `forenx-vault-sk` | povinná |
| `S3_ACCESS_KEY_ID` | SET | povinná |
| `S3_SECRET_ACCESS_KEY` | SET | povinná |
| `MISTRAL_API_KEY` alebo oba `_CHAT`+`_ANALYSIS` | SET | povinná |
| `FORENZX_WEBHOOK_SECRET` | SET | presný header `x-forenzx-webhook-secret` |
| `FORENZX_MCP_URL` | URL hubu (nie localhost) | server-only |

Kľúče z: https://app.supabase.com/project/tlmuvzrgighahnjkxoyw/settings/api

---

## 6. Očakávané HTTP výsledky po nasadení

| Endpoint | Očakávaný výsledok | Overenie |
|---|---|---|
| `GET /api/health/public` | `200 { overallStatus: "healthy"\|"attention"\|"unavailable" }` — bez secrets | `curl -sf https://pandora.whoiswho.at/api/health/public` |
| `GET /forza/stav` | `200` — verejná stránka bez prihlásenia | Browser, curl |
| `GET /browser` | `302 → /auth/login?next=/browser` | `curl -sI https://pandora.whoiswho.at/browser` |
| `GET /forza/pripady` | `302 → /auth/login?next=/forza/pripady` | `curl -sI https://pandora.whoiswho.at/forza/pripady` |
| Bundle Supabase URL | `tlmuvzrgighahnjkxoyw.supabase.co` v JS chunks | `curl -s 'https://pandora.whoiswho.at/_next/static/chunks/HASH.js' \| grep -o 'tlmuv[^"]*'` |
| CSP hlavička | `connect-src` obsahuje `tlmuvzrgighahnjkxoyw.supabase.co` | `curl -sI https://pandora.whoiswho.at \| grep -i content-security` |

---

## 7. Databázové migrácie (NEVYKONANÉ)

Vetva obsahuje 2 nové migrácie:
- `supabase/migrations/20261001150000_security_worm_source_hardening.sql`
- `supabase/migrations/20261001160000_public_health_snapshot_hardening.sql`

**Pred aplikovaním je povinný db-preflight:**
```bash
node scripts/deploy/db-preflight.mjs > preflight.sql
# výsledok vlož do Supabase SQL Editora a over GO/WARN/NO-GO
npx supabase link --project-ref tlmuvzrgighahnjkxoyw
npx supabase db push --dry-run
# po odsúhlasení:
npx supabase db push
```

---

## 8. Rollback

```bash
# Kontajner: vrátiť predchádzajúci image tag
docker tag forenzx:staging-prev forenzx:staging
docker compose -f /opt/forenzx/compose/docker-compose.yml up -d --no-deps app

# nginx:
sudo cp /etc/nginx/conf.d/pandora.conf.bak /etc/nginx/conf.d/pandora.conf
sudo nginx -t && sudo systemctl reload nginx

# Databáza: migrácie sú aditívne — obnova zo zálohy je posledná možnosť
# (viď docs/DEPLOYMENT.md sekcia 6)
```

---

## 9. Čo zostáva neoverené (BLOCKED pre Copilota)

| Položka | Stav |
|---|---|
| Skutočný obsah `/opt/forenzx/env/.env.staging` na VPS | NEZNÁMY — Copilot overí |
| Compose súbor `/opt/forenzx/compose/docker-compose.yml` — `env_file` sekcia | NEZNÁMY |
| Aktívny Docker image bol zostavený s kanonickou URL | NEZNÁMY — vyžaduje rebuild |
| Supabase migrácie aplikované na `tlmuvzrgighahnjkxoyw` | NEVYKONANÉ — vyžaduje db push |
| `pandora_staging_db` — existencia a izolácia | Potvrdiť u vlastníka DB |
| E2E testy (`npm run test:e2e`) | BLOCKED — vyžaduje live deployment |
| ForenZX staging regresia | BLOCKED — vyžaduje live deployment + MCP Hub |
