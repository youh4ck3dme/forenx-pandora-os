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

- **Electron runtime izolácia session a webových tabov**: Webové taby bežia výhradne v izolovanej perzistentnej partícii persist:pandora-web-tabs (getWebTabsSession() v electron/browser-view-factory.ts). Proxy (proxy:set), adblocker / shield štatistiky, mazanie dát (session:clear-data), download listener (will-download) a správa rozšírení sú viazané na túto partíciu, čím zostáva session.defaultSession (hlavný shell aplikácie) nedotknutá. Navigácia tabov (cez IPC aj will-navigate) striktne povoľuje iba http: a https: protokoly; nepovolené protokoly (file:, javascript:, data:, chrome:, about:) sa odmietajú pred volaním loadURL.

- **Second Brain at-rest šifrovanie a IPC sender gate**: `userData/history-index.json` nesmie ukladať plaintext page body (`content`). `HistoryManager` (`electron/history-manager.ts`) šifruje zachytený obsah stránky pomocou `safeStorage.encryptString` a ukladá ho ako base64 `encryptedContent`. Ak `safeStorage.isEncryptionAvailable()` nie je k dispozícii, nový text stránky sa na disk nezapisuje (fail-closed); už uložený nepriehľadný ciphertext sa však v pamäti bezpečne zachová a pri ďalšom zápise sa prenesie bez zmeny, ak sa obsah nepodarilo dešifrovať. Volajúci dovtedy dostávajú prázdny obsah. Starý plaintext index sa pri prvom načítaní okamžite premigruje (zašifruje alebo očistí od plaintextu) a prepíše na disku. Kanály `history:search` a `history:getContent` sú prísne viazané na `isMainWindowSender(event)` (`mainWindow.webContents`), čím sa zabraňuje crosstalku a úniku histórie z BrowserView alebo cudzích rámcov.

- **Electron Password Manager IPC sender gates**: Správa hesiel (`electron/password-manager.ts`) beží výhradne v main procese; renderer pristupuje k nej iba cez overené IPC kanály. Všetky kanály vyžadujú `isMainWindowSender(event)` (overenie `event.sender.id === mainWindow.webContents.id`). Pri volaní z nepovoleného odosielateľa (BrowserView, cudzie iframe/framy) systém vracia fail-closed odpoveď: `password:*` a `extension:load` vracajú `{ ok: false, code: 'FORBIDDEN' }`, zatiaľ čo `session:clear-data`, `history:*` a dialógy vracajú `false`, prázdne pole alebo `null`. Kanonické kontrakty kanálov:
  - `password:get` → vracia iba maskované metadáta (`id`, `url`, `username`, `updatedAt`) cez `listMasked()`; žiadny bulk plaintext ani šifrované heslá.
  - `password:reveal` → sprístupňuje dešifrovaný plaintext jediného záznamu podľa validovaného `id` s dĺžkou 1–`MAX_PASSWORD_ID_LENGTH` (4 440 znakov; horná hranica base64 kódovania `url:username` pri `url≤2048`, `username≤320` v UTF-8, pričom pre ASCII je minimum 3 160 znakov); vracia `{ ok: true, entry }` s dešifrovaným heslom alebo chybový objekt `{ ok: false, code }` s hodnotou `FORBIDDEN`, `VALIDATION_ERROR` alebo `NOT_FOUND`. Nikdy nevracia batch hesiel.
  - `password:save` → uloží jedno heslo zašifrované cez `safeStorage.encryptString`; ID je deterministicky generované ako `base64(url + ":" + username)`. Chránené cez `isMainWindowSender`.
  - `password:delete` → zmaže záznam podľa `id`; limit dĺžky ohraničený zdieľanou konštantou `MAX_PASSWORD_ID_LENGTH`. Chránené cez `isMainWindowSender`.
  - Zdieľaná konštanta `MAX_PASSWORD_ID_LENGTH = 4440` (alias `MAX_PASSWORD_RECORD_ID_LENGTH`) je definovaná v `electron/ipc-contract.ts` a priamo importovaná a synchronizovaná v `electron/preload.ts` (`invokeSchemas`), `electron/main.mts` aj `electron/password-manager.ts`.
  - Rovnaký `isMainWindowSender` gate chráni aj ostatné citlivé operácie: `session:clear-data`, `history:search`, `history:getContent`, `extension:load`, `capture:page`, `dialog:openFile`, `dialog:saveFile`.

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

