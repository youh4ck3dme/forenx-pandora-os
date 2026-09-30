# Produkčné nasadenie (runbook)

Pred deploymentom musí byť splnený kanonický kontrakt v [System Source of Truth](SOURCE-OF-TRUTH.md). Tento runbook rieši operácie nasadenia; nenahrádza overenie dátovej integrity, MCP workflowu ani staging regresie.

Poradie krokov: **1. kľúče a ENV → 2. Supabase → 3. S3 → 4. Vercel a/alebo VPS → 5. overenie.**
Každý krok má vlastné overenie; pokračuj až keď predchádzajúci prejde.

```
Internet ──443──▶ nginx (deploy/nginx.conf) ──▶ 127.0.0.1:3005  Next.js standalone (PM2 cluster)
                                                     │
            Prehliadač ──presigned PUT/GET──▶ Hetzner S3 (forenx-vault-sk, privátny bucket)
                                                     │
                                            Supabase (Postgres + RLS + Auth)
```

> **Pravidlo pre tajné hodnoty:** nikdy ich nepíš do príkazu, commitu, issue ani chatu.
> Všetky príkazy nižšie sa na hodnotu pýtajú interaktívne alebo čítajú súbor mimo gitu.

---

## 1. Kľúče a ENV premenné

### 1.1 Rotácia (každý kľúč)

1. vytvor nový kľúč → 2. nastav ho (Vercel / VPS) → 3. nasaď → 4. over funkčnosť → **5. až potom zruš starý**.

| Služba | Kde | Premenné |
|---|---|---|
| Supabase | Dashboard → *Project Settings → API Keys* (odporúčané nové `sb_publishable_…` / `sb_secret_…`, potom vypnúť legacy JWT kľúče; rotácia JWT secretu odhlási všetkých) | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Mistral | console.mistral.ai → *API Keys* (ideálne 2 kľúče: chat / analýza) | `MISTRAL_API_KEY_CHAT` + `MISTRAL_API_KEY_ANALYSIS`, alebo `MISTRAL_API_KEY` |
| Hetzner S3 | Cloud Console → *Security → S3 credentials* | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Stripe (ak sa používa) | Dashboard → *Developers → API keys → Roll key* | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_PAYMENTS_CLIENT_TOKEN` |

Overenie, že starý kľúč je naozaj zrušený (očakávané `401`):

```bash
read -rs OLD && curl -s -o /dev/null -w "%{http_code}\n" https://api.mistral.ai/v1/models -H "Authorization: Bearer $OLD"; unset OLD
```

### 1.2 Zoznam premenných a príkazy

Zdroj pravdy je `.env.production.example`. Príkazy aj šablónu generuje skript (hodnoty nikdy nevypisuje):

```bash
node scripts/deploy/env.mjs vercel      # príkazy `vercel env add … production`
node scripts/deploy/env.mjs template    # šablóna .env.production s prázdnymi hodnotami
node scripts/deploy/env.mjs check <súbor>   # kontrola vyplneného súboru, exit 1 pri chybe
```

`check` hlási: chýbajúce povinné premenné, chýbajúci Mistral kľúč, hodnoty, ktoré vyzerajú ako
placeholder, tajný kľúč s prefixom `NEXT_PUBLIC_`, nesúlad `SUPABASE_URL` ↔ `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_BASE_URL` bez `https://`, nastavený `VAULT_FALLBACK_SECRET` a na Linuxe práva súboru ≠ 600.

| Skupina | Premenné | Poznámka |
|---|---|---|
| **Povinné** | `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` + aspoň jeden Mistral kľúč | bez S3 vault v produkcii **zámerne zlyhá** (žiadny in-memory fallback) |
| Verejné `NEXT_PUBLIC_*` | zapečú sa do JS bundlu pri builde | po zmene treba **nový build**, reštart nestačí |
| Tajné (iba server) | `SUPABASE_SERVICE_ROLE_KEY`, `S3_*_KEY*`, `MISTRAL_API_KEY*`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `STRIPE_*`, `WHOISWHO_API_KEY`, `ICO_ATLAS_API_KEY`, `FORENX_AI_WORKER_KEY` | nikdy s prefixom `NEXT_PUBLIC_` |
| Nenastavovať v produkcii | `VAULT_FALLBACK_SECRET` | platí len pre vývoj/testy |

