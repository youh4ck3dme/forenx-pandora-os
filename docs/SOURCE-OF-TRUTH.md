# PΛND0RΛ / ForenX — System Source of Truth

> Kanonický technický kontrakt pre správanie aplikácie, dátové toky, bezpečnostné hranice a integračné pravidlá.

Tento dokument je zdrojom pravdy pre vývoj webu, PWA/mobile, Electronu, Supabase a ForenZX MCP integrácie. Ak sa README, starší návrh alebo komentár v kóde líši od implementácie a testov, rozhoduje tento dokument až do jeho aktualizácie spolu s príslušným kódom a testami.

## 1. Pravidlá zdroja pravdy

Poradie autority:

1. bezpečnostné a dátové invarianty v tomto dokumente,
2. databázové migrácie a serverové kontrakty,
3. automatizované testy,
4. implementácia,
5. UI texty, README a pracovné návrhy.

Každá zmena správania musí aktualizovať príslušný kontrakt, test a dokumentáciu v jednom commite. Dokumentácia nesmie tvrdiť, že je systém pripravený, ak chýba dôkaz z relevantného testu alebo deploymentu.

## 2. Produktový model

PANDORA / ForenX je jedna aplikácia s viacerými runtime obalmi:

| Runtime | Úloha | Zdroj aplikačnej logiky |
|---|---|---|
| Web | hlavné UI, API routes, serverové operácie | `app/`, `components/`, `lib/` |
| PWA | webové UI s lokálnou cache a offline stavmi | web runtime + `lib/forza/idb.ts` |
| Capacitor mobile | natívny Android/iOS obal | `capacitor.config.*`, `scripts/mobile/` |
| Electron | desktopový bezpečný shell | `electron/` + webové UI |
| Supabase | Auth, PostgreSQL, RLS, migrácie, Edge Functions | `supabase/` |
| ForenZX MCP Hub | izolovaná analýza a forensic worker joby | samostatný Hub repozitár |

Web, PWA, mobile a Electron nesmú implementovať rozdielne pravidlá pre vlastníctvo prípadu, integritu dôkazu alebo AI výstupy. Rozdiely medzi runtime patria do adaptérov, nie do dátového modelu.

## 3. Kanonický dátový tok

```text
User/Auth identity
        ↓
Case
        ↓
Evidence metadata + immutable source snapshot
        ↓
Object storage (S3/Supabase Storage) + SHA-256
        ↓
Verification status
        ↓
Privacy gateway / PII redaction
        ↓
AI analysis (Mistral/Forza alebo ForenZX MCP Hub)
        ↓
Source-bound findings + execution record
        ↓
Human review
        ↓
Report / export + audit trail
```

Platí invariant:

```text
AI OUTPUT ≠ EVIDENCE
```

AI môže vytvoriť hypotézu, klasifikáciu alebo nález, ale nesmie zmeniť pôvodný dôkaz, jeho hash, reťazec vlastníctva ani označiť neoverené tvrdenie za fakt.

### 3.1 Autentifikácia a relácie (Auth Session Invariants)

- **Klientske ukladanie vs. Serverový middleware:** Supabase JS ukladá reláciu na klientovi do `localStorage`. Next.js Edge Middleware (`middleware.ts`) a Server Components overujú reláciu server-side cez HTTP cookies (`sb-access-token`, `sb-refresh-token`) a `Authorization: Bearer <token>` header.
- **Synchronizácia do cookies (`lib/auth/cookies.ts`):** Po úspešnom `signInWithPassword`, `signUp` alebo `TOKEN_REFRESHED` sa tokeny synchrónne zapisujú do `document.cookie` (`sb-access-token`, `sb-refresh-token` s parametrami `Path=/`, `SameSite=Lax`, `Secure` pri HTTPS).
- **Globálny cookie sync (`components/core/providers/auth-cookie-sync.tsx`):** V pozadí počúva na `onAuthStateChange` a udržiava cookies v súlade s platným Supabase tokenom.
- **Čistenie relácie:** Pri odhlásení cez `signOutEverywhere` / `clearClientState` sa cookies zneplatnia (`Max-Age=0`).
- **Presmerovanie po prihlásení:** Pri neautentifikovanom prístupe k chráneným trasám middleware presmeruje priamo na `/auth/login?next=<sanitized_path>`, pričom cieľová cesta musí prejsť validáciou open-redirect ochrany (`lib/auth/redirect.ts`).

