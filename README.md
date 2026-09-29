# PΛND0RΛ / ForenX

## Forensic Intelligence & Evidence Operating System

> **PΛND0RΛ / ForenX** je hybridná forenzná analytická platforma pre bezpečný zber, uchovanie, overovanie, analýzu a auditovateľné spracovanie digitálnych dôkazov.
>
> Spája forenzný Evidence Vault, PostgreSQL/Supabase databázové jadro, AI asistovanú analýzu, dátové grafy, browser workspace, desktop runtime a vývojárske nástroje do jedného pracovného prostredia.

```text
Browser. Evidence. Intelligence. Audit. AI. One workspace.


## 🔍 REÁLNY STAV PROJEKTU A DIAGNOSTIKA (TRUE STATUS REPORT)

*Aktualizované: 29. september 2026*

### ✅ 1. ČO JE 100% HOTOVÉ A VERIFIKOVANÉ (Production & Staging Ready)

1. **VPS Staging Deployment (`pandora.whoiswho.at`)**:
   - Živý produkčný stack beží na VPS (`66.29.139.59`) v Docker prostredí za Apache reverse proxy s SSL/TLS.
   - **Healthz Endpoint (`/api/healthz`)**: Vraciam `HTTP 200 OK` (`{"ok": true, "service": "pandora-forensic-os"}`).
   - **Web App**: Hlavné rozhranie beží a odovzdáva `HTTP 200 OK` (Next.js 14 SSR/CSR rendering ok).
   - **Bezpečnostné hlavičky**: HSTS (`max-age=15552000`), CSP Report-Only (`/api/csp-report/`), X-Frame-Options (`SAMEORIGIN`), Permissions Policy.

2. **Security & Gitleaks Audit (100% Čistá história)**:
   - Celý Git repozitár (125 commitov, 7.12 MB histórie) bol preskenovaný pomocou Gitleaks.
   - **Výsledok: 0 únikov (0 leaks found).** Všetky nálezy v histórii boli preverené, potvrdené ako lokálne testovacie demo hodnoty/placeholdery a evidované cez presné odtlačky v `.gitleaksignore`.

3. **Forenzné Databázové Jadro (Cleanroom Baseline V1)**:
   - 8 hlavných SQL migrácií + upgrade migrácia pre trvalé sledovanie forenzných workflowov (`forensic_workflow_runs`).
   - **WORM Immutability**: DELETE a UPDATE guard spúšte pre dôkazné položky a auditné záznamy.
   - **RLS Politiky**: Striktné overovanie vlastníctva prípadov (`auth.uid() = user_id AND case_id IN (...)`).

4. **FORENZX MCP Core (Python Backend)**:
   - 139 zo 141 pytest testov prechádza (2 preskočené podľa očakávania na nesymlinkovaných FS).
   - **Ruff linting clean & Mypy type-safe**.
   - **Docker Socket Proxy (`tecnativa/docker-socket-proxy`)**: Izolovaný socket prístup bez priameho mounted socketu v MCP API.
   - **MVT Worker Contract**: Pripravený verziovaný obraz `forenzx-mvt-worker:2.5.0` s pinned SHA-256 digestom.

---

### ⚠️ 2. ČO JE V PROCESE / VYŽADUJE POZORNOSŤ (Práva a netajená realita)

1. **Draftovaný `lib/auth` Refactoring (Nekompletné v pracovnom strome)**:
   - V pracovnom adresári existujú rozpracované (untracked) súbory v `lib/auth/` a `middleware.ts`, ktoré vykazujú TypeScript chyby pri `npx tsc --noEmit` (`getRouteCategory`, `matchPathPattern`, nullability).
   - *Príčina*: Concurrently bežiaca úprava middleware pre izoláciu auth trás zatiaľ nebola dotiahnutá do 100% type-safety.

2. **Vitest UI Test Timeouts (2 testy zo 779)**:
   - Vitest test suite vykazuje **765 PASS** testov v 97 súboroch, no 2 UI testy časovo vypršia (timeout 5000ms): `ForgeStudio.test.tsx` (toggle code view) a `contrast.test.ts` (Tailwind color contrast traversal).

3. **Priame PostgreSQL pripojenie z lokálneho PC**:
   - Produkčný port Postgresu (`54322`) nie je otvorený verejne (čo je z hľadiska bezpečnosti správne). Lokálne ts-skripty pre verifikáciu vyžadujú aktívny SSH tunel (`ssh -L 54322:127.0.0.1:54322 root@66.29.139.59`).

4. **Supabase Cloud vs Local Kong na VPS**:
   - Staging kontajner má v env premenných nastavené `SUPABASE_URL=https://tlmuvzrgighahnjkxoyw.supabase.co` namiesto interného `http://pandora_staging_kong:8000`. Funkcionalita beží cez cloud fallback, no pre 100% offline VPS nezávislosť treba v env zmeniť endpoint.