Odporúčané hodnoty konfigurácie: `NEXT_PUBLIC_BASE_URL=https://pandora.whoiswho.at`, `S3_ENDPOINT=https://hel1.your-objectstorage.com`,
`S3_REGION=hel1`, `S3_BUCKET=forenx-vault-sk`, `S3_FORCE_PATH_STYLE=true`,
`FORENX_ADMIN_EMAILS=<e-maily administrátorov oddelené čiarkou>`.

**`NEXT_PUBLIC_RP_ID` (WebAuthn) je rozhodnutie, nie default.** `.env.production.example` má
`whoiswho.at` (passkey použiteľný na všetkých subdoménach `*.whoiswho.at`); `pandora.whoiswho.at`
obmedzí passkey len na Pandoru (menšia plocha útoku). Pozor: prihlasovacia stránka `/auth/login`
dnes passkey **neoveruje na serveri** (challenge sa generuje v prehliadači a prihlásenie prejde aj bez
neho), takže voľba RP_ID zatiaľ neprináša bezpečnosť ani skutočné zdieľanie prihlásenia medzi appkami.

---

## 2. Supabase migrácie

### 2.0 Preflight (povinný pred každým `db push`)

Preflight zistí na **cieľovej** DB stav a vráti verdikt **GO / GO S VAROVANÍM / NO-GO**. Je read-only
(vytvára iba dočasné tabuľky vlastnej session).

```bash
node scripts/deploy/db-preflight.mjs > preflight.sql
# Supabase Dashboard → SQL Editor → vložiť preflight.sql → Run
# alebo: psql "$DATABASE_URL" -f preflight.sql
```

| Kontrola | Čo znamená |
|---|---|
| História migrácií / čakajúce migrácie | čo presne `db push` aplikuje |
| Kolízia tabuľky … (**FAIL**) | čakajúca migrácia robí `CREATE TABLE` bez `IF NOT EXISTS` na existujúcu tabuľku → push zlyhá |
| Existujúce funkcie, ktoré push prepíše (WARN) | `CREATE OR REPLACE` na funkciu, ktorá už existuje — over, že je Pandorina |
| `public.handle_new_user()` / triggery na `auth.users` | či patria Pandore alebo inej appke |
| Zdieľaná databáza (WARN) | cudzie tabuľky v `public` |
| auth.users bez Pandora profilu | registrácie z inej appky alebo spred hooku |

**NO-GO = nepushovať.** Pri GO S VAROVANÍM posúď každé WARN.

**Zdieľaná DB a registrácie:** od migrácie `20260928230000_pandora_signup_hook_isolation` používa
Pandora výhradne vlastnú funkciu `pandora_handle_new_user()` a trigger `pandora_on_auth_user_created`.
Pôvodný trigger `on_auth_user_created` odstráni **len ak preukázateľne patrí Pandore**; cudzí trigger a
cudziu `handle_new_user()` nikdy neprepíše ani nezmaže (`20260925143000` má na to poistku). Ak
preflight hlási cudzí `handle_new_user()` a zároveň ide o už nasadenú staršiu Pandorinu verziu,
over u druhej appky, či jej registrácia funguje — staršie migrácie ju mohli prepísať ešte pred touto
opravou.

Bezpečné riešenie pre zdieľané prostredie je stále **samostatný Supabase projekt pre Pandoru**.

### 2.1 Záloha a push

**Pred pushom zálohuj DB:** Dashboard → *Database → Backups* (`supabase db dump` vyžaduje Docker).

```bash
git pull origin main
npx supabase login
npx supabase link --project-ref tlmuvzrgighahnjkxoyw

npx supabase migration list          # Local vs Remote
npx supabase db push --dry-run       # iba vypíše, čo sa aplikuje
npx supabase db push
```

Očakávané v `--dry-run` (podľa stavu remote DB):