- **Klientske ukladanie vs. Serverový middleware:** Supabase JS ukladá reláciu na klientovi do `localStorage`. Next.js Middleware (`middleware.ts`) overuje reláciu server-side cez HTTP cookies (`sb-access-token`, `sb-refresh-token`) a `Authorization: Bearer <token>` header.
- **Synchronizácia do cookies (`lib/auth/cookies.ts`):** Po úspešnom `signInWithPassword`, `signUp` alebo `TOKEN_REFRESHED` klient volá `syncAuthCookies(session)`, ktorý posiela token na `POST /api/auth/session`. Server overí token cez Supabase a vydá HttpOnly cookies (`sb-access-token`, `sb-refresh-token`). Tokeny sa **nikdy nepíšu priamo cez `document.cookie`** — vždy prechádzajú cez server-side bridge (`app/api/auth/session/route.ts`).
- **Globálny cookie sync (`components/core/providers/auth-cookie-sync.tsx`):** V pozadí počúva na `onAuthStateChange` (`SIGNED_IN`, `TOKEN_REFRESHED`, `INITIAL_SESSION`) a volá `syncAuthCookies(session)`. Pri `SIGNED_OUT` volá `DELETE /api/auth/session`.
- **Čistenie relácie:** Pri odhlásení cez `signOutEverywhere` / `clearClientState` sa cookies zneplatnia (`Max-Age=0`).
- **Presmerovanie po prihlásení:** Pri neautentifikovanom prístupe k chráneným trasám middleware presmeruje priamo na `/auth/login?next=<sanitized_path>`, pričom cieľová cesta musí prejsť validáciou open-redirect ochrany (`lib/auth/redirect.ts`).

### 3.2 Auth — stav pred zjednotením (2026-10-03)

Zmapovaný a overený stav existujúcej autentifikačnej infraštruktúry pred konsolidáciou (každý súbor overený čítaním z disku):

- **9 auth brán v repozitári, reálne strážia len 3:**
  1. `middleware.ts` — kanonická brána na hrane (Edge). Kontroluje cookies (`sb-access-token`, `sb-*-auth-token`) alebo explicitný `Authorization: Bearer <token>` s prednosťou. Neautentifikované stránky presmeruje na `/auth/login`, API routes vracajú HTTP `401`. Anonymný vstup na `/` presmeruje na `/auth/login/?next=%2Fbrowser%2F`, prihlásený vstup na `/` presmeruje na `/browser/`. Trasy `/forza/*` sú označené kategóriou `PROJECT_REQUIRED`, no v middleware prepustia každého prihláseného bez kontroly prípadu.
  2. `integrations/supabase/auth-middleware.ts` (`requireSupabaseAuth`) — serverový middleware pre TanStack server funkcie v `lib/forza/*.functions.ts`. Striktne vyžaduje `Authorization: Bearer <token>`, HTTP cookies ignoruje.
  3. `lib/storage/vault-auth.ts` (`authenticateVaultRequest`) — autorizačná brána pre `app/api/vault/*`, `app/api/forenzx/start`, `app/api/forenzx/jobs/[jobId]/events` a `app/api/health/observe`. Overuje Bearer token vyšetrovateľa a vlastníctvo spisu.