---

### 🛠️ 3. AKČNÝ PLÁN OPRAV (Roadmap k dokonalosti)

1. **[P0] Dokončiť type-safety v `lib/auth/` a `middleware.ts`**: Opraviť importy a nullability guards tak, aby `npx tsc --noEmit` prebehol bez jedinej chyby.
2. **[P1] Zvýšiť testTimeout pre Vitest UI testy**: Pridať `testTimeout: 10000` v `vitest.config.ts` pre ForgeStudio a Contrast testy.
3. **[P1] Prepnúť SUPABASE_URL v staging env na lokálny Kong**: Upraviť env premennú na VPS na `http://pandora_staging_kong:8000`.

---
```

---

## Základný princíp

```text
AI OUTPUT ≠ EVIDENCE
```

Výstup umelej inteligencie sa v PANDORA / ForenX nikdy automaticky nepovažuje za dôkaz.

Každý forenzný záver, ktorý má byť použitý ako fakt, musí byť spätne naviazateľný na dôveryhodný zdroj:

```text
User
  ↓
Case
  ↓
Evidence / Source Snapshot
  ↓
SHA-256 / Integrity Verification
  ↓
Immutable Ledger
  ↓
AI Analysis
  ↓
Finding
  ↓
Report
```

---

# Obsah

1. [Prehľad platformy](#prehľad-platformy)
2. [Forenzné invarianty](#forenzné-invarianty)
3. [Architektúra](#architektúra)
4. [Evidence Vault](#evidence-vault)
5. [Databázový model](#databázový-model)
6. [Bezpečnostný model](#bezpečnostný-model)
7. [Distributed Rate Limiting](#distributed-rate-limiting)
8. [AI architektúra](#ai-architektúra)
9. [Gemini Quality Gate](#gemini-quality-gate)
10. [Forza Forensic Suite](#forza-forensic-suite)
11. [Browser Workspace](#browser-workspace)
12. [Forge Studio](#forge-studio)
13. [Desktop a mobilný runtime](#desktop-a-mobilný-runtime)
14. [Technologický stack](#technologický-stack)
15. [Štruktúra projektu](#štruktúra-projektu)
16. [Lokálny vývoj](#lokálny-vývoj)
17. [Supabase / PostgreSQL](#supabase--postgresql)
18. [Environment premenné](#environment-premenné)
19. [Testovanie](#testovanie)
20. [Production verification](#production-verification)
21. [Deployment](#deployment)
22. [Bezpečnostné hranice](#bezpečnostné-hranice)
23. [Licencia](#licencia)

---

# Prehľad platformy

PANDORA / ForenX nie je iba browser alebo AI aplikácia.

Platforma pozostáva z viacerých samostatných vrstiev:

### Forensic Core

- správa prípadov,
- evidencia entít,
- finančné transakcie,
- vzťahové grafy,
- udalosti,
- imports,
- externé dátové zdroje,
- analytické findings,
- reporty.

### Evidence Layer

- Evidence Vault,
- S3 object storage,
- SHA-256 integrita,
- immutable evidence metadata,
- source snapshots,
- verification status,
- legal hold,
- audit trail,
- chain of custody.

### Database Layer

- PostgreSQL,
- Supabase,
- Row Level Security,
- databázové RPC,
- atomic operations,
- immutable triggers,
- audit functions.

### AI Layer

- Mistral AI,
- špecializované forenzné prompty,
- structured outputs,
- AI findings,
- source binding,
- Autopilot,
- Gemini independent code review.

### Workspace Layer

- Browser,
- Forza,
- Forge Studio,
- Electron,
- PWA,
- Capacitor.

---

# Forenzné invarianty

PANDORA / ForenX používa niekoľko pravidiel, ktoré sú považované za základnú súčasť architektúry.

## 1. Evidence integrity

Dôkazový objekt musí zachovať minimálne:

- identitu prípadu,
- identitu používateľa / vyšetrovateľa,
- originálny názov súboru,
- veľkosť,
- MIME type,
- storage reference,
- SHA-256 hash,
- timestamp,
- verification status.

---

## 2. Chain of custody

Každá relevantná operácia má byť spätne dohľadateľná.

```text
Actor
→ Action
→ Case
→ Record
→ Timestamp
→ Previous event hash
→ Current event hash
```

Auditná história nesmie byť obyčajný editovateľný log.

---

## 3. AI is not evidence

AI môže:

- sumarizovať,
- klasifikovať,
- navrhovať súvislosti,
- identifikovať potenciálne anomálie,
- vytvárať pracovné hypotézy.

AI však nesmie svoj vlastný výstup povýšiť na dôkaz.

Forenzný finding musí byť naviazaný na reálny:

```text
sourceRef
```

alebo iný overiteľný dôkazový objekt.

---

## 4. Fail closed

Kritické bezpečnostné vrstvy majú pri chybe odmietnuť operáciu.

Príklady:

```text
Rate limit exceeded
→ 429