| Migrácia | Obsah |
|---|---|
| `202609270001_atomic_ai_graph` | ak ešte nie je na remote |
| `20260927120000_court_ready_evidence_ledger` | tabuľka `evidence_items` + RLS + legal hold |
| `20260927130000_forensic_integrity` | oprava zápisu AI grafu, audit hash-chain, `source_snapshots`, časové vzťahy, peniaze v minor units |
| `20260927140000_case_lifecycle_legal_hold` | životný cyklus prípadu, legal hold, kontrolované zničenie (`set_case_status`, `destroy_case`) |
| `20260927140000_case_lifecycle_legal_hold` | P1-03: životný cyklus prípadu, legal hold, kontrolované zničenie (`set_case_status`, `destroy_case`) |
| `20260927234500_evidence_ledger_worm` | iba `evidence_items`: WORM identifikačných stĺpcov, mazanie len cez auditovanú RPC, stav serverového overenia hashu |

`20260921040519` sa **nesmie** znova aplikovať (remote ju už má; úprava s podmieneným stubom
`rls_auto_enable()` slúži len pre čistý Postgres). Ak ju `--dry-run` uvádza, zastav sa.

### 2.2 Overenie migrácie `forensic_integrity` (SQL Editor)

```sql
-- CHECK musí obsahovať regex, nie IN ('INSERT','UPDATE','DELETE')
select pg_get_constraintdef(oid) from pg_constraint where conname = 'case_audit_log_action_check';

-- backfill hash-chainu: 0
select count(*) from case_audit_log where event_hash is null;

-- nové funkcie: 4 riadky
select proname from pg_proc
where proname in ('commit_ai_case_graph','verify_audit_chain','erase_user_audit_log','append_audit_event');

-- integrita reťaze konkrétneho používateľa: prázdny výsledok
select * from verify_audit_chain('<UUID-používateľa>');
```

Funkčná skúška: v aplikácii spusti AI analýzu → „Použiť výsledky“. Graf sa uloží a v `case_audit_log`
pribudne `ai_graph_committed` (pred touto migráciou zápis vždy zlyhal).

### 2.3 Overenie RLS pre `evidence_items`

Celý súbor `supabase/verify/evidence_items_rls.sql` vlož do SQL Editora a spusti
(alebo `psql "$DATABASE_URL" -f supabase/verify/evidence_items_rls.sql`).
Vytvorí dočasných používateľov a dôkazy, otestuje politiky pod rolami `anon` a `authenticated`
a **všetky testovacie dáta vráti späť**. Výsledok je tabuľka `check | status | detail`.

| Kontrola | Očakávané |
|---|---|
| RLS zapnuté, 4 politiky, žiadna `FOR ALL`, žiadna `USING (true)` | PASS |
| anon ani cudzí vyšetrovateľ nevidí / nezmení / nezmaže dôkaz | PASS |
| vloženie dôkazu za iného vyšetrovateľa | PASS (zamietnuté) |
| vlastník vidí svoje dôkazy | PASS |
| legal hold: vlastník dôkaz nezmení, nezmaže ani hold nezruší | PASS |
| WORM / delete / audit triggery, priamy `DELETE` odobratý klientom | PASS |
| nemennosť `sha256_hash` / `s3_object_key` | PASS (WORM trigger) |
| zmazanie dôkazu bez legal hold priamym `DELETE` | PASS (iba cez `delete_evidence_item_audited`) |

Skript očakáva nasadenú migráciu `20260927234500_evidence_ledger_worm`; bez nej sú posledné kontroly `FAIL`.

**Akýkoľvek `FAIL` = nenasadzovať.** Skript je overený aj v CI: `supabase/tests/evidence-items-rls.test.ts`
ho spúšťa na čerstvo zmigrovanej DB vrátane negatívnej kontroly (deravá politika musí dať `FAIL`).

---

### 2.4 Mazanie dôkazu a overenie hashu

- Klient maže dôkaz **iba** cez RPC (priamy `DELETE` je zakázaný všetkým rolám):
  `supabase.rpc("delete_evidence_item_audited", { _item, _reason })` — dôvod 10–1000 znakov,
  vlastník alebo admin, nie pod legal hold. Aktér sa berie z JWT (`auth.uid()`), nie z parametra.
  Do `case_audit_log` sa zapíše `evidence_deleted` s úplným snímkom záznamu (hash-chain).
  **Objekt v S3 sa tým nemaže** — na trvalé uchovanie nastav na buckete retenciu / object lock.
