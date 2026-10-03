# PΛND0RΛ Forensic OS — Backlog Source of Truth

Produktový a technický kontrakt celého systému je v [System Source of Truth](SOURCE-OF-TRUTH.md). Tento súbor je autoritatívny iba pre prioritu otvorených úloh a nesmie prepisovať bezpečnostné invarianty alebo runtime kontrakty.

> **Status:** Authoritative — jediný plánovací a dodací backlog.
> **Last reviewed:** 2026-09-28 (overené proti `main` @ `801129b`)
> **Scope:** `youh4ck3dme/forenx-pandora-os` a prepojený `-forenx-core-engine`
> **Zdroje zlúčené do tejto verzie:**
> - predchádzajúci backlog (P0–P3, § 7–11),
> - forenzný bezpečnostný audit na commite `67a64f7` (nálezy **N-01 až N-10**).
>   Každý nález bol 2026-09-28 znovu overený proti `main` @ `801129b`: **všetkých 10 je stále otvorených.**
>
> **Pravidlo:** Druhý backlog nevytvárať. Stav, dôkaz a ďalší krok sa menia iba tu.
> Hotové položky sú zhrnuté v § 12; detailné znenie starých promptov (§ 10–11 pôvodnej verzie) je v histórii gitu (`801129b`).

## 1. Legenda a pravidlá

| Stav                | Význam                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `DONE`              | Implementované a overené uvedenou kontrolou. Nasadenie treba overiť, ak je to uvedené.          |
| `IN PROGRESS`       | Implementácia existuje, ale časť akceptačných kritérií je otvorená.                            |
| `TODO`              | Nezačaté.                                                                                     |
| `RED`               | Overená chyba alebo produkčný blokátor. Bráni releasu.                                        |
| `BLOCKED`           | Vyžaduje nedostupný externý systém, prístup, administrátorský krok alebo asset.                |
| `ROTATION REQUIRED` | Tajomstvo treba pred produkciou vymeniť.                                                      |

**Pravidlo releasu:** Produkcia je zakázaná, kým je ktorákoľvek položka P0 `RED`, `BLOCKED` alebo
`ROTATION REQUIRED`. Úspešný lokálny build nikdy nedokazuje, že Vercel, Supabase, S3, DNS, Nginx
alebo podpisovanie desktopu je nakonfigurované.

**Hranica repozitárov:**

| Repozitár             | Zodpovednosť                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `forenx-pandora-os`   | Next.js App Router, Electron shell, Forza UI, deployment šablóny, web API routes.              |
| `-forenx-core-engine` | Headless Zod kontrakty, forenzika, RPO parsing, ledger, graph commity, Supabase migrácie.       |

## 2. Čo dnes blokuje release (zhrnutie)