Rate limiter unavailable
→ 503

Ownership verification unavailable
→ deny

Evidence verification failure
→ evidence remains unverified
```

Production režim nesmie potichu prepnúť na menej bezpečný fallback.

---

# Architektúra

```text
                        ┌───────────────────────┐
                        │        USER           │
                        └──────────┬────────────┘
                                   │
                                   ▼
                        ┌───────────────────────┐
                        │ Auth / User Identity  │
                        └──────────┬────────────┘
                                   │
                                   ▼
                        ┌───────────────────────┐
                        │        CASE           │
                        └──────────┬────────────┘
                                   │
                 ┌─────────────────┼─────────────────┐
                 │                 │                 │
                 ▼                 ▼                 ▼
          ┌─────────────┐   ┌──────────────┐  ┌─────────────┐
          │  Evidence   │   │ Transactions │  │  Entities   │
          └──────┬──────┘   └──────┬───────┘  └──────┬──────┘
                 │                 │                 │
                 ▼                 ▼                 ▼
          ┌──────────────────────────────────────────────┐
          │               PostgreSQL / Supabase          │
          │ RLS · RPC · Audit · WORM · Integrity Guards │
          └──────────────────────┬───────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
           ┌────────────────┐        ┌──────────────────┐
           │ Evidence Vault │        │ Source Snapshots │
           │      S3        │        │ SHA-256 / Meta   │
           └───────┬────────┘        └─────────┬────────┘
                   │                           │
                   └────────────┬──────────────┘
                                │
                                ▼
                     ┌────────────────────┐
                     │   AI Analysis      │
                     │ Mistral / Forza    │
                     └─────────┬──────────┘
                               │
                               ▼
                     ┌────────────────────┐
                     │ Findings / Report  │
                     └────────────────────┘
```

---

# Evidence Vault

Evidence Vault je dôkazová úložná vrstva platformy.

Jeho úlohou je oddeliť:

```text
raw file
```

od:

```text
forensic metadata
```

a zabezpečiť, aby každý evidovaný objekt mal dohľadateľnú integritu.

## Evidence lifecycle

```text
Upload
  ↓
Authentication
  ↓
Case ownership
  ↓
Validation
  ↓
SHA-256
  ↓
S3 object
  ↓
Evidence ledger
  ↓
Audit event
  ↓