- Legal hold a výsledok overenia mení iba server (`service_role`).
- Worker `/api/vault/verify` stiahne čakajúce objekty z S3 (stream), spočíta SHA-256 a veľkosť a
  zapíše výsledok (`verified` / `mismatch` / `object_missing` / `error`) cez
  `record_evidence_verification`; DB prijme `verified` len pri zhode hashu **aj** veľkosti.

Spúšťanie workera (`CRON_SECRET` min. 32 znakov, bez neho endpoint vracia 503):

```bash
# VPS — hlavička v súbore (secret nie je v argumentoch procesu, ktoré vidí `ps`)
install -m 600 /dev/null ~/.pandora-cron.header
printf 'Authorization: Bearer %s\n' "$(grep '^CRON_SECRET=' /var/www/pandora-browser/.env.production | cut -d= -f2- | tr -d '"')" > ~/.pandora-cron.header

# crontab -e (každých 10 min, max. 25 položiek na beh)
*/10 * * * * curl -fsS -H @$HOME/.pandora-cron.header "https://pandora.whoiswho.at/api/vault/verify?limit=25" >/dev/null
```

Na Verceli: Vercel Cron posiela `Authorization: Bearer $CRON_SECRET` automaticky; plán Hobby
povoľuje cron najviac raz denne. Kontrola stavu:

```sql
select hash_verification_status, count(*) from evidence_items group by 1;
select id, file_name, verification_error from evidence_items
 where hash_verification_status in ('mismatch','object_missing','error');
```

## 3. S3 (Hetzner Object Storage)

- Bucket `forenx-vault-sk` musí byť **privátny** (žiadny public read).
- S3 kľúč pre aplikáciu: len tento bucket, len potrebné operácie.
- CORS pre priamy upload z prehliadača (presigned PUT):

```bash
aws s3api put-bucket-cors --endpoint-url https://hel1.your-objectstorage.com --bucket forenx-vault-sk \
  --cors-configuration '{"CORSRules":[{"AllowedOrigins":["https://pandora.whoiswho.at"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["content-type","x-amz-content-sha256","x-amz-meta-*"],"MaxAgeSeconds":3000}]}'

aws s3api get-bucket-cors --endpoint-url https://hel1.your-objectstorage.com --bucket forenx-vault-sk
```

---

## 4a. Vercel

```bash
vercel link
node scripts/deploy/env.mjs vercel      # vypíše príkazy; spúšťaj ich po jednom
vercel env ls production                # kontrola: sú nastavené všetky POVINNÉ
vercel --prod
```

Build na Verceli spúšťa `npm run verify:vercel-deploy` (preflight ENV + celý quality gate).
Preview prostredie nastav len s oddeleným neprodukčným Supabase projektom a bucketom.

## 4b. VPS (nginx + PM2, port 3005)

Aplikácia počúva **iba na `127.0.0.1:3005`** (`ecosystem.config.cjs`); verejne je dostupná len cez nginx.

```bash
ssh <user>@<VPS_IP>
cd /var/www/pandora-browser

# 1) ENV súbor (mimo gitu, iba pre používateľa aplikácie)
node scripts/deploy/env.mjs template > .env.production
chmod 600 .env.production
nano .env.production                    # vyplň hodnoty
node scripts/deploy/env.mjs check .env.production   # musí skončiť bez chýb

# 2) Kód a build
git fetch origin && git checkout main && git pull --ff-only
npm ci
npm run build:vps
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/

# 3) nginx — sprísnená konfigurácia
nginx -v                                # http2 on; vyžaduje nginx >= 1.25.1
sudo mkdir -p /var/www/letsencrypt
sudo cp deploy/nginx.conf /etc/nginx/conf.d/pandora.conf
sudo sed -i 's/your-project-id\.supabase\.co/tlmuvzrgighahnjkxoyw.supabase.co/g' /etc/nginx/conf.d/pandora.conf
# iba ak je nginx < 1.25.1:
sudo sed -i 's/^\s*http2 on;//; s/listen 443 ssl;/listen 443 ssl http2;/; s/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' /etc/nginx/conf.d/pandora.conf
sudo rm -f /etc/nginx/sites-enabled/pandora.whoiswho.at   # iba starý vhost PANDORY (deploy/vps/nginx-pandora.conf)
# NEMAŽ vhost whoiswho.at ani iných stránok. Zoznam: ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
sudo nginx -t && sudo systemctl reload nginx

# 4) PM2 — .env.production sa načíta cez node_args --env-file (absolútna cesta)
pm2 delete pandora-browser 2>/dev/null; pm2 start ecosystem.config.cjs && pm2 save
pm2 startup                             # jednorazovo, podľa vypísaného príkazu

# 5) Firewall a certifikát
sudo ufw allow 80,443/tcp && sudo ufw deny 3005/tcp && sudo ufw status
sudo certbot renew --dry-run
```