- **Mŕtve, rozbité a neodpojené auth mechanizmy:**
  4. `lib/auth/page-guards.ts` — mŕtvy modul (`requirePageAuth`, `getPageSession`), žiadny komponent ani route v projekte ho neimportuje.
  5. `lib/auth/server.ts` — `requireAuth` hádže `throw new NextResponse(...)` namiesto návratu (v Next.js runtime spôsobuje 500 chybu). Pomocné funkcie `withAuth` a `requireAuthentication` nie sú volané žiadnou živou route.
  6. `lib/forza/session-guard.ts` — nepoužitý súbor, jediné volanie bolo chybne importované v `session.ts`, obsahuje oneskorený redirect (150ms) na starú cestu `/auth`.
  7. `routes/_authenticated/sandbox.tsx` — opustený TanStack Router súbor s vlastnou auth logikou, ktorý Next.js App Router vôbec nemountuje (živý sandbox je `app/forza/sandbox/page.tsx`).
  8. `app/auth/register/page.tsx` — falošná registrácia simulujúca WebAuthn a ukladajúca JSON objekt do `localStorage.setItem("pandora_user", ...)`, nevytvára žiadneho Supabase používateľa.
  9. `app/forza/profil/page.tsx` — duplicitne embeduje `AccountSignInForm`, čím profil slúži ako druhá login obrazovka, ak stav používateľa nie je načítaný.
- **Cookie most:**
  - `app/api/auth/session/route.ts` (POST/DELETE s overením pôvodu `validateOrigin` a IP rate limiterom) + `components/core/providers/auth-cookie-sync.tsx` počúvajúci na `onAuthStateChange`.
- **Zistené chyby v importoch a runtime (Bugs):**
  - `components/malte/AccountSignInForm.tsx` importuje `adoptCloudSession` z `@/lib/session`, súbor na danej ceste neexistuje (reálny je `lib/forza/session.ts`), čo pri build/bundler rozlíšení zlyhá.
  - Sign-out a session súbory importujú `@/lib/dev-auth`, `@/lib/session-guard`, `@/lib/session-expired`, `@/lib/idb` — súbory na koreňovom `@/lib/` neexistujú, reálne ležia v `lib/forza/`.
  - Tri rôzne a protichodné ciele po logine/odhlásení: middleware smeruje prihláseného z `/` na `/browser/`, prihlasovací formulár `AccountSignInForm` a `LoginPage` predvolene posielajú na `/forza/pripady`, a odhlásenie `POST_SIGN_OUT_ROUTE` v `session.ts` posiela na `/`, čo middleware ako anonymného okamžite vráti na `/auth/login/?next=%2Fbrowser%2F` v slučke.
- **Nekonzistencia trailingSlash a cookie flagov:**
  - `next.config.mjs` má nastavené `trailingSlash: true`, takže `/auth/login/` je v middleware povolené len vďaka prefixovej podmienke `startsWith('/auth/')`, pretože `matchPathPattern('/auth/login/', '/auth/login')` vracia `false`.
  - Cookie token refresh v `middleware.ts` zapisuje `sb-access-token` bez flagu `httpOnly: true`, zatiaľ čo `app/api/auth/session/route.ts` ho dôsledne zapisuje s `httpOnly: true`.
- **Tri nejednotné dev bypassy:**
  - `ALLOW_DEV_AUTH_BYPASS` kontrolovaný v `middleware.ts` a `integrations/supabase/auth-middleware.ts`.
  - `PANDORA_DEV_AUTH_BYPASS` v `lib/storage/vault-auth.ts`, `lib/auth/page-guards.ts`, `lib/auth/server.ts`.
  - `isDevFreeEntryActive()` v `lib/forza/dev-auth.ts`, ktorý je defaultne zapnutý pre akéhokoľvek klienta na localhost/LAN (`return val !== "false"`).
- **PROJECT_REQUIRED a ROLE_REQUIRED:**
  - V `middleware.ts` vetvy `category === 'PROJECT_REQUIRED'` a `category === 'ROLE_REQUIRED'` iba vracajú `next()`, nekontrolujú členstvo v spise ani používateľskú rolu.

### 3.3 Auth — po zjednotení (2026-10-03)

Výsledný stav po kompletnej konsolidácii a odstránení duplicitných mechanizmov:

- **Jediná brána:**
  - **Edge Middleware:** `middleware.ts` v kombinácii s `lib/auth/route-policy.ts` tvorí jedinú autoritatívnu bránu pre stránky a API endpointy. Všetky neautentifikované požiadavky na chránené stránky smerujú na `/auth/login/`, API vracajú striktných `401 Unauthorized`.
  - **Jediná login obrazovka:** `app/auth/login/page.tsx` s komponentom `components/malte/AccountSignInForm.tsx`. Podporuje výhradne Supabase password autentifikáciu s prepínaním medzi prihlásením a registráciou (`mode=signup`). Passkey tab zostáva trvalo deaktivovaný (hard-disabled). Cesty `app/auth/page.tsx` a `app/auth/register/page.tsx` slúžia výhradne ako čisté HTTP/Next.js presmerovania na `/auth/login/`.
  - **Jediný cookie most:** `POST /api/auth/session` a `DELETE /api/auth/session` v synchronizácii s klientskym `auth-cookie-sync.tsx` a `lib/forza/session.ts`.
- **Serverové kontroly, ktoré ostali:**
  - `requireSupabaseAuth` (`integrations/supabase/auth-middleware.ts`): Overuje Bearer token pre volania serverových funkcií (`lib/forza/*.functions.ts`). Pri neplatnom tokene vracia fail-closed chybu (401). Netvorí žiadnu druhú login stránku ani formulár.
  - `authenticateVaultRequest` (`lib/storage/vault-auth.ts`): Overuje Bearer token vyšetrovateľa a vlastníctvo spisu pre citlivé endpointy (`/api/vault/*`, ForenZX joby, `/api/health/observe`). Pri zlyhaní vracia striktný HTTP `401` alebo `403`, nikdy nerobí klientske presmerovanie na login.
- **Zmazané súbory a dôvod:**
  - `lib/auth/page-guards.ts` — mŕtvy modul bez volaní.
  - `lib/auth/server.ts` — rozbitý modul (`throw new NextResponse`), nepoužívaný žiadnou živou route.
  - `lib/forza/session-guard.ts` — opustený kód s nežiaducim oneskoreným redirectom; nahradený čistým odhlásením v `lib/forza/session.ts`.
  - `routes/_authenticated/sandbox.tsx` (a priečinok `routes/_authenticated/`) — nepoužívaný súbor TanStack Routera mimo Next.js stromu (živý sandbox je `app/forza/sandbox/page.tsx`).
  - `components/malte/__tests__/sandbox-regression.test.tsx` — osirotený test naviazaný výlučne na zmazaný `routes/_authenticated/sandbox.tsx`.
  - Odstránený duplicitný `AccountSignInForm` z `app/forza/profil/page.tsx` (profil používateľa už neslúži ako login formulár).
  - Odstránená falošná registrácia s WebAuthn a `localStorage` z `app/auth/register/page.tsx`.
- **Jediný dev bypass a jeho podmienky:**
  - Zjednotené výhradne na premennú `ALLOW_DEV_AUTH_BYPASS === "true"`.
  - Úplne zmazaný nepoužívaný bypass `PANDORA_DEV_AUTH_BYPASS`.
  - Funkcia `isDevFreeEntryActive()` v `lib/forza/dev-auth.ts` je upravená na striktný opt-in (`val === "true"`, predvolene `false`).
  - Podmienky bypassu: povolený len v development prostredí (`NODE_ENV === "development"`), výhradne na lokálnom loopbacku (`127.0.0.1`, `::1`, `localhost`). Nikdy nefunguje na Verceli, produkcii ani na verejných IP adresách.
- **Post-login a sign-out cieľ:**
  - Predvolený cieľ po úspešnom prihlásení: `/browser/` (jednotne nastavený v `middleware.ts`, `AccountSignInForm.tsx`, `app/auth/login/page.tsx` a `lib/auth/redirect.ts`).
  - Prihlásenie a registrácia: vykonáva presne jeden volací request na session bridge (`await setAuthCookies(data.session)`). Ak server vráti `false`, klient ostáva na formulári, zobrazí chybu a nespustí presmerovanie.
  - Cieľ po odhlásení: `/auth/login/` (v `lib/forza/session.ts` `POST_SIGN_OUT_ROUTE` a v profile). Tým je odstránená nekonečná slučka cez koreňovú trasu `/`.
  - Odhlásenie: `signOutEverywhere` v `lib/forza/session.ts` čaká (`await`) na zmazanie serverových cookies cez `DELETE /api/auth/session`. Ak vyčistenie cookie zlyhá, odhlásenie skončí chybou a úspech sa nevyhlási.