Verification
```

---

## `evidence_items`

Hlavný evidence ledger obsahuje napríklad:

```text
id
investigator_id
case_name
file_name
file_size
mime_type
s3_object_key
sha256_hash
legal_hold
created_at
updated_at
hash_verification_status
hash_verified_at
verified_sha256
verified_size
verification_error
```

Evidence vrstva používa databázové ochrany proti neoprávnenej modifikácii.

---

## WORM ochrana

Evidence ledger používa WORM-like ochranu:

```text
Write Once
Read Many
```

Kritické dôkazové polia nesmú byť po zápise ľubovoľne prepisované.

Používané sú databázové guardy a triggery pre:

- insert validation,
- mutation protection,
- delete protection,
- legal hold,
- evidence audit,
- hash verification.

---

# Source Snapshots

Externé dátové zdroje sa môžu ukladať ako immutable snapshoty.

Tabuľka:

```text
source_snapshots
```

obsahuje napríklad:

```text
id
case_id
user_id
source
source_url
http_status
retrieved_at
content_type
parser_version
raw_sha256
byte_size
storage_ref
etag
last_modified
created_at
```

Snapshot reprezentuje stav externého zdroja v konkrétnom čase.

To umožňuje neskôr dokázať:

- aký obsah bol použitý,
- kedy bol získaný,
- akým parserom bol spracovaný,
- aký mal hash,
- či sa externý zdroj medzičasom zmenil.

---

# Databázový model

Produkčné databázové jadro používa:

```text
Supabase
+
PostgreSQL
```

## Case domain

```text
cases
case_entities
case_relations
case_transactions
case_events
case_imports
case_weapons
```

---

## Forensic integrity

```text
evidence_items
source_snapshots
case_audit_log
```

---

## External intelligence

```text
company_registry_profiles
cross_border_analyses
```

---

## AI & observability

```text
ai_usage
ai_feature_logs
error_logs
```

---

## Identity

```text
profiles
user_roles
```

Supabase Auth používa vlastnú:

```text
auth.users
```

schému mimo `public`.

---

## Billing

```text
subscriptions
billing_events
```

---

## GDPR / lifecycle

```text
deletion_requests
```

---

## Infrastructure

```text
rate_limits
```

---

# Databázové bezpečnostné mechanizmy

Databázová vrstva používa kombináciu:

```text
Row Level Security
PostgreSQL functions
RPC
triggers
foreign keys
unique constraints
immutable guards
audit chain
```

Citlivé operácie nemajú byť implementované iba ako:

```text
SELECT
→ JavaScript decision
→ UPDATE
```

ak existuje riziko race condition.

Kritické operácie sú podľa potreby presunuté do atomických databázových operácií.

---

# Bezpečnostný model

## Authentication

Používateľ musí byť autentifikovaný pred vstupom do chránených case/evidence operácií.

---

## Authorization

Autentifikácia sama nestačí.

Každá case-scoped operácia musí riešiť:

```text
user
→ ownership
→ case
→ requested resource
```

---

## IDOR ochrana

Používateľ A nesmie byť schopný pristupovať k:

```text
case používateľa B
evidence používateľa B
source snapshot používateľa B
finding používateľa B
report používateľa B
```

iba zmenou ID v requeste.

---

## Row Level Security

Citlivé Supabase tabuľky používajú RLS.

RLS sa nepovažuje za overenú iba preto, že:

```sql
rowsecurity = true
```

Politiky musia mať správne:

```text
roles
USING
WITH CHECK
```

podmienky.

---

## Service Role boundary

`service_role` je serverový credential.

Nikdy nesmie byť dostupný:

- v browser bundle,
- v `NEXT_PUBLIC_*`,
- v localStorage,
- v URL,
- v klientskom logu.

---

# Distributed Rate Limiting

Production rate limiting nepoužíva process-local pamäť ako bezpečnostnú hranicu.

Nasadenie na serverless runtime znamená, že:

```ts
new Map()
```

nie je distribuovaný rate limiter.

PANDORA používa PostgreSQL-backed atomický fixed-window limiter.

---

## Vlastnosti

Implementácia podporuje:

- shared state,
- atomic increment,
- fixed window,
- expiration reset,
- exact quota,
- non-consuming status check,
- fail-closed backend behavior.

---

## Semantika

Pri limite:

```text
maxRequests = 3
```

je správanie:

```text
request 1 → allowed
request 2 → allowed
request 3 → allowed
request 4 → denied
```

Status operácia quota nespotrebúva.

---

## Fixed window

Počas aktívneho okna sa nemení:

```text
window_start
expires_at
```

Nové okno vzniká až po expirácii starého.

---

## Concurrency verification

Lokálna PostgreSQL integrácia bola overovaná aj súbežne.

Príklad testu:

```text
100 parallel requests
same key
limit = 10
```

Očakávané správanie:

```text
10 allowed
90 denied
```

---

## Failure semantics

```text
LIMIT_EXCEEDED
→ HTTP 429

RATE_LIMITER_UNAVAILABLE
→ HTTP 503
```

Production režim nesmie pri výpadku databázového limitera ticho prepnúť na local `Map`.

---

# AI architektúra

PANDORA používa AI ako analytickú vrstvu, nie ako source of truth.

## Mistral AI

Hlavný aplikačný AI provider môže zabezpečovať:

- klasifikáciu dokumentov,
- extrakciu údajov,
- sumarizáciu,
- forenzné úlohy,
- pracovné hypotézy,
- štruktúrované analýzy.

---

## Structured outputs

AI odpoveď musí byť považovaná za:

```text
untrusted external input
```

kým neprejde:

```text
parse
→ validation
→ schema
→ domain checks
```

Pre štruktúrované AI operácie sa používajú validačné schémy.

---

# Forensic Autopilot

Forensic Autopilot je workflow nad prípadom.

Nie je navrhnutý ako obyčajný chatbot.

Autopilot môže:

- spracovať viac súborov,
- extrahovať text,
- syntetizovať dossier,
- identifikovať entity,
- normalizovať transakcie,
- vytvoriť pracovný súhrn prípadu,
- navrhnúť ďalšie analytické kroky.

AI nesmie obchádzať dôkazové invarianty.

---

# Gemini Quality Gate

Repozitár obsahuje nezávislú AI-assisted review vrstvu.

Jej cieľom je oddeliť:

```text
implementáciu
```

od:

```text
nezávislej kontroly
```

Odporúčaný workflow:

```text
Coding agent / Mistral
        ↓