## 4. Vlastníctvo dát

| Dáta | Autoritatívne úložisko | Klientská cache |
|---|---|---|
| používateľ a session | Supabase Auth | iba session metadata |
| case a jeho vlastníctvo | PostgreSQL/Supabase + RLS | odvodený UI stav |
| originálny súbor | S3/Supabase Storage | nikdy nie ako jediný zdroj |
| hash, MIME, veľkosť, status | PostgreSQL/evidence ledger | read-only zobrazenie |
| audit a chain of custody | immutable DB log / WORM pravidlá | bez možnosti zápisu spätne |
| AI finding | databázový workflow záznam | dočasný progress stav |
| offline dáta | IndexedDB iba ako cache | musia mať jasný TTL a invalidáciu |

Klient nesmie byť autoritou pre `user_id`, vlastníctvo case, verified status, SHA-256 ani oprávnenie spustiť analýzu. Tieto hodnoty sa overujú na serveri alebo v databáze.

## 5. Životný cyklus dôkazu

1. Používateľ vyberie súbor v UI.
2. Server vytvorí metadata a vypočíta alebo overí SHA-256.
3. Súbor sa uloží do povoleného objektového úložiska.
4. Evidence row obsahuje case, user, storage reference, názov, MIME, veľkosť, hash a stav overenia.
5. Analýza je povolená iba pre dôkaz so stavom `verified`.
6. Pred analýzou a exportom sa overí aktuálny hash voči pôvodnému hashu.
7. Pri hash mismatch sa analýza zastaví, výsledný súbor sa podľa workflowu odstráni alebo izoluje a job je `FAILED`.
8. Každá zmena stavu a citlivá operácia sa zapíše do auditnej stopy.

Zakázané:

- prepísať pôvodný dôkaz novým obsahom,
- obísť `verified` stav iba zmenou v klientovi,
- použiť neoverenú URL alebo neznámy hostname na download,
- vymazať auditný záznam, aby sa skryl neúspešný pokus.

### 5.1 Priamy upload do S3 a WORM Trezora (Blueprint P3)

- **Pre-flight SHA-256 a presign:** Klient pred uploadom spočíta SHA-256 hash cez `crypto.subtle.digest`. Následne požiada server o presigned URL (`POST /api/vault/presign`) s overením existencie a vlastníctva `caseId` (striktne UUID).
- **Fail-closed správanie pri uploade:** Pri HTTP 401/403 je proces uploadu okamžite zastavený s chybou prístupu. Je zakázané prepnúť na neoverený unauthenticated multipart fallback.
- **Autorizovaný presigned download:** Endpoint `GET /api/vault?storageKey=...&action=presign` vydá presigned URL na stiahnutie iba v prípade, že `storageKey` existuje v `evidence_items` ledgeri a patrí autentifikovanému vyšetrovateľovi s prístupom k danému spisu (ochrana pred IDOR a neautorizovaným čítaním z bucketu).
- **Podpora mobilného forenzného triage (ALEAPP, iLEAPP, Andriller):** Súbory z mobilných extrakcií (`.tar`, `.gz`, `.tgz`, `.ab`, `.zip`), databázy (`.sqlite`, `.db`, `.sqlite3`), auditné logy (`.log`, `.txt`), ako aj výstupy reportérov ALEAPP / iLEAPP / Andriller sú automaticky tagované a prijaté do úložiska s výpočtom SHA-256 integrity.
- **Asynchrónna periodická verifikácia integrity (VPS cron):** Skript `deploy/vps/verify-cron.sh` (inštalovaný cez `deploy/vps/setup-verification-cron.sh`) beží v intervale `*/2 * * * *` a volá `/api/vault/verify?limit=25` autorizovaný cez tajomstvo `CRON_SECRET` (min. 32 znakov). Pri zistení nesúladu hashu prepne stav položky na `compromised`.
- **Zákaz analýzy neoverených dôkazov v UI:** Tlačidlo „Odoslať na AI analýzu“ je v `evidence-vault-panel.tsx` povolené výhradne pre položky so stavom `integrityStatus === 'verified'`. Položky so stavom `checking` alebo `compromised` majú akciu zablokovanú (`AI OUTPUT ≠ EVIDENCE`).

