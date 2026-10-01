# Deployment Handoff — PΛND0RΛ / ForenZX

**Dátum:** 2026-10-01  
**Branch:** `fix/forza-evidence-ledger-validation`  
**HEAD commit:** `4cf11001358ae57c5415c71b4ea344dee5636320`  
**Release commit (kód):** `ef2300d28a103a1cd946a18e981840d8d66db953`  
**Autor:** youh4ck3dme  
**Cieľ:** https://pandora.whoiswho.at  
**Supabase projekt:** `tlmuvzrgighahnjkxoyw` → https://tlmuvzrgighahnjkxoyw.supabase.co

---

## 1. Kompletná história vetvy (všetky commity oproti main)

Vetva `fix/forza-evidence-ledger-validation` obsahuje **8 commitov** nad `main`:

```
4cf1100  docs: add deployment handoff for release ef2300d
ef2300d  fix(config): enforce canonical Supabase project ref and harden deployment validation
3a169a7  fix(auth): bridge client session to cookies and eliminate login redirect loop
a210a6c  chore(supabase): add public_health_snapshot rpc type definition
f5cba6c  fix(a11y): add name and autocomplete attributes to register username input
c3c70fe  fix(a11y): add label associations and input identifiers in people and profile pages
cbc650e  feat(observability): add public health snapshot endpoint and system status dashboard
caa810e  fix(a11y): add explicit id and name attributes to inputs and image dimensions
```

Handoff zahŕňa **celú vetvu**, nie len posledný commit. Copilot musí pushnut alebo
checknúť commit `4cf11001358ae57c5415c71b4ea344dee5636320` (HEAD).

---

## 2. Ako Copilot bezpečne získa vetvu na VPS

```bash
# SSH na VPS
ssh vps-staging
cd /opt/forenzx/app          # alebo kde je repozitár

# Overiť, že remote je správny
git remote -v                # musí ukazovať na správny repozitár

# Stiahnuť vetvu (push musí prebehúť z lokálneho stroja pred týmto krokom)
git fetch origin fix/forza-evidence-ledger-validation

# Prepnúť na vetvu a overiť SHA
git checkout fix/forza-evidence-ledger-validation
git rev-parse HEAD
# očakávaný výstup: 4cf11001358ae57c5415c71b4ea344dee5636320

# Ak SHA nesedí, vyšetriť pred pokračovaním
```

**Pred spustením buildu lokálne pushni vetvu:**
```bash
# Na lokálnom stroji
git push origin fix/forza-evidence-ledger-validation
```

---

## 3. Výsledky testov (lokálny build 2026-10-01)

| Krok | Príkaz | Exit | Výsledok |
|---|---|---|---|
| Typecheck | `npm run typecheck` | **0** | PASS |
| Vitest cielené (env/auth/vault) | `npx vitest run [...5 súborov]` | **0** | 60/60 pass |
| Vitest celý suite | `npx vitest run` | **0** | **920 pass / 3 skip / 0 fail — 112 súborov** |
| git diff --check | `git diff --check` | **0** | PASS |
| VPS build | `npm run build:vps` | **0** | PASS — standalone output |
| Bundle URL | grep `.next/static/chunks/` | — | `tlmuvzrgighahnjkxoyw.supabase.co` inlined; `pandora.whoiswho.at` nie je Supabase endpoint; `placeholder-project` = mŕtva `isDev` vetva |

---

## 4. Databázové migrácie — stav

Vetva pridáva 2 nové migrácie:

| Súbor | Pridaný v commite | Následne menený |
|---|---|---|
| `supabase/migrations/20261001150000_security_worm_source_hardening.sql` | `ef2300d` (new file) | **NIE** |
| `supabase/migrations/20261001160000_public_health_snapshot_hardening.sql` | `ef2300d` (new file) | **NIE** |

Overené: `git log ef2300d..HEAD -- supabase/migrations/202610011*` → 0 výsledkov.
Obsah migrácií sa po ich pridaní **nezmenil**.

**Stav na remote DB:**  
Podľa informácie od používateľa: obe migrácie boli **aplikované** a následný
`supabase db push --dry-run` hlásil `up to date`. Toto overoval používateľ
samostatne — nie ja (tento repozitár `db push` nevykonával). Ak Copilot
potrebuje potvrdiť stav, spustí:

```bash
npx supabase link --project-ref tlmuvzrgighahnjkxoyw
npx supabase migration list   # porovná Local vs Remote
npx supabase db push --dry-run
# očakávané: "Remote database is up to date"
```

---

## 5. Čo bolo zmenené na tejto vetve oproti main

| Súbor | Zmena |
|---|---|
| `deploy/nginx.conf` | CSP `connect-src` placeholder → `tlmuvzrgighahnjkxoyw.supabase.co` |
| `scripts/deploy/env.mjs` | `checkEnv`: odmieta non-`*.supabase.co` hostname a nesprávny project ref |
| `lib/__tests__/deploy-env.test.ts` | fixture → kanonický ref; 3 nové negatívne testy |
| `middleware.ts` | Auth middleware refaktoring s `route-policy.ts` |
| `lib/auth/route-policy.ts` | `PUBLIC_ROUTES` single source of truth (nový súbor) |
| `integrations/supabase/auth-middleware.ts` | `requireSupabaseAuth` hardening |
| `app/api/health/public/route.ts` | rate-limit + schema-validated public health endpoint |
| `lib/forza/public-health-cache.server.ts` | 15s server cache (nový súbor) |
| `lib/__tests__/public-health-route.test.ts` | testy health endpointu (nový súbor) |
| `lib/__tests__/supabase-auth-middleware.test.ts` | auth boundary testy (nový súbor) |
| `e2e/evidence-workflow.spec.ts` | E2E špecifikácia (nový súbor) |
| `supabase/migrations/20261001150000_*` | WORM source hardening (aplikovaná) |
| `supabase/migrations/20261001160000_*` | public health snapshot hardening (aplikovaná) |
| `docs/deployment-handoff.md` | tento súbor |
| + ďalšie auth/vault/forenzx/a11y súbory | viď `git log --stat caa810e..HEAD` |

