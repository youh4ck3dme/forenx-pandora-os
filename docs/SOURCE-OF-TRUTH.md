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

Kanonický webhook header je `x-forenzx-webhook-secret`. Edge Function musí overiť secret, evidence status, idempotency key a serverové údaje. Presigned download musí používať iba povolený hostname; HTTP, localhost, private IP, neoverené redirecty a nepovolené hosty sú odmietnuté.

MCP kontrakt musí obsahovať nástroj `forenzx_analysis_start` s `download_url` a `download_filename`. Hash mismatch alebo bezpečnostné odmietnutie nesmie skončiť ako úspešný job.

## 7. UI, PWA a mobile pravidlá

Mobile/PWA je klient rovnakého forenzného systému, nie samostatná databáza.

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

Vitest beží v troch projektoch: `main` (jsdom, paralelný), `cleanroom` (node, PGlite/Docker PostgreSQL, serializovane `maxWorkers=1`) a `supabase-db` (node, PGlite, serializovane `maxWorkers=1`). Ťažké PGlite sady sa nesmú spúšťať paralelne v jednom workri s jsdom sadami — worker zomiera na OOM. `next build` vyžaduje `NODE_OPTIONS=--max-old-space-size=4096` (zabudované v `npm run build`).

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
- Staging a produkcia musia mať oddelené databázy, buckety, secrets, URL a testovacie UUID.
- Žiadny regresný fixture nesmie používať produkčné dáta.
- Deployment nie je dôkaz funkčnosti; po deploymente sa overia health endpointy, migrácie, MCP kontrakt a príslušný E2E test.
- Rollback musí byť možný bez mazania dôkazov alebo auditnej histórie.

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
- [Backlog source of truth](BACKLOG-SOURCE-OF-TRUTH.md)
- [Contributing](../CONTRIBUTING.md)
- [Root agent instructions](../AGENTS.md)