implements change
        ↓
git working tree
        ↓
gemini skontroluj
        ↓
Gemini Quality Gate
        ↓
runtime / tests
        ↓
human approval
```

---

## Použitie

Z PowerShellu vo vnútri Git repozitára:

```powershell
gemini skontroluj
```

---

## Pipeline

```text
PowerShell wrapper
        ↓
Git repository discovery
        ↓
Working-tree context collector
        ↓
Secret filtering / redaction
        ↓
@google/genai
        ↓
Gemini review
        ↓
Zod validation
        ↓
Structured verdict
```

---

## Verdict

Quality Gate používa tri hlavné výsledky:

```text
SAFE_TO_ACCEPT_LOCALLY
NEEDS_PATCH
REJECT
```

---

## Exit codes

| Code | Význam |
|---:|---|
| `0` | `SAFE_TO_ACCEPT_LOCALLY` |
| `1` | `NEEDS_PATCH` |
| `2` | `REJECT` |
| `3` | `EXECUTOR_ERROR` |

---

## Security boundary

Gemini reviewer:

- nemá shell execution capability,
- nemôže commitovať,
- nemôže pushovať,
- nemôže resetovať Git,
- nemôže meniť databázu,
- nemôže deployovať.

Context collector používa iba povolené read-only Git operácie.

---

## Secret filtering

Pred odoslaním contextu do AI sa vylučujú alebo redaktujú:

```text
.env
.env.*
private keys
certificates
JWT
Authorization headers
API keys
known secret formats
```

Súčasne sa obmedzuje:

- počet súborov,
- veľkosť jedného súboru,
- celkový context size.

---

# Forza Forensic Suite

Forza predstavuje analytickú vrstvu systému.

Obsahuje moduly pre:

- správu prípadov,
- entity,
- transakcie,
- finančné analýzy,
- importy,
- grafy,
- časové osi,
- externé registry,
- AI úlohy,
- reporty.

---

## Prípady

```text
/forza/pripady
```

Správa prípadov a ich pracovného kontextu.

---

## Analýza výpisov

```text
/forza/analyza-vypisov
```

Analýza finančných tokov, účtov a transakcií.

---

## Import

```text
/forza/import-csv
```

Spracovanie dátových importov s evidenciou:

- parser version,
- mapping,
- SHA-256,
- počet validných/chybných riadkov.

---

## Entity intelligence

```text
/forza/osoby
```

Profilovanie entít a organizácií.

---

## Graph

```text
/forza/siet
/forza/vztahy
```

Vzťahová analýza medzi:

```text
entities
accounts
transactions
organizations
events
```

---

## Assistant

```text
/forza/asistent
```

AI-assisted forenzný workspace.

---

## Sandbox

```text
/forza/sandbox
```

Izolovaný priestor pre analytické experimenty a AI tasks.

---

# Browser Workspace

PANDORA obsahuje vlastnú browser vrstvu používanú ako pracovné prostredie.

Podporuje napríklad:

- multi-tab browsing,
- omnibox,
- spaces,
- bookmarks,
- history,
- downloads,
- browser-side tools,
- Electron webview integration.

Browser nie je forenzný source of truth.

Dôkazová integrita žije v Evidence / Database vrstve.

---

# Forge Studio

Forge je vizuálny PWA/UI builder.

Obsahuje:

- Visual Canvas,
- Inspector,
- strom komponentov,
- Monaco editor,
- preview,
- export/build workflow.

Forge je samostatná pracovná vrstva a nesmie meniť bezpečnostné invarianty forenzného jadra.

---

# Desktop a mobilný runtime

## Electron

Desktop shell používa Electron.

Bezpečnostný baseline zahŕňa:

```text
sandbox: true
contextIsolation: true
nodeIntegration: false
webSecurity: true
allowRunningInsecureContent: false
```

---

## Capacitor

Mobilný shell používa Capacitor pre:

```text
Android
iOS
```

---

## PWA

Webová aplikácia podporuje PWA runtime vrátane:

- installability,
- manifestu,
- responsive UI,
- offline fallbackov tam, kde dávajú zmysel.

Forenzné production operácie však nesmú predstierať úspech bez backendovej integrity.

---

# Technologický stack

| Vrstva | Technológie |
|---|---|
| Web / PWA | Next.js 15, React 18, TypeScript |
| UI | Tailwind CSS 4, Radix UI, shadcn/ui |
| Motion | Framer Motion |
| Database | PostgreSQL / Supabase |
| DB Security | RLS, RPC, triggers, constraints |
| Evidence | S3 Vault, SHA-256, WORM guards |
| AI | Mistral AI |
| AI Review | Gemini API / `@google/genai` |
| State | Zustand, TanStack Query |
| Desktop | Electron 39 |
| Mobile | Capacitor 8 |
| Graphs | `@xyflow/react` |
| Documents | PDF, DOCX, XLSX a ďalšie parsery |
| Testing | Vitest, Playwright |
| Runtime verification | PostgreSQL / Supabase integration tests |
| Deployment | Vercel / Node-compatible runtime |

---

# Štruktúra projektu

```text
forenx-pandora-os/
│
├── app/
│   ├── api/
│   │   ├── vault/
│   │   ├── health/
│   │   ├── csp-report/
│   │   └── ...
│   │
│   ├── browser/
│   ├── forge/
│   ├── forza/
│   └── auth/
│
├── components/
│   ├── features/
│   │   ├── browser/
│   │   ├── forge/
│   │   └── forensic/
│   │
│   ├── malte/
│   └── ui/
│
├── electron/
│   ├── main.mts
│   ├── preload.ts
│   └── ...
│
├── integrations/
│   └── supabase/
│       ├── types.ts
│       └── ...
│
├── lib/
│   ├── forza/
│   │   ├── forensic/
│   │   ├── ai/
│   │   └── ...
│   │
│   ├── storage/
│   │   ├── s3-vault.ts
│   │   ├── evidence-ledger.ts
│   │   ├── vault-auth.ts
│   │   └── ...
│   │
│   ├── services/
│   ├── quality-gate/
│   │   ├── gemini-client.ts
│   │   ├── repository-context.ts
│   │   ├── redaction.ts
│   │   ├── quality-gate-schema.ts
│   │   ├── quality-gate-system-prompt.ts
│   │   └── quality-gate-runner.ts
│   │
│   └── __tests__/
│
├── supabase/
│   ├── migrations/
│   ├── tests/
│   ├── verify/
│   └── config.toml
│
├── scripts/
│   ├── deploy/
│   ├── ci/
│   ├── gemini.ps1
│   ├── install-gemini-command.ps1
│   └── gemini-quality-gate.ts
│
├── docs/
│
├── public/
│
├── .env.example
├── next.config.mjs
├── package.json
└── README.md
```

---

# Lokálny vývoj

## Požiadavky

Odporúčané:

```text
Node.js 20+
npm
Docker Desktop
Supabase CLI
PowerShell 7+ na Windows workflow
```

---

## Clone

```bash
git clone https://github.com/youh4ck3dme/forenx-pandora-os.git
cd forenx-pandora-os
npm install
```

---

## Environment

Vytvor:

```bash
cp .env.example .env.local
```

Reálne secrets nikdy necommituj.

---

## Web development

```bash
npm run dev
```

---

## TypeScript

```bash
npm run typecheck
```

alebo:

```bash
npx tsc --noEmit
```

---

## Production build

```bash
npm run build
```

---

# Supabase / PostgreSQL

Lokálny Supabase runtime používa Docker.

## Start

```bash
supabase start
```

---

## Status

```bash
supabase status
```

---

## Rebuild local DB

```bash
supabase db reset
```

Tento príkaz je určený pre lokálnu development databázu.

Nepoužívaj ho proti produkčnému prostrediu.

---

# Migrations

Databázová schéma je verzovaná cez:

```text
supabase/migrations/
```

Migration súbory sú source of truth pre schému.

Nikdy nevytváraj produkčné tabuľky ručne cez dashboard, ak už existuje zodpovedajúca migration.

---

## Migration safety

Pred production pushom vždy:

```bash
supabase migration list
```

a:

```bash
supabase db push --dry-run
```

Až následne:

```bash
supabase db push
```

po explicitnom schválení.

---

# Environment premenné

Kompletný zoznam sa nachádza v:

```text
.env.example
```

Hlavné skupiny:

## Supabase

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_SERVICE_ROLE_KEY` je server-only.