| #  | Položka                                                        | Stav                | Kde           |
| -- | -------------------------------------------------------------- | ------------------- | ------------- |
| 1  | `POST /api/vault` bez autentifikácie, ownership a auditu (N-01) | `IN PROGRESS`       | P0-07         |
| 2  | Dev auth bypass cez hlavičku mimo loopbacku (N-03)             | `IN PROGRESS`       | P0-08         |
| 3  | Server funkcie sa vykonávajú aj v prehliadači (PR #18)         | `IN PROGRESS`       | P0-10         |
| 4  | Rotácia tajomstiev                                             | `ROTATION REQUIRED` | P0-02         |
| 5  | Doména, TLS, WebAuthn na produkcii                             | `BLOCKED`           | P0-01         |
| 6  | Migrácie na hostovanom Supabase                                | `BLOCKED`           | P0-03         |
| 7  | Záloha a obnova (PITR, Object Lock, drill)                     | `BLOCKED`           | P0-06         |
| 8  | CSP len Report-Only + API kľúč v localStorage (N-02, N-09)     | `IN PROGRESS` (CSP enforced, localStorage odstránený; nonce TODO) | P0-05 |
| 9  | Rate limity v pamäti na serverless (N-04)                      | `IN PROGRESS`       | P0-09         |
| 10 | Merge do `main` blokuje branch protection (§ 4)                | `BLOCKED`           | § 4           |

## 3. Quality gate

| Kontrola                               | Stav          | Dôkaz / poznámka                                                                                                   |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| Root TypeScript                        | `DONE`        | `npx tsc --noEmit` 0 chýb (2026-09-28, vetva `fix/gate-remaining-ai-text`).                                         |
| Testy aplikácie                        | `DONE`        | `npx vitest run`: 80 súborov / 570 testov (2026-09-28, vetva `fix/gate-remaining-ai-text`); `main` + #14: 79 / 555. |
| Electron TypeScript a security suite   | `DONE`        | `electron/__tests__` 17/17 (predchádzajúca verzia backlogu).                                                        |
| Core engine testy                      | `DONE`        | 559/559 (predchádzajúca verzia backlogu).                                                                           |
| Core engine TypeScript                 | `IN PROGRESS` | **Rozpor:** pôvodný § 2 hlásil 0 chýb, P3-03 hlásil TODO. Znova spustiť `npx tsc --noEmit` v core-engine a zapísať.  |
| Next produkčný build                   | `DONE`        | `npm run build` (30/30 routes, predchádzajúca verzia).                                                             |
| Audit závislostí                       | `RED`         | N-05: 3 high + 13 moderate; CI zmenená na `--audit-level=high` (2026-10-03) — zraniteľnosti samotné ostávajú. Pozri P1-06.  |
| Secret scan (gitleaks, celá história)  | `DONE`        | V CI beží. Falošné poplachy z `fix/gate-remaining-ai-text` sú od merge #19 v `.gitleaksignore`.                   |
| E2E (Playwright)                       | `TODO`        | Testy existujú (`e2e/`), ale CI ich nespúšťa.                                                                       |
| AST guard (`ci:guard`)                 | `TODO`        | Pokrýva iba `lib/ai` a CI ho nespúšťa (N-08).                                                                       |
| Migrácie Supabase                      | `BLOCKED`     | Lokálne `npx supabase db reset` prešiel (2026-09-27). Remote: chýba access token, nakonfigurovaný je len produkčný projekt. V repozitári je teraz 26 migrácií, lokálne overených bolo 24. |
| VPS / Docker runtime                   | `IN PROGRESS` | Manifesty a Nginx konfigurácia existujú; nasadenie na VPS neoverené.                                               |

## 4. Otvorené PR, issues a správa repozitára

| Položka | Stav | Ďalší krok |
| ------- | ---- | ---------- |
| PR #17 `fix/gate-remaining-ai-text` (fixes #16 + UI označenie neoverených tvrdení) | CI zelené, merge `BLOCKED` | Merge (pozri riadok o branch protection). |
| PR #18 `fix/server-fn-route-handlers` | otvorený | Review a manuálny test na stagingu (P0-10). |
| PR #19 `ci/gitleaks-ignore-question-ids` | `DONE` (mergnutý 2026-09-28) | Otvorené PR si majú aktualizovať vetvu z `main`, aby gitleaks prešiel. |
| PR #15 `chore/untrack-preflight-sql` (draft) | otvorený | Mergnúť. |
| Issue #16 (ďalší voľný text modelu bez väzby na dôkaz) | otvorené | Zavrie ho merge PR #17. |
| **Branch protection na `main`** | `BLOCKED` | Nastavené je `require_last_push_approval: true`: posledný push musí schváliť niekto iný než autor. Pri jednom správcovi sa PR nedá mergnúť bez `--admin`. Rozhodnúť: pridať druhého reviewera, alebo toto pravidlo vypnúť. |
| **Priame pushe do `main`** | `TODO` | Commity idú do `main` aj mimo PR (napr. `a281836`, `1015148`, `801129b`). Zapnúť „Require a pull request before merging“, ale až po vyriešení riadku vyššie. |
| **Zmergované vetvy na GitHube** | `TODO` | 13 zmergovaných vetiev (`chore/vercel-pandora-domain` … `ops/staging-update`) zmazať. |

## 5. P0 — bezpečnosť, nasadenie, integrita dôkazov

### P0-01 — Doména, TLS a WebAuthn

**Stav:** `BLOCKED`
**Funguje:** produkčné šablóny používajú `NEXT_PUBLIC_RP_ID="whoiswho.at"`; export sa podpisuje cez
`navigator.credentials.create` (`lib/forza/webauthn-signature.ts`) s fallbackom na lokálny ECDSA kľúč.

- [ ] Overiť DNS pre `pandora.whoiswho.at`.
- [ ] Overiť platné TLS z verejného internetu.
- [ ] Zaregistrovať a použiť passkey na `whoiswho.at` a `pandora.whoiswho.at`.

**Potrebné od vlastníka:** prístup k Vercel/DNS a test v produkčnom prehliadači.

### P0-02 — Hranica tajomstiev a rotácia kľúčov

**Stav:** `ROTATION REQUIRED`

- [x] `.env`, `.env*.local`, certifikáty, SQLite journaly, IndexedDB a dumpy sú ignorované.
- [x] gitleaks skenuje celú históriu v CI (`production-verification.yml`); falošné poplachy sú v `.gitleaksignore` podľa presného fingerprintu.
- [ ] Vymeniť `SUPABASE_SERVICE_ROLE_KEY`, S3 prístupy, Mistral, Gemini a každé ďalšie tajomstvo, ktoré sa mohlo objaviť v histórii.
- [ ] Nahradiť ich vo Vercel, na VPS, v Supabase, S3 a u vývojárov.
- [ ] Spustiť `npm run verify:vercel-env -- --strict` s reálnou konfiguráciou.

### P0-03 — S3 trezor dôkazov a RLS

**Stav:** `IN PROGRESS` (vstupnú vrstvu blokuje P0-07)

- [x] Presign/upload vstupy a výstupy striktne validované; ownership fail-closed pre GET a presign.
- [x] WORM ledger (`20260927234500_evidence_ledger_worm.sql`), auditované mazanie, serverové overenie SHA-256 (`/api/vault/verify`).
- [x] RLS `evidence_items` 17/17 PASS (PGlite); unikátny kľúč dôkazu (`20260928000000_evidence_unique_key.sql`); attacker suite 10/10.
- [ ] Aplikovať migrácie na hostovaný Supabase (`supabase db push`).
- [ ] Nahrať 250 MB fixture cez produkčnú presigned URL.
- [ ] Zapísať záznam dôkazu po uploade transakčne.
- [ ] Overiť odmietnutie cudzieho prípadu autentifikovaným útočníkom na živom nasadení.
- [ ] Overiť súbežnosť: paralelné `POST /api/vault` + commit + verify proti živej DB (audit D5).

### P0-04 — Monitoring a alerting

**Stav:** `IN PROGRESS`

- [x] Alerty na AI timeout > 60 s, zlyhania S3 > 1 % a Supabase (`/api/health/observe`, `20260928000100_operational_metrics.sql`).
- [x] Trace ID (`x-trace-id`) na API routes a Mistral volaniach, sanitizované logy.
- [x] Vlastník alertov, eskalácia a runbook (`docs/ALERTING.md`).
- [ ] Nasadiť Sentry alebo ekvivalent na frontend aj server.
- [ ] Otestovať alert end-to-end na produkcii.

### P0-05 — Hlavičky, CSP a ochrana klienta (N-02, N-09, N-10)

**Stav:** `IN PROGRESS`

- [x] Nginx šablóna: 250 MB limit, streaming, 500 s timeouty, HSTS, `nosniff`, `DENY`, permissions policy.
- [x] CSP Report-Only a zberač `/api/csp-report/` (rate limit, sanitizácia, audit) — 5/5 testov.
- [x] **N-02 (PARTIAL):** CSP zmenená z `Content-Security-Policy-Report-Only` na `Content-Security-Policy` (`next.config.mjs`). Hlavička je teraz vynútená. `script-src` stále obsahuje `unsafe-inline` — vyžaduje nonce injection v middleware (TODO).
- [x] **N-09:** BYOK kľúč Mistral/OpenAI odstránený z `localStorage` (`lib/store/browser-store.ts`). Kľúče teraz žijú iba v pamäti Zustand stavu (session-only); po refreshe stránky je potrebné znovu zadať. (2026-10-03)
- [x] **N-10:** `images.remotePatterns` zúžené z `hostname: "**"` na konkrétne hosty (Supabase, Hetzner S3, GitHub avatars, Google avatars) (`next.config.mjs`). (2026-10-03)
- [ ] **N-02 (TODO):** Implementovať nonce injection v `middleware.ts`, nahradiť `unsafe-inline` nonce-om v `script-src`, zúžiť `connect-src` na allowlist.
- [ ] Nasadiť Nginx šablónu a overiť `nginx -t` na VPS.
- [ ] Rozhodnúť o HSTS `preload` pre rodičovskú doménu; až potom predĺžiť max-age.

### P0-06 — Záloha a obnova

**Stav:** `BLOCKED` (runbook hotový: `docs/DISASTER_RECOVERY_RUNBOOK.md`)

- [ ] Zapnúť a overiť Supabase PITR.
- [ ] Zapnúť S3 versioning a Object Lock/WORM pre bucket dôkazov.
- [ ] Vykonať a zdokumentovať drill obnovy celého prípadu do 15 minút.

### P0-07 — `POST /api/vault` bez autentifikácie (N-01) — **NOVÉ**

**Stav:** `IN PROGRESS` — oprava v kóde hotová (vetva `fix/vault-post-auth`), chýba overenie na nasadení.
**Pôvodný dôkaz (overené na `801129b`):** `handlePost` (`app/api/vault/route.ts:228`) nevolá
`authenticateVaultRequest`, `verifyCaseOwnership` ani `logVaultAccess`. GET ich volá (`:70`, `:105`, `:163`, `:123`, `:180`).
`uploadedBy` je napevno `"investigator-session-user"` (`:315`); upload končí v `inMemoryEvidenceStore` (`:330–331`).
**Dopad:** kto pozná URL, zapíše do trezoru ľubovoľný súbor do 250 MB pod ľubovoľný `caseId`. Kontaminácia reťazca dôkazov, DoS a neobhájiteľný audit.

- [x] Auth na začiatku `handlePost` ešte pred čítaním tela (401), v produkcii UUID `caseId` (400).
- [x] Ownership: `not_found` → 404, `forbidden` → 403, `unavailable` → 503.
- [x] Audit `action: "upload"` fail-closed (500 pri zlyhaní zápisu; bez tokenu v produkcii 503).
- [x] `uploadedBy` = reálne `auth.userId`.
- [x] V produkcii žiadna cesta, kde dôkaz skončí v S3 bez zápisu do ledgera: bez ledgera 503 ešte pred uploadom; záznam `pending` vzniká cez `registerEvidence` **pred** uploadom pod kľúč `evidence/` (rovnaký ako presign). Keď S3 zlyhá, záznam ostáva sledovaný (502, opakovaný upload ho doplní); objekt sa nikdy nemaže. Prázdny súbor → 400.
- [x] Testy: `lib/__tests__/vault-route-auth.test.ts` (401 ×2, 403, 404, 503 ×2, 400, audit 500, happy path s auditom a ledgerom, nesúlad hashu); 9 z nich na pôvodnom kóde zlyhá.
- [ ] Na nasadení: `curl -X POST /api/vault` bez `Authorization` → 401; s tokenom a cudzím prípadom → 403; vlastný prípad → 201 a riadok v audite s `action = 'upload'`.

### P0-08 — Dev auth bypass cez hlavičku (N-03) — **NOVÉ**

**Stav:** `IN PROGRESS` — oprava v kóde hotová (vetva `fix/dev-auth-bypass`); otvorené je vylúčenie z produkčného bundlu.
**Pôvodný dôkaz:** `lib/storage/vault-auth.ts:36, 67–71`. Pri `NODE_ENV !== "production"` sa prijme identita
z `x-dev-user-id` / `x-user-id` (default `dev-investigator-001`) bez tokenu; v GET sa zároveň vypína ownership aj audit.
Na preview/staging nasadení s iným `NODE_ENV` sa dá vydávať za ľubovoľného vyšetrovateľa.

- [x] Obchvat (`devAuthBypassAllowed`) len pri `NODE_ENV=test`, alebo pri `next dev` s výslovným `PANDORA_DEV_AUTH_BYPASS=1`, mimo Vercelu, pre loopback požiadavku a **bez prístupu k reálnym dôkazom** (bez S3 kľúčov a service role); inak 401. Loopback sa v route nedá spoľahlivo overiť (`Host` aj `x-forwarded-for` sú podvrhnuteľné, adresa socketu nie je dostupná), preto podvrhnutý obchvat nemá čo získať. V `next dev` je identita obchvatu pevná (`x-dev-user-id` len v unit testoch).
- [x] Kontrolu vlastníctva a audit preskakuje iba skutočný obchvat (`auth.devBypass`), nie `NODE_ENV`: skutočný token má plné kontroly v každom prostredí (GET zoznam aj presign na stiahnutie, POST, presign na upload, commit).
- [x] Presign na upload bez service role už vlastníctvo nepreskočí, ale vráti 503.
- [x] Testy: `lib/__tests__/vault-dev-bypass.test.ts` (18, z toho 13 na pôvodnom kóde zlyhá) vrátane „vzdialený host + `x-dev-user-id` → 401 pri `NODE_ENV=development`“.
- [ ] Dev-only modul, ktorý produkčný build vynechá; test, že `.next` neobsahuje `x-dev-user-id`, `investigator-session-user`, `dev-investigator-001`.

### P0-09 — Rate limity a stav v pamäti na serverless (N-04) — **NOVÉ**

**Stav:** `IN PROGRESS` — oprava v kóde hotová (vetva `fix/shared-rate-limit`); chýba aplikovanie migrácie a load test na nasadení.
**Pôvodný dôkaz:** `new Map()` v `app/api/csp-report/limiter.ts:3`, `app/api/health/observe/limiter.ts:2` a
`inMemoryEvidenceStore` v `app/api/vault/route.ts:51`. Na serverless má každá inštancia vlastnú pamäť,
takže limit sa obíde rozložením požiadaviek.

- [x] Rozhranie `RateLimiter` (`lib/security/rate-limiter.server.ts`): v produkcii zdieľané počítadlo v Postgrese (`rate_limit_hit`, migrácia `20260929000000_shared_rate_limit.sql`) namiesto Redisu, bez nového dodávateľa. `Map` len pre dev/testy. Fail-closed: produkcia bez service role alebo pri chybe DB vráti 503, nikdy nespadne do pamäte. Kľúč (IP / ID používateľa) sa ukladá len ako SHA-256.
- [x] `inMemoryEvidenceStore` mimo produkčnej cesty: číta sa aj zapisuje iba pri lokálnom dev obchvate, zoznam so skutočným tokenom je výhradne z ledgera.
- [x] Testy: `supabase/tests/shared-rate-limit.test.ts` (PGlite: počítanie, neplatné parametre, práva anon/authenticated), `lib/__tests__/rate-limiter.test.ts`, route testy (zdieľaný limit naprieč „inštanciami“, 503 bez konfigurácie a pri chybe DB, izolácia pamäťového registra); 5 route testov na pôvodnom kóde zlyhá.
- [ ] Aplikovať migráciu na hostovaný Supabase (spolu s P0-03).
- [ ] Load test: 100 paralelných požiadaviek cez viac inštancií rešpektuje limit.
- Poznámka: kľúč CSP limitu je IP z `x-forwarded-for`, ktorá je podvrhnuteľná (N-06, P1-04); pevné okno pripúšťa na hranici okna až 2× limit.

### P0-10 — Server funkcie len na serveri — **NOVÉ**

**Stav:** `IN PROGRESS` (PR #18)
Všetkých 39 `createServerFn` sa má vykonávať iba v route handleri `/api/fn/[...id]` s Bearer tokenom.

- [ ] Review a merge PR #18 spolu s novým `deploy/nginx.conf` (inak veľké uploady narazia na 10 MB limit a AI na 60 s timeout).
- [ ] Manuálny test na stagingu: AI status, uloženie prípadu, autopilot, hromadný upload.
- [ ] Follow-up: `whoiswho.functions.ts` číta serverové env v prehliadači (integrácia je potichu vypnutá) → presunúť za route.
- [ ] Follow-up: serverový kód handlerov je stále v klientskom bundli → oddeliť od `*.functions.ts`.

## 6. P1 — súlad a pripravenosť pre súd

### P1-01 — Deterministický dossier pre súd

**Stav:** `IN PROGRESS`

- [x] Tvrdenia, toky, hypotézy Devil's Advocate a § 119 vady sú faktom len s `sourceRef.evidenceId` hash-overeného záznamu WORM ledgera a locatorom strana/odsek (`lib/forza/evidence-binding.ts`).
- [x] Číslované závery I.–III. len z viazaných tvrdení; naratív modelu iba ako označený neoverený návrh (#13 → PR #14).
- [x] Podpis vyšetrovateľa s nezávislým overením (`lib/forza/investigator-signature.ts`), WebAuthn prepojený s exportom (P0-01).
- [ ] Odpovede ÚBOK, záver o financovaní a stav zákonných znakov viazať na dôkaz; v UI označiť neviazané (#16 → PR #17, čaká na merge).
- [ ] Ďalší voľný text modelu stále bez väzby: `testimonyContradictions` (tvrdenia osôb, „miera nepravdy“ v %), `directEvidence`, `unverifiedHypotheses`, súhrnné sumy `financialAnalysis` (total/cash/transfer). Rozhodnúť väzbu alebo označenie, ako pri #16.
- [ ] Spustiť Autopilot s načítaným ledgerom a overiť, že model vypĺňa nové polia `sourceRef`.
- [ ] Vytvoriť a s právnikmi preveriť reálny PDF/JSON-LD dossier.

### P1-04 — GDPR a privacy gateway

**Stav:** `IN PROGRESS`

- [x] Redakcia PII pred Mistral/Gemini, v exporte, telemetrii a logoch.
- [x] Nemenný audit prístupov (`log_case_access`, `/api/audit/access`).
- [ ] **N-06 (MEDIUM):** IP v audite sa berie z prvej hodnoty `x-forwarded-for` bez validácie (`app/api/audit/access/route.ts:80–81`), takže je falšovateľná. Použiť IP pridanú platformou (posledná hodnota / `x-real-ip` podľa dokumentácie platformy), identitu brať z `auth.uid()` v SECURITY DEFINER funkcii; test so spoofovanou hlavičkou.
- [ ] Overiť RLS a `log_case_access` v živej DB ako rola `authenticated` (audit D2).
- [ ] DPIA a review politiky uchovávania.

### P1-05 — Konfigurácia produkcie (N-07) — **NOVÉ**

**Stav:** `TODO` (MEDIUM)

- [ ] `.env.production.example` (aj `.env.example`) má `ICO_ATLAS_API_URL` cez nešifrované `http://` na surovú IP. Zmeniť na `https://` placeholder a v `scripts/vercel-preflight.mjs` odmietnuť produkčnú hodnotu bez `https`.
- [ ] Preflight rozšíriť o kontrolu https-only externých URL a prítomnosti `CRON_SECRET`.

### P1-06 — Supply chain a CI brány (N-05, N-08) — **NOVÉ**

**Stav:** `RED`

- [ ] **N-05:** `npm audit`: 3 high (extract-zip cez electron, postcss ≤ 8.5.22) + 13 moderate. Aktualizovať postcss a electron mimo zraniteľného rozsahu.
- [ ] **N-05:** v `production-verification.yml:68` zmeniť `--audit-level=critical` na `high`. Dnes je to v rozpore s § 11 (požiadavka „žiadne high“).
- [ ] **N-08:** `eslint.ignoreDuringBuilds: true` (`next.config.mjs:15`) → `false` po vyčistení lint chýb.
- [ ] **N-08:** `ast-guard` rozšíriť z `lib/ai` na `app/api/**`: každý handler musí volať auth guard, alebo mať zdokumentovanú výnimku `// @no-auth-reason`. Spúšťať v CI.
- [ ] Spúšťať Playwright E2E v CI na každý PR do `main`.

## 7. P2 — produkt, UX, prístupnosť

### P2-04 — Načítavanie, prázdne a offline stavy

**Stav:** `IN PROGRESS`

- [x] Skeletony a akčné prázdne stavy pre Osoby, Vzťahy, Zbrane, Bankové výpisy a Trezor.
- [ ] Jasne odlíšiť lokálne cacheované/offline dáta od synchronizovaných.

## 8. P3 — architektúra, výkon, desktop

### P3-02 — Výkon pri veľkých dátach

**Stav:** `IN PROGRESS`

- [x] 100 000-riadkový CSV import vo workeri (~0,3 s), virtualizovaný zoznam transakcií.
- [x] Skript rozpočtov `scripts/ci/run-performance-budget.mjs` existuje.
- [ ] Zapojiť rozpočty výkonu a opakovateľné benchmark fixtures do CI (dnes ich CI nespúšťa).
- [ ] Benchmark 5 000 uzlov/hrán grafu na definovanom zariadení pri 60 FPS.

### P3-03 — Zod kontrakty a striktné typy

**Stav:** `IN PROGRESS`

- [x] Striktná Zod validácia na hraniciach vault, presign, graph a case; root `tsc` čistý.
- [ ] Odstrániť zvyšné `any`, nebezpečné casty a non-null assertions z produkčných ciest.
- [ ] Core-engine `tsc --noEmit`: vyriešiť rozpor z § 3 a zapísať aktuálny výsledok.
- [ ] Kontraktové testy pre každú externú API/RPC hranicu; minimálne pre každú API route test na 401, 403 a happy path.

### P3-04 — Podpisovanie a aktualizácie desktopu

**Stav:** `BLOCKED` (skript `scripts/desktop/sign-and-notarize.mjs` s `--dry-run` existuje, chýbajú certifikáty)

- [ ] Získať a nastaviť Windows code-signing certifikát.
- [ ] Nastaviť macOS notarizáciu (`APPLE_ID`, heslo aplikácie, `APPLE_TEAM_ID`) a validáciu ticketu.
- [ ] Staged auto-update kanál cez GitHub Releases s rollbackom.
- [ ] Vyhodnotiť zabalený Electron artifact: ASAR, podpis, update kanál (audit D4).

## 9. Prierezová integrita forenzných dát

| Položka                                | Stav          | Ďalší krok                                                                                  |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| Atomický AI graph commit               | `BLOCKED`     | Migrácia `20260927113000_case_graph_hardening.sql` už v repozitári je. Overiť na stagingu: zámok riadku prípadu, odmietnutie cudzieho vlastníka, rollback bez čiastočných dát. Remote chýba prístup. |
| Custody ledger UI a detekcia manipulácie | `IN PROGRESS` | Aplikovať migráciu a spustiť end-to-end scenár manipulácie.                                 |
| Izolácia prompt injection              | `IN PROGRESS` | `sourceRef` povinný pri každom závere modelu (P1-01); adversariálne testy vložených pokynov. |
| Homonymá, RPO, časové vzťahy, kanonické hashe, peniaze v centoch, bankové CSV | `DONE` | Udržiavať regresné fixtures (IČO `54684994`; TB, SLSP, VÚB, ČSOB, Fio). |

## 10. Poradie práce

1. **Odblokovať repozitár:** vyriešiť branch protection (§ 4), potom mergnúť #17, #15 a tento backlog.
2. **Zavrieť `RED` bezpečnostné nálezy v kóde:** P0-07 (N-01), P0-08 (N-03), P0-10 (PR #18), P0-09 (N-04). Jeden nález = jeden PR s testom.
3. **Rotovať tajomstvá** (P0-02) pred akýmkoľvek novým nasadením.
4. **CI brány:** P1-06 (audit high, eslint, ast-guard pre `app/api/**`, E2E), P1-05 (https-only konfigurácia).
5. **CSP a klient:** P0-05 (nonce CSP → enforce, BYOK kľúč, remotePatterns).
6. **Databáza:** migrácie na stagingu, potom produkcia (P0-03, § 9); RLS a audit v živej DB (P1-04).
7. **Nasadenie a prevádzka:** DNS/TLS/WebAuthn (P0-01), Nginx na VPS, Sentry (P0-04), PITR, Object Lock a drill obnovy (P0-06).
8. **Súd a súkromie:** zvyšok P1-01, DPIA (P1-04), právne review dossieru.
9. **Produkt a desktop:** P2-04, P3-02, P3-03, P3-04.

## 11. Dôkazy potrebné pred releasom

Pred zmenou celkovej brány z `RED` na `GREEN` priložiť datované dôkazy pre:

- dokončenú rotáciu tajomstiev;
- `npm audit` bez high a critical;
- root aj core-engine `tsc --noEmit` s nulou chýb;
- kompletné reporty testov vrátane E2E;
- produkčné buildy Next a Electron;
- ID aplikovaných Supabase migrácií a výstup integračných testov;
- verejný test DNS/TLS/WebAuthn;
- test RLS/IDOR, `POST /api/vault` 401/403 a 250 MB priamy S3 upload;
- produkčný build bez reťazcov `x-dev-user-id`, `investigator-session-user`, `dev-investigator-001`;
- vynútenú CSP s 0 porušeniami za 7 dní;
- rate limity funkčné naprieč inštanciami (load test);
- drill obnovy zo zálohy;
- test monitoringu a alertov;
- právne review dossieru;
- overenie podpisu a aktualizácií desktopu.

## 12. Hotovo (archív, skrátene)

| Oblasť | Dôkaz |
| ------ | ----- |
| P1-02 Prípustnosť a slovenský trestný poriadok | Typované právne záznamy, zdroj pri každom závere, náprava procesných rizík v dossieri. |
| P1-03 Uchovávanie, legal hold, riadené zničenie | `set_case_status`, admin pre uvoľnenie holdu, `destroy_case` s nemenným auditom. |
| P2-01 Spätná väzba mutácií | Busy/disabled stavy, retry, potvrdenie názvom prípadu pri mazaní. |
| P2-02 Prístupnosť a dynamický viewport | Radix focus trap, klávesnica a čítačka, WCAG 2.1 AA kontrast, testy kontrastu. |
| P2-03 Terminológia „Prípad“ | `lib/__tests__/terminology.test.ts` (0 výskytov „Projekt“). |
| P3-01 Hranica Web/Electron | Úzke typované `contextBridge` API, sandbox, izolácia, obmedzené IPC a navigácia. |
| Závislosti — `xlsx` | Odstránené, nahradené `read-excel-file/node`. |
| Deployment artefakty (pôvodný § 11) | `docker/Dockerfile.production`, `docker-compose.production.yml`, `scripts/ci/run-performance-budget.mjs`, `supabase/migrations/20260927113000_case_graph_hardening.sql`, `docs/DISASTER_RECOVERY_RUNBOOK.md`, `scripts/desktop/sign-and-notarize.mjs` — súbory existujú; ich nasadenie a zapojenie do CI sledujú P0-06, P3-02, P3-04 a § 9. |
| Megaprompt Task 1–4 (pôvodný § 10) | Task 1 (`xlsx`) a Task 4 (závery viazané na dôkazy) hotové; Task 2 a Task 3 pokračujú v P3-03 a § 9; Task 5 je rozpísaný do P0-01 až P0-06. |
| Staging Hotfix (2026-10-03) | Session bridge trailing slash fix (`/api/auth/session/`) + proxy Origin, AI consent dialog outside-click UX stabilita + verzia `2026.09-1`, server-fn 403 pre nepovolené/neodsúhlasené volania namiesto 500 a stop pollingu na stav stránke pri 403, Vault caseId UUID validácia (odstránenie 22P02 chyby a hardcoded CASE-KS fallbacku) s 503 error bannerom v UI pri chýbajúcom S3, canonical HTTPS favicon.ico. |

**Mimo auditu bez nálezu (pre úplnosť):** Electron `webPreferences` (sandbox, contextIsolation, bez nodeIntegration)
a SSRF guard vrátane IPv6-mapped IPv4; migrácie dôsledne používajú RLS a SECURITY DEFINER so `search_path = public`.