## 6. AI a ForenZX kontrakt

AI vstup prechádza privacy gateway. Pred odoslaním sa odstránia alebo pseudonymizujú citlivé údaje podľa existujúcich modulov:

- `lib/forza/ai/redact.ts`,
- `lib/forza/ai/pii-redactor.ts`,
- `lib/forza/ai/privacy-gateway.ts`.

Každý nález musí mať, ak je to možné:

- identifikátor workflowu,
- zdrojový dokument alebo evidence ID,
- SHA-256/source snapshot referenciu,
- citát alebo presnú lokalizáciu,
- model a verziu promptu,
- stav overenia.

Ak zdroj nie je dostupný, výsledok je pracovná hypotéza alebo `UNVERIFIED_ASSERTION`, nie dôkaz. AI nesmie automaticky určovať vinu, psychologickú dôveryhodnosť osoby ani právnu kvalifikáciu.

### ForenZX MCP workflow

ForenZX integrácia sa vykonáva fail-closed:

```text
verified evidence
  → Supabase trigger
  → Edge Function
  → MCP tools/list
  → forenzx_analysis_start
  → allowlisted presigned download
  → streaming SHA-256 verification
  → isolated Docker forensic job
  → SSE progress
  → COMPLETED / FAILED
  → findings + execution record
```

### 6.1 Sprísnené AI schémy, oprava JSON, CSV a Export Manifest (Blueprint P4)

- **Striktná typizácia schémy (`lib/forza/forensic-dossier.schema.ts`):** Všetky sub-schémy (`timeline`, `traces`, `attacks`, `evidence`, `paragraphs`, `analysisMeta`) sú prísne typované Zod schémami namiesto voľných `z.record(z.unknown())`. Neznáme alebo malformované štruktúry zlyhajú na validačnej bráne.
- **Detekcia opraveného JSON (`wasRepaired`):** `parseForensicDossier` vracia `{ data, wasRepaired }`. Ak musel byť modelový JSON opravený (napr. doplnenie uzatváracích zátvoriek pre odseknutý výstup), výsledný chunk je transparentne označený ako `status: "repaired"` namiesto predstierania bezchybného pôvodného výstupu.
- **Deduplikácia bankových CSV importov (`lib/forza/import.functions.ts`):** `commitImport` validátor pred zápisom overuje prítomnosť duplicitných riadkov s identickou päticou `(date, amount, currency, from_id, to_id)` a zlyhá fail-closed s jasným zoznamom duplicitných riadkov (`DUPLICATE_IMPORT_ROWS`), aby sa predišlo viacnásobnému započítaniu transakcií.
- **Nezávislý export manifestu (`lib/forza/export-pdf.ts`):** Vyšetrovateľ si môže stiahnuť auditný balík reportu ako samostatný JSON (`downloadManifestJson`), ktorý obsahuje SHA-256 hash manifestu a stav všetkých overených dôkazov.
- **Forenzný disclaimer manifestu:** Hash manifestu je kryptografický dôkaz integrity samotného exportu, nie potvrdenie pravdivosti alebo súdnej prípustnosti hypotéz (`AI OUTPUT ≠ EVIDENCE`).