- **Klientska IP a ochrana pred spoofingom (`client-ip.ts`):**
  - Vyberá výhradne posledný hop z hlavičky `x-forwarded-for` (doplnený Apache reverznou proxy). Ak je posledný hop neplatný, okamžite vracia bezpečný fallback (`127.0.0.1`) — skoršie hopy sa nepoužijú.
- **Cookie flagy:**
  - Cookies `sb-access-token` a `sb-refresh-token` sú zapisované konzistentne s flagmi:
    - `httpOnly: true` (rovnako v `app/api/auth/session/route.ts` aj pri refreshi v `middleware.ts`),
    - `sameSite: 'lax'`,
    - `path: '/'`,
    - `secure: process.env.NODE_ENV === 'production'`.
  - Session token sa nikdy nezapisuje do cookie čitateľnej klientskym JavaScriptom.
- **PROJECT_REQUIRED a ROLE_REQUIRED po zmene:**
  - Z `middleware.ts` a `lib/auth/index.ts` boli odstránené fiktívne vetvy, ktoré predstierali kontrolu spisu alebo roly na hrane aplikácie bez prístupu k dátovému kontextu.
  - Všetky trasy `/forza` a `/forza/*` (vrátane `/forza/stav`) sú v `middleware.ts` a `route-policy.ts` klasifikované ako `AUTHENTICATED` (vyžadujú overenú session).
  - Skutočná autorizácia k prípadom (case membership) a rolám je plne delegovaná do vrstiev s dátovým kontextom: PostgreSQL Row Level Security (RLS) v Supabase a `verifyCaseOwnership` vo `vault-auth.ts`.


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

#### Browser ForenZX spúšťanie (`/api/forenzx/start`)

- **Klientsky kontrakt:** Browser posiela výhradne `evidenceId`, `packId` a `inputType`.
- **Integritný ledger:** `caseId`, `s3ObjectKey`, `sha256` a `fileSize` sa načítavajú výhradne zo serverového ledgera `evidence_items` podľa `evidenceId` a prihláseného vyšetrovateľa (`investigator_id`). Prípadné klientske hodnoty `s3ObjectKey` alebo `sha256` sú striktne ignorované a do presignu a ForenZX nástroja putujú len dáta z DB riadku.
- **Fail-closed overenie:** Dôkaz musí mať `hash_verification_status = 'verified'`. Akýkoľvek iný stav vracia HTTP `403`. Chýbajúci alebo cudzí dôkaz vracia HTTP `404`.
- **Kanonický stĺpec `case_id` a relačná integrita:** Tabuľka `evidence_items` obsahuje primárnu relačnú väzbu `case_id UUID REFERENCES public.cases(id) ON DELETE RESTRICT` indexovanú cez `idx_evidence_items_case` (migrácia `20261003100000_evidence_items_case_id.sql` v plnom súlade s cleanroom schémou). Stĺpec `case_id` je chránený triggerom `evidence_items_worm_guard` ako nemenná identita (WORM write-once). Každý nový dôkaz v `lib/storage/evidence-ledger.ts` povinne ukladá `case_id`, audity v `case_audit_log` nesú priradený `case_id` a ForenZX start route (`/api/forenzx/start`) overuje platné UUID priamo z typovaného DB riadku. Stĺpec je **nullable**: staré riadky, ktorých prípad v `public.cases` neexistoval v čase backfillu, zostávajú `NULL`; `listLedgerEvidence` preferuje filter `.eq("case_id", caseId)`, LIKE na `s3_object_key` je dokumentovaný fallback len pre `NULL` riadky. Vlastníctvo `case_id` je vynútené INSERT guardom (migrácia `20261003110000_evidence_case_id_ownership.sql`): `case_id` musí patriť prihlásenému vyšetrovateľovi (`cases.user_id = auth.uid()`); cudzí `case_id` je odmietnutý aj keď FK existuje. Live migrácia aj cleanroom baseline (forward migrácia `db/cleanroom/009_evidence_case_id_ownership.sql`, `evidence_items_insert_guard`) vynucujú ten istý ownership invariant: nenulový `case_id` od netrusted roly musí mať `cases.user_id = request.jwt.claim.sub`, `NULL` je povolený a `service_role`/`postgres`/`supabase_admin` sú vynechané. Cleanroom forward migrácia `db/cleanroom/010_evidence_worm_case_id.sql` rozširuje `evidence_items_worm_guard` o `NEW.case_id IS DISTINCT FROM OLD.case_id` — zmena `case_id` po inserte vyvolá `42501` (WORM violation), rovnako ako ostatné identity stĺpce.