---

## 6. Build postup pre Copilota (VPS Docker)

```bash
# 1. Stiahni vetvu a over SHA
git fetch origin fix/forza-evidence-ledger-validation
git checkout fix/forza-evidence-ledger-validation
git rev-parse HEAD
# musí byť: 4cf11001358ae57c5415c71b4ea344dee5636320

# 2. Over env premenné PRED buildom
node scripts/deploy/env.mjs check /opt/forenzx/env/.env.staging
# musí skončiť exit 0

# 3. Build — NEXT_PUBLIC_* sa pečú do JS bundlu pri build time
read -rs ANON_KEY
docker compose -f /opt/forenzx/compose/docker-compose.yml build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://tlmuvzrgighahnjkxoyw.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  app
unset ANON_KEY

# 4. Reštart kontajnera
docker compose -f /opt/forenzx/compose/docker-compose.yml up -d --no-deps app
docker compose -f /opt/forenzx/compose/docker-compose.yml logs app --tail 50

# 5. Nasaď opravený nginx.conf
sudo cp deploy/nginx.conf /etc/nginx/conf.d/pandora.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## 7. Potrebné env premenné (VPS runtime)

Súbor: `/opt/forenzx/env/.env.staging`  
Overenie: `node scripts/deploy/env.mjs check /opt/forenzx/env/.env.staging`

| Premenná | Očakávaná hodnota | Poznámka |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tlmuvzrgighahnjkxoyw.supabase.co` | build ARG aj runtime |
| `SUPABASE_URL` | `https://tlmuvzrgighahnjkxoyw.supabase.co` | musí byť zhodná s NEXT_PUBLIC_ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ…` (z Supabase dashboard) | build ARG aj runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ…` (service_role) | **nikdy** `NEXT_PUBLIC_` prefix |
| `S3_ENDPOINT` | `https://hel1.your-objectstorage.com` | povinná |
| `S3_BUCKET` | `forenx-vault-sk` | povinná |
| `S3_ACCESS_KEY_ID` | SET | povinná |
| `S3_SECRET_ACCESS_KEY` | SET | povinná |
| `MISTRAL_API_KEY` alebo oba `_CHAT`+`_ANALYSIS` | SET | povinná |
| `FORENZX_WEBHOOK_SECRET` | SET | presný header `x-forenzx-webhook-secret` |
| `FORENZX_MCP_URL` | URL hubu (nie localhost) | server-only |

Kľúče: https://app.supabase.com/project/tlmuvzrgighahnjkxoyw/settings/api

---

## 8. Očakávané HTTP výsledky po nasadení

| Endpoint | Očakávaný výsledok | Overovací príkaz |
|---|---|---|
| `GET /api/health/public` | `200 { overallStatus: "healthy"\|"attention"\|"unavailable" }` — bez secrets | `curl -sf https://pandora.whoiswho.at/api/health/public` |
| `GET /forza/stav` | `200` — verejná, bez prihlásenia | `curl -sI https://pandora.whoiswho.at/forza/stav` |
| `GET /browser` | `302 → /auth/login?next=/browser` | `curl -sI https://pandora.whoiswho.at/browser` |
| `GET /forza/pripady` | `302 → /auth/login?next=/forza/pripady` | `curl -sI https://pandora.whoiswho.at/forza/pripady` |
| CSP hlavička | `connect-src` obsahuje `tlmuvzrgighahnjkxoyw.supabase.co` | `curl -sI https://pandora.whoiswho.at \| grep -i content-security` |
| Bundle Supabase URL | `tlmuvzrgighahnjkxoyw.supabase.co` v JS chunks | `curl -s https://pandora.whoiswho.at/_next/static/chunks/HASH.js \| grep -o 'tlmuv[^"]*'` |
| Upload vault (401) | vyžaduje prihláseného používateľa — **nie je dôkazom z tohto buildu** | manuálne overenie po nasadení |

---

## 9. Rollback

```bash
# Kontajner
docker tag forenzx:staging-prev forenzx:staging
docker compose -f /opt/forenzx/compose/docker-compose.yml up -d --no-deps app

# nginx
sudo cp /etc/nginx/conf.d/pandora.conf.bak /etc/nginx/conf.d/pandora.conf
sudo nginx -t && sudo systemctl reload nginx

# Databáza: migrácie sú aditívne — obnova zo zálohy je posledná možnosť
# (viď docs/DEPLOYMENT.md sekcia 6)
```

---

## 10. Čo zostáva neoverené (BLOCKED pre Copilota)

| Položka | Stav |
|---|---|
| Obsah `/opt/forenzx/env/.env.staging` na VPS | NEZNÁMY — Copilot overí |
| Compose `env_file` sekcia na VPS | NEZNÁMY |
| Aktívny Docker image — build ARG hodnoty | NEZNÁMY — vyžaduje rebuild |
| `pandora_staging_db` — izolácia od produkčnej DB | Potvrdiť u vlastníka |
| 401 pri vault uploade prihláseného používateľa | BLOCKED — len po nasadení |
| E2E testy (`npm run test:e2e`) | BLOCKED — live deployment |
| ForenZX staging regresia | BLOCKED — live deployment + MCP Hub |