`deploy/nginx.conf` obsahuje: HSTS (iba HTTPS), CSP, `X-Frame-Options: SAMEORIGIN`
(interné pandora:// aplikácie sa vo vstavanom prehliadači framujú same-origin; cudzí framing
ostáva zablokovaný), Permissions-Policy,
rate limity, voliteľné odmietnutie neznámeho `Host` (444, iba na samostatnom nginx), streamovaný upload na `/api/vault` (260 MB,
bez bufferovania do RAM), SSE timeout 600 s pre `/api/ai/`, voliteľný same-origin S3 pass-through
`/vault-s3/`. Nový externý host v aplikácii = doplniť ho do `connect-src` v CSP.

**Zdieľaný nginx (napr. aj whoiswho.at na tom istom serveri):** súbor mení správanie iba pre
`server_name pandora.whoiswho.at`; na úrovni `http` definuje len jedinečne pomenované zóny a mapy
(`pandora_*`). Catch-all `default_server` je zakomentovaný — zapni ho len na samostatnom nginx.
Po `nginx -t` over aj starú stránku: `curl -sI https://whoiswho.at | head -1`.

---

### 4c. Update stagingu (git pull main + PM2)

Migrácie tento postup **nespúšťa** (sekcia 2 je samostatný krok). Na VPS v `/var/www/pandora-browser`:

```bash
bash scripts/deploy/verify-pm2.sh                 # stav pred update (iba čítanie)
bash scripts/deploy/staging-update.sh             # DRY RUN: nové commity, nové migrácie, nič nemení
bash scripts/deploy/staging-update.sh --apply     # vykoná update
#   pri nových súboroch v supabase/migrations/ sa zastaví; pokračovanie iba vedome:
#   bash scripts/deploy/staging-update.sh --apply --ack-migrations
bash scripts/deploy/verify-pm2.sh --public https://pandora.whoiswho.at
bash scripts/deploy/staging-rollback.sh --yes     # návrat na predchádzajúci commit + build
```

`staging-update.sh --apply`: čistý strom a fast-forward na `origin/main` → build v oddelenom
adresári `/var/www/pandora-build` (beziaci server počas buildu nestratí súbory) → smoke test nového
buildu na `127.0.0.1:3905` → nový release v `.deploy/releases/<id>` a **atomické** prepnutie symlinku `.next/standalone` (staré workery dobehnú na svojom release) →
`pm2 reload` cez `ecosystem.config.cjs` bez `HOSTNAME` zo shellu → `verify-pm2.sh` → pri zlyhaní
automatický rollback (aj keď zlyhá samotné `pm2 reload`). Zlyhanie rollbacku skript hlási (exit 3), nikdy ho nemaskuje.

> **Pozor pri ručnom PM2:** `pm2 reload <app> --update-env` prevezme prostredie shellu a `HOSTNAME`
> je v ňom názov stroja → Next.js potom počúva na IP stroja namiesto `127.0.0.1` (obídenie nginx).
> Vždy: `env -u HOSTNAME pm2 reload ecosystem.config.cjs --update-env`.

Test celého postupu na skutočnom PM2 (Docker): `docker run --rm -v "$PWD:/repo:ro" node:22-bookworm
bash /repo/scripts/deploy/tests/staging-e2e.sh`.