### 6.1 Sprísnené AI schémy, oprava JSON, CSV a Export Manifest (Blueprint P4)

- **Striktná typizácia schémy (`lib/forza/forensic-dossier.schema.ts`):** Všetky sub-schémy (`timeline`, `traces`, `attacks`, `evidence`, `paragraphs`, `analysisMeta`) sú prísne typované Zod schémami namiesto voľných `z.record(z.unknown())`. Neznáme alebo malformované štruktúry zlyhajú na validačnej bráne.
- **Detekcia opraveného JSON (`wasRepaired`):** `parseForensicDossier` vracia `{ data, wasRepaired }`. Ak musel byť modelový JSON opravený (napr. doplnenie uzatváracích zátvoriek pre odseknutý výstup), výsledný chunk je transparentne označený ako `status: "repaired"` namiesto predstierania bezchybného pôvodného výstupu.
- **Deduplikácia bankových CSV importov (`lib/forza/import.functions.ts`):** `commitImport` validátor pred zápisom overuje prítomnosť duplicitných riadkov s identickou päticou `(date, amount, currency, from_id, to_id)` a zlyhá fail-closed s jasným zoznamom duplicitných riadkov (`DUPLICATE_IMPORT_ROWS`), aby sa predišlo viacnásobnému započítaniu transakcií.
- **Nezávislý export manifestu (`lib/forza/export-pdf.ts`):** Vyšetrovateľ si môže stiahnuť auditný balík reportu ako samostatný JSON (`downloadManifestJson`), ktorý obsahuje SHA-256 hash manifestu a stav všetkých overených dôkazov.
- **Forenzný disclaimer manifestu:** Hash manifestu je kryptografický dôkaz integrity samotného exportu, nie potvrdenie pravdivosti alebo súdnej prípustnosti hypotéz (`AI OUTPUT ≠ EVIDENCE`).

Kanonický webhook header je `x-forenzx-webhook-secret`. Edge Function musí overiť secret, evidence status, idempotency key a serverové údaje. Presigned download musí používať iba povolený hostname; HTTP, localhost, private IP, neoverené redirecty a nepovolené hosty sú odmietnuté.

**ForenZX webhook a presign-for-hub nesmú nikdy akceptovať `downloadUrl` (ani `download_url`) od volajúceho.** Download URL sa výhradne skladá na serveri z overeného ledger riadku `evidence_items` (s3_object_key, hash_verification_status = verified). Cudzia, nepovolená alebo neoverená URL je odmietnutá s HTTP 400/403. Validátor `isValidDownloadUrl` (`lib/forza/forenzx-download-guard.ts`) odmieta HTTP, localhost, private IP rozsahy (RFC 1918/3927/4193), embedded credentials a hosty mimo allowlistu.

MCP kontrakt musí obsahovať nástroj `forenzx_analysis_start` s `download_url` a `download_filename`. Hash mismatch alebo bezpečnostné odmietnutie nesmie skončiť ako úspešný job.

## 7. UI, PWA a mobile pravidlá

Mobile/PWA je klient rovnakého forenzného systému, nie samostatná databáza.

Všetky stránky pod `/forza` (vrátane `/forza/stav`) vyžadujú autentifikáciu
a príslušný prístup k prípadu. Pre verejný bezstavový monitoring slúži výhradne
endpoint `/api/health/public`. Administrátorská health funkcia a citlivé systémové
dáta zostávajú chránené serverovým oprávnením.

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