---

## Mistral

```text
MISTRAL_API_KEY
```

---

## Gemini Quality Gate

```text
GEMINI_API_KEY
GEMINI_QUALITY_MODEL
GEMINI_QUALITY_TIMEOUT_MS
GEMINI_QUALITY_MAX_FILES
GEMINI_QUALITY_MAX_FILE_BYTES
GEMINI_QUALITY_MAX_TOTAL_CONTEXT
```

---

## S3 Evidence Vault

Konkrétne názvy používaj podľa `.env.example`.

Typicky ide o:

```text
endpoint
bucket
region
access key
secret key
```

Storage secrets musia byť server-only.

---

# Secret policy

Nikdy:

```text
NEXT_PUBLIC_SERVICE_ROLE_KEY
NEXT_PUBLIC_GEMINI_API_KEY
NEXT_PUBLIC_MISTRAL_SECRET
```

Nikdy nevkladaj secrets do:

- README,
- screenshots,
- query strings,
- Git diffov,
- logov,
- AI promptov,
- browser storage.

---

# BYOK

Browser-side používateľské API credentials nie sú považované za bezpečnostný vault.

Klientské credentials sú citlivý používateľský vstup.

Produkčné systémové credentials musia zostať server-side.

---

# Testovanie

Projekt používa kombináciu:

```text
Vitest
Playwright
PostgreSQL integration verification
Supabase migration verification
Gemini Quality Gate
```

---

## Unit / behavioral tests

```bash
npx vitest run
```

---

## Quality Gate tests

```bash
npx vitest run lib/quality-gate/__tests__/
```

---

## Rate limiter tests

```bash
npx vitest run lib/__tests__/rate-limiter.test.ts
```

---

## E2E

```bash
npm run test:e2e
```

---

# Test evidence levels

Nie každý zelený test poskytuje rovnakú úroveň dôkazu.

Interné review rozlišuje napríklad:

```text
REAL_INTEGRATION
BEHAVIORAL
CONTRACT
MOCK_ONLY
STRUCTURAL
WEAK
```

Mock test nie je dôkaz reálneho PostgreSQL runtime správania.

---

# Gemini Quality Gate installation

Na Windows:

```powershell
.\scripts\install-gemini-command.ps1
```

Potom reload profilu:

```powershell
. $PROFILE
```

A následne:

```powershell
gemini skontroluj
```

---

# Production verification

Pred označením release za pripravený musí byť oddelené:

```text
CODE VERIFIED
LOCAL RUNTIME VERIFIED
HOSTED DATABASE VERIFIED
PRODUCTION RUNTIME VERIFIED
```

Jedna zelená vrstva automaticky neznamená, že ostatné sú zelené.

---

## Odporúčaný release flow

```text
Implementation
    ↓
Typecheck
    ↓
Unit / behavioral tests
    ↓
Gemini Quality Gate
    ↓
Local PostgreSQL verification
    ↓
Migration preflight
    ↓
Hosted database verification
    ↓
Production build
    ↓
Runtime smoke test
    ↓
Release
```

---

# Database acceptance

Forenzná databáza má obsahovať minimálne core objekty:

```text
cases
case_entities
case_relations
case_transactions
case_events
case_imports
case_weapons

evidence_items
source_snapshots
case_audit_log

company_registry_profiles
cross_border_analyses

ai_usage
ai_feature_logs
error_logs

profiles
user_roles

subscriptions
billing_events
deletion_requests

rate_limits
```

---

# Evidence acceptance

Pred production použitím Evidence Vaultu treba overiť:

```text
[ ] evidence_items exists
[ ] source_snapshots exists
[ ] RLS enabled
[ ] ownership policies verified
[ ] WORM trigger enabled
[ ] insert guard enabled
[ ] delete guard enabled
[ ] audit trigger enabled
[ ] source snapshots immutable
[ ] SHA-256 verification operational
[ ] S3 object reference valid
[ ] legal hold enforced
```

---

# Rate limiter acceptance

```text
[ ] shared storage
[ ] atomic consume
[ ] fixed window
[ ] exact limit
[ ] non-consuming status
[ ] expiration reset
[ ] 429 on quota exceeded
[ ] 503 on backend unavailable
[ ] no production process-local fallback
[ ] concurrency verified
```

---

# Security acceptance