## 5. Overenie po nasadení

```bash
sudo ss -ltnp | grep 3005                          # 127.0.0.1:3005, nie 0.0.0.0
curl -sI https://pandora.whoiswho.at | grep -iE "strict-transport|content-security|x-frame|^server:"
curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://<VPS_IP>:3005                 # z iného stroja: 000
curl -sI https://whoiswho.at | head -1                           # stará appka stále odpovedá
# iba ak je zapnutý catch-all default_server:
curl -sk -o /dev/null -w "%{http_code}\n" -H "Host: evil.example" https://<VPS_IP>/  # 000 (444)
pm2 status && pm2 logs pandora-browser --lines 50 --nostream
```

V prehliadači (F12 → Console): žiadne CSP chyby. Otestuj prihlásenie, upload do vaultu, AI analýzu
a export reportu.

---

## 6. Rollback

- **Aplikácia (VPS):** `git checkout <predchádzajúci-tag-alebo-commit> && npm ci && npm run build:vps`, skopíruj `public` a `.next/static` (krok 4b.2), `pm2 reload pandora-browser`.
- **Vercel:** Dashboard → *Deployments* → predchádzajúce nasadenie → *Promote to Production*.
- **nginx:** vráť pôvodný súbor do `/etc/nginx/sites-enabled/`, odstráň `/etc/nginx/conf.d/pandora.conf`, `sudo nginx -t && sudo systemctl reload nginx`.
- **Databáza:** migrácie sú aditívne. Obnova zo zálohy (krok 2) je posledná možnosť. Ručný návrat
  `forensic_integrity`: odstrániť triggery `case_audit_log_chain`, `case_audit_log_no_update`,
  `case_audit_log_no_truncate`, `case_relations_history_guard`, `source_snapshots_immutable`
  (stĺpce a tabuľky môžu ostať). Pozor: pôvodná `commit_ai_case_graph` obsahovala chybu, pre ktorú zápis grafu vždy zlyhal.

---

## 7. Electron

Electron sa na Vercel ani VPS nenasadzuje. Build lokálne alebo na dôveryhodnom release runneri:

```powershell
npm run electron:build
```

Artefakty sú v `dist\`. Pred verejným vydaním treba code-signing certifikáty a kontrolovaný
updater/release workflow.

---

## 8. Známe obmedzenia pred „court-ready“ vaultom

> **Vault upload (stav po `/api/vault/commit`):**
>
> - Priamy PUT do S3 posiela všetky podpísané hlavičky z `requiredHeaders`
>   (`lib/storage/vault-upload-client.ts`).
> - Po úspešnom PUT sa dôkaz zapíše do `evidence_items` cez `POST /api/vault/commit` s právami
>   používateľa (RLS + WORM/insert triggery, stav `pending`, auditná udalosť). S3 kľúč musí presne
>   zodpovedať prípadu, hashu a súboru; opakovaný commit je idempotentný.
> - `GET /api/vault` číta zoznam z ledgeru — záznam po obnovení stránky nezmizne.
> - UI zobrazuje stav zo servera (`checking` → `verified` až po workeri), nie natvrdo `verified`.
>
> **Zostáva:** ak priamy PUT zlyhá, UI prejde na multipart `/api/vault`, ktorý ukladá iba do pamäte
> procesu a na Verceli je limitovaný veľkosťou tela. V produkcii treba priamy upload (S3 + CORS).

- **Vyriešené migráciou `20260927234500_evidence_ledger_worm`:** identifikačné stĺpce sú WORM,
  mazanie iba cez auditovanú RPC, registrácia/zmazanie/overenie sú v auditnom hash-chaine a hash
  sa overuje na serveri voči objektu v S3.
- **Hash počíta klient pri uploade;** kým worker dôkaz neoverí, má stav `pending` — dôkaz bez stavu
  `verified` sa nesmie prezentovať ako overený.
- **Objekt v S3 nie je chránený databázou.** Nemennosť súboru v úložisku vyžaduje retenciu /
  object lock na buckete (nastavenie u poskytovateľa S3).
- Závislosti: 4 high zraniteľnosti (electron, major upgrade v P3); CI gate je `critical`.