Kanonický webhook header je `x-forenzx-webhook-secret`. Edge Function musí overiť secret, evidence status, idempotency key a serverové údaje. Presigned download musí používať iba povolený hostname; HTTP, localhost, private IP, neoverené redirecty a nepovolené hosty sú odmietnuté.

MCP kontrakt musí obsahovať nástroj `forenzx_analysis_start` s `download_url` a `download_filename`. Hash mismatch alebo bezpečnostné odmietnutie nesmie skončiť ako úspešný job.

## 7. UI, PWA a mobile pravidlá

Mobile/PWA je klient rovnakého forenzného systému, nie samostatná databáza.

Verejne dostupná je iba read-only stránka `/forza/stav`. Ostatné stránky pod
`/forza` vyžadujú autentifikáciu a príslušný prístup k prípadu. Administrátorská
health funkcia a citlivé systémové dáta zostávajú chránené serverovým
oprávnením.

Verejný live dashboard používa iba `/api/health/public`, ktorý vracia
agregované metriky bez secrets, používateľských identifikátorov, obsahu logov,
promptov a stack traces. Zápisové API a administrátorský health endpoint sa
nesmú použiť ako verejný dátový zdroj.

### 7.1 Pravdivý live stav a diagnostika (Blueprint P5)

- **Kategorizácia a rozlíšenie úložísk:** Live stav pokrýva aplikačný server, databázu (dostupnosť, odozva, pripojenia, transakcie, zámky, veľkosť), evidenciu spisov, samostatné úložisko dokumentov Supabase, samostatný Hetzner S3 Trezor príloh, konfigurácie modelov Mistral (chat a analýza), telemetriu a úspešnosť AI, systémové chyby a lokálny PDF export. Úspešná kontrola jedného úložiska nesmie dokazovať dostupnosť druhého.
- **Bezpečná a nezvrstvená cache:** Endpoint `/api/health/public` vracia `Cache-Control: public, max-age=15, no-transform` bez CDN `stale-while-revalidate` okna. Zlyhané meranie sa nikdy neukladá do cache ako platný stav.
- **Čerstvosť meraní a varovanie pred zastaraním:** Každá položka obsahuje atribút `measuredAt`. UI automaticky obnovuje stav pri otvorení, každých 15 sekúnd a manuálne. Ak je meranie staršie ako 60 sekúnd, UI zobrazí varovanie o zastaranom stave. Pri chybe refreshu zostáva zobrazený posledný známy stav s jasným upozornením.
- **Hodnotenie AI úspešnosti:** Hranica chybovosti 10 % sa vyhodnocuje pred zaokrúhlením. Pri nulovom počte AI volaní je hodnota transparentne „Bez meraní“ so stavom `unavailable`, nikdy nie falošných 100 % úspešnosti.
- **Lokálny self-test PDF exportu:** Schopnosť exportu do PDF sa nehlási pevnou hodnotou `ok`, ale reálnym klientskym self-testom overujúcim `window.print` rozhranie a generovanie syntetického reportu s SHA-256 manifestom.
- **Korelačné ID:** Middleware generuje alebo propaguje hlavičku `x-correlation-id` pre sledovateľnosť požiadaviek naprieč UI, API, S3 trezorom a workerom bez zaznamenávania citlivých údajov.

Povinné UI stavy:

- `idle` — nič sa nespúšťa,
- `disabled` — chýba vstup alebo oprávnenie,
- `queued` — požiadavka prijatá,
- `running` — prebieha spracovanie,
- `verified` — dôkaz je overený,
- `completed` — výsledok je dostupný,
- `warning` — výsledok je čiastočný alebo vyžaduje kontrolu,
- `failed` — operácia zlyhala s bezpečným dôvodom.