```text
[ ] auth required
[ ] ownership enforced
[ ] RLS verified
[ ] IDOR tests
[ ] service role server-only
[ ] secrets excluded from Git
[ ] CSP reviewed
[ ] no production dev bypass
[ ] evidence mutation blocked
[ ] audit append-only
```

---

# Deployment

PANDORA / ForenX môže byť nasadená ako:

```text
Web / PWA
Electron desktop
Capacitor mobile
```

Backendové production funkcie vyžadujú správne nakonfigurované:

```text
Supabase
PostgreSQL
S3
AI providers
security environment
```

---

## Vercel

Pred deployom vždy vykonaj:

```bash
npm run typecheck
npm run build
```

plus príslušný production verification workflow.

---

# Serverless safety

Serverless runtime nesmie používať process memory ako source of truth pre:

- rate limits,
- forensic evidence,
- audit ledger,
- case ownership,
- production locks.

Process-local cache môže byť použitý iba tam, kde strata alebo divergencia nemá bezpečnostný alebo dôkazový dopad.

---

# Browser security

Browser nikdy nesmie byť považovaný za dôveryhodné miesto pre:

- service role keys,
- S3 secrets,
- server AI credentials,
- production database credentials.

Klient je vždy považovaný za potenciálne kompromitovateľný.

---

# Electron security

Desktop shell má zachovať:

```text
sandbox
contextIsolation
nodeIntegration=false
webSecurity
secure IPC boundaries
SSRF protection
```

IPC payloady sa považujú za nedôveryhodný vstup.

---

# External sources

Dáta získané z:

- obchodných registrov,
- externých API,
- webových zdrojov,
- CSV,
- dokumentov,

nemajú byť automaticky považované za pravdivé.

PANDORA môže uchovať ich snapshot a hash, ale pravdivosť obsahu je samostatná otázka.

---

# Known trust boundaries

```text
UNTRUSTED:
browser input
uploaded documents
AI output
external APIs
remote websites
client headers
user-provided identifiers

TRUSTED ONLY AFTER VERIFICATION:
authenticated identity
case ownership
database policy result
verified evidence hash
immutable ledger event
server-side generated metadata
```

---

# Development philosophy

Projekt používa jednoduchú zásadu:

```text
Code is not proof.
Tests are not production.
AI is not evidence.
Documentation is not implementation.
```

Source of truth priority:

```text
1. Runtime behavior
2. Current code
3. Database schema / migrations
4. Git state
5. Tests
6. Documentation
```

---

# AI development workflow

Odporúčaný workflow pri AI-assisted development:

```text
Mistral / coding agent
        ↓
implementácia
        ↓
Gemini Quality Gate
        ↓
runtime verification
        ↓
human review
        ↓
Git
```

Žiadny AI agent nemá byť jediným zdrojom schválenia vlastnej implementácie.

---

# Repository rules

Pred veľkou zmenou:

```bash
git status
```

Po implementácii:

```bash
npm run typecheck
npx vitest run
npm run build
```

A následne:

```powershell
gemini skontroluj
```

---

# Production database rules

Nikdy:

```text
blind db push
manual production CREATE TABLE
manual DROP TABLE
migration history manipulation without proof
```

Pred každou produkčnou migráciou musí byť známe:

```text
local migration state
remote migration state
dry-run plan
affected objects
rollback/recovery strategy
```

---

# Forensic review

Projekt môže byť periodicky podrobený kompletnému forenznému technickému auditu:

```text
Authentication
Security
Evidence integrity
Data flow
Database
Dependencies
Runtime
Scalability
Code quality
```

Nálezy sa majú opierať o konkrétny:

```text
file
symbol
line
runtime proof
SQL object
```

nie iba o všeobecný odhad.

---

# Status model

Odporúčané statusy pre komponenty:

```text
UNVERIFIED
LOCAL VERIFIED
HOSTED VERIFIED
PRODUCTION VERIFIED
BLOCKED
```

`LOCAL VERIFIED` sa nesmie prezentovať ako `PRODUCTION VERIFIED`.

---

# Core identity

PANDORA / ForenX dnes stojí na štyroch základných pilieroch:

```text
EVIDENCE
INTEGRITY
INTELLIGENCE
AUDITABILITY
```

Browser, AI, graph, Forge a desktop shell sú pracovné nástroje okolo tohto jadra.

---

# License

WTFPL — Do What The Fuck You Want To Public License.

---

# PΛND0RΛ / ForenX

```text
Verify first.
Analyze second.
Trust nothing implicitly.
```