Prázdny case nesmie spustiť analýzu. Chybové stavy musia byť konkrétne, ale nesmú zobrazovať secret, interný stack trace ani citlivý obsah dôkazu.

Offline cache:

- je iba cache, nie autoritatívne úložisko,
- nesmie obísť serverové oprávnenia,
- musí rešpektovať logout, TTL a invalidáciu,
- citlivé dáta sa nesmú zapisovať do plaintext logov,
- offline režim sa nesmie označiť ako „overený“ bez overenia integrity synchronizovaného snapshotu.

## 8. Environment a bezpečnostné hranice

Secrets patria iba do lokálneho ignored env súboru, secrets managera, VPS runtime env alebo Supabase Edge secrets. Nesmú byť v README, test outpute, commitoch, browser bundle ani URL query parametroch.

Pre Pandora serverový ForenZX presign sa používajú presné názvy:

```text
FORENZX_MCP_URL
FORENZX_MCP_API_KEY
FORENZX_WEBHOOK_SECRET
FORENZX_S3_REGION
FORENZX_S3_BUCKET
FORENZX_S3_ACCESS_KEY_ID
FORENZX_S3_SECRET_ACCESS_KEY
FORENZX_S3_ENDPOINT
FORENZX_PRESIGNED_EXPIRY_SECONDS
```

Všeobecné `S3_*` premenné môžu slúžiť existujúcemu Vaultu, ale automaticky nenahrádzajú `FORENZX_S3_*` kontrakt. Hosted Supabase Edge Function nesmie používať `localhost` alebo `127.0.0.1` ako URL pre vzdialený MCP Hub.

Testovacie env premenné `FORENZX_REGRESSION_*` patria iba do lokálneho PowerShell procesu alebo ignored lokálneho loadera. Nikdy ich nepridávať do gitu.

## 9. Testovacie brány

Pred zmenou:

```powershell
npm run typecheck
npx vitest run
```

Podľa rozsahu zmeny:

```powershell
npm run test:e2e
npm run verify:web
npm run verify:desktop-security
npm run test:regression:forenzx
```

ForenZX staging regresia je PASS iba vtedy, ak prejde celý tok od `verified evidence` až po `forenzx_analysis_jobs.status=completed` vrátane SSE a findings. Ak chýba deployment, secret, test fixture, enabled pack alebo Supabase prístup, stav je `BLOCKED`, nie „ready“.

Negatívne testy musia overiť minimálne:

- nesprávny webhook secret → `401`,
- neoverený dôkaz → bez jobu,
- nesprávny SHA-256 → `FAILED`,
- nepovolený hostname → odmietnutie,
- duplicitný idempotency key → najviac jeden job.

## 10. Deployment a zodpovednosť

- `main` je zdrojový branch iba po úspešných relevantných kontrolách.
- Východiskový verifikovaný commit je `86597c4cefbb71c6da29d53fe67a93b9f120dd34`.
- Produkčný projekt Supabase je `tlmuvzrgighahnjkxoyw`. Staging a produkcia musia mať oddelené databázy, buckety, secrets, URL a testovacie UUID.
- Produkčný VPS runtime: Porty 80/443 obsluhuje Apache/httpd ako reverzná proxy smerujúca na loopback `:3005`. Dôvera proxy hlavičkám (`x-forwarded-for`, `x-forwarded-proto`, `x-real-ip`) patrí výhradne lokálnemu Apache proxy (`127.0.0.1`). Získavanie klientskej IP adresy (`getTrustedClientIp` v `lib/security/client-ip.ts`) používa overenú hlavičku `x-real-ip` alebo poslednú pridanú hodnotu z `x-forwarded-for`, čím sa bráni podvrhnutiu klientskej identity v auditnom ledgeri a rate limiteri (N-06).
- Bezpečnostné hlavičky a CSP: Next.js vynucuje striktnú `Content-Security-Policy` (`frame-ancestors 'self'`, `object-src 'none'`, `base-uri 'self'`) s reportingom na `/api/csp-report/`. Interné forenzné aplikácie sú vkladané výhradne same-origin v rámci jedného Pandora browser shellu.
- Zálohy a obnova (Disaster Recovery): RPO je stanovené na najviac 15 minút (PostgreSQL PITR), RTO na najviac 4 hodiny. Databázová záloha Supabase neobsahuje S3 Storage objekty — Hetzner S3 Evidence Vault (`hel1.your-objectstorage.com`) je zálohovaný a zrkadlený nezávisle s Object Lock (WORM) ochranou (viď `docs/DISASTER_RECOVERY_RUNBOOK.md`).
- Koordinovaná rotácia kľúčov: Pri podozrení na kompromitáciu secrets sa vykonáva postupná rotácia bez výpadku bežiacich uploadov (S3 kľúče s 15-minútovým prechodným oknom, následne Supabase service role, AI kľúče a webhook tokeny).
- Kontajnerový runtime je zjednotený na **Node.js 22 LTS** (`docker/Dockerfile.production`).
- Build prebieha deterministicky v Linux GitHub Actions, nie na produkčnom VPS. Runtime image sa publikuje do privátneho GHCR a nasadzuje striktne podľa digestu (`sha256:...`).
- Žiadny regresný fixture nesmie používať produkčné dáta.
- Deployment nie je dôkaz funkčnosti; po deploymente sa overia health endpointy, migrácie, MCP kontrakt a príslušný E2E test.
- Rollback musí byť možný bez mazania dôkazov alebo auditnej histórie. Chránený rollback image `pandora-rollback:protected` sa nesmie zmazať pri čistení.
- Monitoring a Alert Watchdog: Pravidelné vyhodnocovanie prevádzkových prahov (`deploy/vps/alert-watchdog.sh`, `scripts/test-alert-dispatch.mjs` a `/api/health/observe`) v zmysle `docs/ALERTING.md`. Alerty pokrývajú zaplnenie disku (80/90 %), 5xx chyby, výpadok DB/S3, zlyhanie verifikácie, AI timeouty > 60 s a chybovosť AI > 10 %.
- Prijatie do pilotnej prevádzky: Formálny audit a udelenie statusu „GO PRE PILOT“ sa zaznamenáva v `docs/PILOT-GO-CHAIN-OF-CUSTODY-PROTOCOL.md` podľa podmienok z `docs/BLUEPRINT-PILOT-RELEASE.md` (časť 5.2).

## 11. Pravidlá pre AI agentov

Pred úpravou:

1. prečítaj tento dokument a `AGENTS.md`,
2. skontroluj `git status`, existujúce zmeny a správny repozitár,
3. nájdi skutočné cesty a existujúce kontrakty; nevymýšľaj `src/routes`, ak projekt používa `app/`,
4. neurčuj stav „hotovo“ bez testového alebo deployment dôkazu,
5. secrets zobrazuj iba ako `SET`, `MISSING` alebo zamaskované,
6. rob minimálnu zmenu na root cause a zachovaj cudzie necommitnuté zmeny.

Po úprave uveď zmenené súbory, spustené testy a presne čo zostalo neoverené.

## 12. Súvisiaca dokumentácia

- [Architektúra](ARCHITECTURE.md)
- [Deployment runbook](DEPLOYMENT.md)
- [Disaster recovery](DISASTER_RECOVERY_RUNBOOK.md)
- [Alerting a operačný runbook](ALERTING.md)
- [Protokol GO pre pilot](PILOT-GO-CHAIN-OF-CUSTODY-PROTOCOL.md)
- [Backlog source of truth](BACKLOG-SOURCE-OF-TRUTH.md)
- [Contributing](../CONTRIBUTING.md)
- [Root agent instructions](../AGENTS.md)

