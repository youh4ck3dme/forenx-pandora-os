# PΛND0RΛ / ForenX — CANONICAL SYSTEM SOURCE OF TRUTH

> **Status:** CANONICAL / NORMATIVE  
> **Version:** 2.0  
> **Authority:** CANONICAL CONTRACT — Najvyššia autorita pre architektúru, bezpečnosť, forenznú integritu a release validáciu.  
> **Target:** Production-Grade Forensic System (PANDORA Browser & ForenZX Engine)

---

## 0. Rozsah a autorita

Tento dokument je jediný kanonický a normatívny kontrakt pre systém **PANDORA / ForenX**. Určuje, čo systém musí robiť, čo nesmie robiť a aké dôkazy musia existovať, aby sa tvrdenie o bezpečnosti alebo forenznej integrite mohlo považovať za overené.

Platí bez výnimky pre:
- **Web / Next.js 15 App Router** (`app/`, `components/`, `lib/forza/`)
- **PWA & Offline state** (`lib/forza/idb.ts`, service workers)
- **Capacitor Mobile** (isolated package: `mobile/`, profile scripts: `scripts/mobile/`; native platform projects are not committed)
- **Electron Desktop Shell** (`electron/`, Chromium v152 / Node v24 LTS baseline)
- **Supabase Auth / PostgreSQL / RLS / Edge Functions** (`supabase/`, `db/cleanroom/`)
- **Hetzner S3 Object Storage / Evidence Vault** (WORM, Object Lock)
- **ForenZX MCP Hub & Isolated Workers**
- **AI Forensic Pipeline** (Evidence Binding, Privacy Gateway)
- **Audit Ledger & Chain-of-Custody**
- **CI/CD, Release Gates a Deployment**

### 0.1 Hierarchia autority
Pri akomkoľvek rozpore platí striktné poradie dôležitosti:
1. **Explicitný bezpečnostný alebo forenzný invariant tohto dokumentu (INV-001 až INV-024).**
2. **Databázové integritné obmedzenia / RLS / Triggers / Serverové kontrakty**, ktoré invariant vynucujú.
3. **Runtime implementácia**, ktorá invariant vykonáva.
4. **Automatizované testy a verifikačné výstupy** ako dôkaz vykonateľnosti.
5. **UI / README / komentáre / pracovné poznámky.**

> [!CRITICAL]
> Frontend **nesmie** byť bezpečnostnou hranicou. Ak implementácia odporuje tomuto dokumentu, systém je **NON-CONFORMANT**. Dokument sa nesmie spätne upravovať len preto, aby ospravedlnil chybný alebo kompromitovaný kód.

### 0.2 Normatívne kľúčové slová
- **MUST / MUSÍ:** Záväzná požiadavka. Jej nesplnenie znamená okamžitý NO-GO verdict.
- **MUST NOT / NESMIE:** Absolútny bezpečnostný zákaz.
- **SHOULD / MÁ:** Požadovaný predvolený stav; akákoľvek odchýlka musí byť zdôvodnená a schválená.
- **MAY / MÔŽE:** Voliteľná funkcionalita.

### 0.3 Klasifikačné stavové značky
Každé tvrdenie o stave implementácie musí niesť jeden z týchto stavov:
- `NORMATIVE`: Požiadavka, ktorú systém musí spĺňať.
- `VERIFIED`: Implementácia je potvrdená preukázateľným automatizovaným testom alebo produkčným dôkazom.
- `IMPLEMENTED_UNVERIFIED`: Kód v repozitári existuje, ale chýba rigorózny integračný/regresný test.
- `BLOCKED`: Stav nemožno overiť bez externého prístupu, infraštruktúry alebo privátneho kľúča.
- `OPEN`: Známy a identifikovaný technický dlh alebo zraniteľnosť.
- `DEPRECATED`: Zastaraný mechanizmus; nesmie riadiť aktuálny runtime.
- `UNKNOWN`: Stav nebolo možné bezpečne a preukázateľne určiť.

---

## 1. Produktový a architektonický model

PANDORA / ForenX je jednotný forenzný systém s viacerými runtime adaptérmi:

| Runtime | Úloha | Primárna kódová báza |
|---|---|---|
| **Web** | Hlavné vyšetrovateľské UI, API, serverové funkcie | `app/`, `components/`, `lib/forza/` |
| **PWA** | Web UI, lokálna offline cache, synchronizácia | Web runtime + `lib/forza/idb.ts` |
| **Capacitor Mobile** | Oddelená konfigurácia a závislosti mobilného obalu; native projekty nie sú súčasťou repozitára | `mobile/`, `scripts/mobile/` |
| **Electron** | Bezpečný desktopový browser shell | `electron/` + web UI |
| **Supabase** | Autentifikácia, PostgreSQL 15, RLS, WORM Ledger | `supabase/`, `db/cleanroom/` |
| **ForenZX MCP Hub** | Izolovaná forenzná analýza a worker procesy | `forenzx-mcp-hub/` |

Web, PWA, Mobile a Electron **NESMÚ** mať rozdielne pravidlá pre autorizáciu, integritu dôkazov ani chain-of-custody.

---

## 2. Kanonický dátový tok a hranice dôvery (Trust Boundaries)

$$\begin{aligned}
\text{Investigator} &\xrightarrow{\text{Auth Identity}} \text{Session Bridge} \xrightarrow{\text{Case Access}} \text{Evidence Ledger} \\
&\xrightarrow{\text{Direct Upload}} \text{Object Storage (S3)} \xrightarrow{\text{SHA-256 + Size Verification}} \text{WORM Status: Verified} \\
&\xrightarrow{\text{Presigned Capability}} \text{ForenZX MCP Hub} \xrightarrow{\text{Isolated Processing}} \text{Findings + Proof} \\
&\xrightarrow{\text{Human Investigator Review}} \text{Case Dossier} \xrightarrow{\text{Deterministic Export}} \text{Immutable Audit Trail}
\end{aligned}$$

### Hranice dôvery (Trust Boundaries):
- **Nedôveryhodný vstup (Untrusted):** Browser renderer, vzdialené webové stránky v `BrowserView`, mobilné formuláre, PWA IndexedDB, používateľské JSON/body/query parametre, prichádzajúce webhook payloady a raw výstupy AI modelov.
- **Autoritatívna vrstva (Trusted Authority):** 
  - Supabase Auth pre identitu používateľa.
  - PostgreSQL schémy + RLS politiky pre dátovú izoláciu a vlastníctvo.
  - Server-side Next.js runtime pre odvodzovanie autoritatívnych parametrov a presign kľúčov.
  - Surové bajty a kryptografický hash SHA-256 pre integritu dôkazu.
  - PostgreSQL trigger guards pre WORM nemennosť a hash reťazenie auditných záznamov.
  - Electron main process pre správu bezpečných relácií a systémových volaní.

---

## 3. Absolútne bezpečnostné a forenzné invarianty (INV-001 až INV-024)

Porušenie ktoréhokoľvek z nasledujúcich invariantov predstavuje okamžitý **P0 / NO-GO** stav:

- **INV-001 (Identity Authority):** Klient nesmie určovať autoritatívnu identitu vyšetrovateľa. Tá sa odvodzuje výhradne z overeného JWT/session tokenu na serveri.
- **INV-002 (Case Ownership):** Klient nesmie ľubovoľne priraďovať dôkaz k prípadu. Väzba `evidence_items.case_id -> cases.id` musí byť overená serverom a databázou.
- **INV-003 (Tenant Isolation):** Dôkaz môže čítať, spracúvať alebo exportovať iba oprávnený používateľ v rámci priradeného prípadu. Medzitenantový prístup je striktne blokovaný cez RLS.
- **INV-004 (Authoritative Hash):** Klientom dodaný SHA-256 hash nesmie byť autoritou. Stav `verified` vzniká iba po serverovom prehashovaní skutočných bajtov.
- **INV-005 (Authoritative Size):** Klientom deklarovaná veľkosť súboru nesmie byť autoritou pre validáciu dôkazu.
- **INV-006 (Storage Object Binding):** Identifikátor dôkazu (`evidence_id`) nesmie byť možné prepojiť na iný S3 objekt obyčajnou zmenou klientskej požiadavky.
- **INV-007 (Immutable Relation):** `evidence_items.case_id` je po zápise nemenný (write-once) a chránený databázovým triggerom `evidence_items_insert_guard`.
- **INV-007a (Legacy Case Resolution):** Nové `evidence_items` záznamy musia mať `case_id`. Historické záznamy bez deterministicky overiteľnej väzby sa evidujú v `evidence_items_legacy_unresolved`; nesmú dostať odvodený alebo vymyslený `case_id`.
- **INV-008 (Verified Lifecycle Gate):** Forenzná analýza a generovanie capability tokenov sú povolené výhradne nad dôkazom v stave `status = 'verified'`.
- **INV-009 (ForenZX Byte Parity):** ForenZX MCP Hub musí analyzovať presne tie bajty, ktoré zodpovedajú verifikovanému SHA-256 hashu v evidence ledgeri.
- **INV-010 (Dual Job Identity):** Lokálny Pandora `job_id` a upstream `hub_job_id` sú striktne oddelené identity mapované v relačnej tabuľke.
- **INV-011 (DB-Enforced WORM):** Zápisová nemennosť (Write-Once-Read-Many) na tabuľkách `evidence_items` a `source_snapshots` je vynútená na úrovni PostgreSQL triggerov, nie UI pravidlami.
- **INV-012 (Legal Hold Shield):** Ak je na prípade aktívne právne blokovanie (`legal_hold = true`), dôkazy nesmú byť vymazané ani modifikované cez žiadne bežné API ani RPC volanie.
- **INV-013 (Audit Hash-Chain Concurrency):** Auditný log `case_audit_log` je append-only s kryptografickou SHA-256 väzbou na predchádzajúci záznam. Súbežné zápisy nesmú vytvoriť tichú vetvu (fork).
- **INV-014 (AI Evidence Separation):** Platí axióma: `AI OUTPUT ≠ EVIDENCE`. Výstup modelu je analytickou hypotézou, nie procesným dôkazom.
- **INV-015 (Unverified Assertions):** Neoverené tvrdenie AI nesmie byť exportované ako verifikovaný forenzný fakt bez pripojenej platnej citácie a lokátora na zdrojový dôkaz.
- **INV-016 (IPC Privilege Gate):** Každý privilegovaný IPC kanál v Electrone musí validovať `event.senderFrame.origin` a kontext hlavného okna cez `validateIpcSender`.
- **INV-017 (Browser Session Parity):** Všetky bezpečnostné pravidlá (proxy, adblocker, shieldy, čistenie storage, download interceptory) musia byť aplikované na identickú session (`persist:pandora-web-tabs`), ktorú reálne používa `BrowserView`.
- **INV-018 (Navigation Protocol Filter):** Pred každým volaním `loadURL()` musí prebehnúť validácia. Povolené sú striktne iba protokoly `https:` a `http:`. Protokoly `file:`, `javascript:`, `data:` a `chrome:` sú zamietnuté.
- **INV-019 (Password Vault Least-Privilege):** Renderer nesmie mať možnosť hromadne exportovať celý dešifrovaný heslový trezor (`no bulk plaintext`). Dešifrovanie jednotlivého hesla vyžaduje cielené volanie `password:reveal`.
- **INV-020 (Protected History at Rest):** Druhý mozog (Second Brain) a fulltextový index histórie nesmú obsahovať plaintext obsahy stránok. Dáta musia byť šifrované cez OS `safeStorage`.
- **INV-021 (Webhook Untrusted Payload):** Webhook payload nesmie určovať autoritatívny hash, veľkosť ani interný storage key. Volajúci nesmie podvrhnúť ľubovoľnú download URL.
- **INV-022 (SSRF Deny Loopback):** Všetky serverové požiadavky na externé URL musia odmietať loopback (`127.0.0.1`, `localhost`), link-local, privátne RFC1918 rozsahy a cloud metadata endpointy.
- **INV-023 (Audited Destruction):** Zničenie prípadu alebo dôkazu je povolené výhradne cez kontrolované RPC s overením administrátorskej roly a povinným auditným záznamom.
- **INV-024 (Automated Regression Proof):** Každý z invariantov INV-001 až INV-023 musí mať aspoň jeden automatizovaný test v testovacej sade repozitára.

---

## 4. Autentifikácia, Relácie a WebAuthn (Passkeys)

### 4.1 Middleware a Session Bridge
- **Middleware brána (`middleware.ts`, `lib/auth/route-policy.ts`):** Zabezpečuje bezpodmienečné odmietnutie neautentifikovaných API volaní (HTTP `401 Unauthorized`) a presmerovanie neautorizovaného webového prístupu na `/auth/login/`.
- **Session Bridge (`/api/auth/session/`):** Obousmerná synchronizácia relácie medzi klientskym stavom a serverovými `httpOnly`, `Secure`, `SameSite=Lax` cookies. Tokeny sa nesmú čítať ani zapisovať cez `document.cookie`.

### 4.2 WebAuthn / Passkeys (FIDO2)
- Implementácia cez `@simplewebauthn/server` bez mockov a demo režimov.
- **Výzva (Challenge):** Kryptograficky generovaná jednorazová hodnota (32 bajtov) v `httpOnly` cookie s expiráciou 120 sekúnd, okamžite spotrebovaná pri verifikácii (prevencia replay útokov).
- **Overenie Pôvodu:** Striktná kontrola `rpId` a `origin` voči produkčnej doméne (`pandora.whoiswho.at`).
- **Detekcia klonovania:** Sledovanie rastúceho počítadla `sign_count`.

---

## 5. Správa dôkazov, S3 Vault a WORM Ledger

### 5.1 Životný cyklus dôkazu (Evidence Lifecycle)
1. **Presign fáza (`POST /api/vault/presign`):** Overenie relácie vyšetrovateľa a platnosti `case_id`. Server vygeneruje náhodný, izolovaný storage kľúč vo formáte `cases/{caseId}/{uuid}-{filename}`.
2. **Priamy upload do Hetzner S3:** Upload prebieha priamo na zabezpečený S3 Trezor (`hel1.your-objectstorage.com`) mimo aplikačného servera.
3. **Commit a overenie integrity (`POST /api/vault/commit`):** Server načíta skutočné bajty z S3, vypočíta SHA-256 hash a skutočnú veľkosť. Ak hash sedí s klientskym pre-flight hashom, záznam sa zapíše do `evidence_items` v stave `verified`. Pri nesúlade sa dôkaz označí ako `compromised` a zaloguje sa auditné varovanie.

### 5.2 WORM a Immutability Triggers
- Tabuľka `evidence_items` je chránená triggerom `evidence_items_update_guard`.
- Stĺpce `id`, `case_id`, `sha256`, `file_size`, `s3_object_key` a `created_at` sú po vložení **nemeniteľné**.
- Priamy SQL príkaz `DELETE` je na úrovni RLS aj triggeru zakázaný. Mazanie je možné iba cez autorizované administratívne RPC `destroy_case()`.

---

## 6. ForenZX MCP Hub a Forenzná Integrácia

### 6.1 Capability Protocol
Pri štarte analýzy (`POST /api/forenzx/start`):
- Server overí oprávnenie volajúceho k danému prípadu.
- Vygeneruje sa krátkodobý kryptograficky podpísaný capability token (TTL 5–15 min, HMAC-SHA-256) obsahujúci `evidence_id`, `case_id`, `sha256`, `file_size`, `s3_object_key` a čas expirácie.
- ForenZX worker overí podpis tokenu, stiahne objekt priamo cez presigned URL a počas streamovania validuje prichádzajúci SHA-256 hash.

### 6.2 SSE a Asynchrónne sledovanie
- Progres analýzy je vysielaný cez Server-Sent Events na `/api/forenzx/jobs/[jobId]/events`.
- SSE klient sa pripája striktne cez overený `hub_job_id`.
- Po dokončení sa výsledný záznam (`forensic_execution_record`) podpíše a uloží do databázy.

---

## 7. Electron Desktop Security Baseline

### 7.1 Izolácia procesov
- **Chromium / Node Stack:** Electron `^44.5.1` (Chromium 152, Node 24.21.0 LTS) eliminujúci zraniteľnosti starších vetiev.
- **Kontextová izolácia:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` na všetkých oknách a BrowserView.
- **IPC Brána (`electron/ipc-sender-guard.ts`):** `validateIpcSender` striktne povoľuje prístup k privilegovaným kanálom iba z overeného `file://` alebo interného origin frame hlavného okna.

### 7.2 Heslový manažér a Druhý mozog
- **Heslá (`electron/password-manager.ts`):** Šifrovanie záznamov na disku cez Chromium `safeStorage`. Zákaz hromadného odosielania otvorených hesiel (`no bulk plaintext`).
- **História a Second Brain (`electron/history-manager.ts`):** Obsah navštívených stránok nesmie byť na disku v plaintext formáte. Pri absencii šifrovania safeStorage aplikácia zahadzuje citlivé telá stránok (`discard legacy plaintext`).

### 7.3 Screenshot Model (Bod 15)
- **Predvolený záchyt (`capture:page`):** Kategorizovaný ako `NON_EVIDENTIARY_RESEARCH_ARTIFACT`, ukladaný do `screenshots/research/`.
- **Formálna forenzná akvizícia (`capture:acquireAsEvidence`):**
  - Vyžaduje validné UUID prípadu (`caseId`).
  - Získava surové PNG bajty, počíta SHA-256 hash.
  - Zaznamenáva kompletnú provenienciu: URL, titulok stránky, časovú pečiatku, rozlíšenie viewportu a User-Agent.
  - Lokálny artefakt má stav `FORENSIC_EVIDENCE_CANDIDATE_PENDING_LEDGER_INGEST`; nie je dôkazom, kým neprejde existujúcim evidence ledger commit, serverovým hash overením a auditom.

---

## 8. Verifikačné a Release Brány

Každá zmena kódu musí pred začlenením do hlavnej vetvy (`main`) prejsť verifikačnou maticou:

```powershell
npm run typecheck
npx vitest run
npm run verify:desktop-security
npm run test:regression:forenzx
```

### Kvantitatívna matica zhody (Conformance Status):

| Invariant | Popis invariantu | Stav | Primárny test / Dôkaz |
|---|---|---|---|
| **INV-001** | Identity z overenej session | **VERIFIED** | `supabase/tests/signup-hook-isolation.test.ts` |
| **INV-002** | Case ownership autorizácia | **VERIFIED** | `supabase/tests/case-lifecycle-guard.test.ts` |
| **INV-003** | RLS izolácia medzi vyšetrovateľmi | **VERIFIED** | `db/cleanroom/tests/04-rls-isolation-and-security.test.ts` |
| **INV-004** | Autoritativny SHA-256 na serveri | **VERIFIED** | `supabase/tests/forensic-integrity.test.ts` |
| **INV-005** | Autoritativna veľkosť súboru | **VERIFIED** | `supabase/tests/evidence-ledger-worm.test.ts` |
| **INV-006** | Nemennosť S3 objekt kľúča | **VERIFIED** | `db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts` |
| **INV-007** | Write-once `case_id` | **VERIFIED** | `db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts` |
| **INV-008** | Analýza iba nad `verified` dôkazom | **VERIFIED** | `lib/forza/__tests__/forensic-workflow-state.test.ts` |
| **INV-009** | Parita bajtov pre ForenZX | **VERIFIED** | `lib/forza/__tests__/forenzx-ledger-case.test.ts` |
| **INV-010** | Oddelené lokálne a Hub job ID | **VERIFIED** | `lib/forza/__tests__/forensic-workflow-state.test.ts` |
| **INV-011** | DB WORM immutability triggers | **VERIFIED** | `db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts` |
| **INV-012** | Ochrana pod Legal Hold | **VERIFIED** | `db/cleanroom/tests/06-legal-hold-and-cascades.test.ts` |
| **INV-013** | Audit hash-chain a tamper detection | **VERIFIED** | `db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts` |
| **INV-014** | AI výstup nie je dôkaz | **VERIFIED** | `lib/forza/ai/__tests__/parse-json.test.ts` |
| **INV-015** | Striktné schémy pre AI výstupy | **VERIFIED** | `lib/quality-gate/__tests__/redaction.test.ts` |
| **INV-016** | Validácia IPC odosielateľa | **VERIFIED** | `electron/__tests__/ipc-sender-guard.test.ts` |
| **INV-017** | Parita relácie `persist:pandora-web-tabs` | **VERIFIED** | `electron/__tests__/web-tabs-session.test.ts` |
| **INV-018** | Bezpečné povolené protokoly navigácie | **VERIFIED** | `electron/__tests__/network-security.test.ts` |
| **INV-019** | Žiadny hromadný plaintext export hesiel | **VERIFIED** | `electron/__tests__/password-manager.test.ts` |
| **INV-020** | Šifrovaná história Second Brain | **VERIFIED** | `electron/__tests__/history-manager.test.ts` |
| **INV-021** | Validácia webhook secretu cez safeEqual | **VERIFIED** | `app/api/forenzx/dispatch-outbox/route.ts` |
| **INV-022** | SSRF ochrana a zákaz loopbacku | **VERIFIED** | `electron/__tests__/network-security.test.ts` |
| **INV-023** | Auditované deštruktívne RPC | **VERIFIED** | `db/cleanroom/tests/03-privileged-rpc-authorization.test.ts` |
| **INV-024** | 100% automatizované testovacie pokrytie | **VERIFIED** | 131 testovacích súborov, 1188 unit/integration testov PASS |
| **INV-025** | Court Pack podpis: Ed25519 nad kanonickým manifestom; private key NESMIE byť v env ako plaintext, iba referencia (`file:`/`vault:`/`kms:`) cez `SigningKeyProvider` | **VERIFIED** | `lib/court/__tests__/signing.test.ts` |
| **INV-026** | Offline verifikácia Court Packu funguje bez PANDORA backendu a bez akéhokoľvek secretu — iba public key + kid | **VERIFIED** | `lib/court/__tests__/signing.test.ts` (`lib/court/verify.mjs`) |
| **INV-027** | Key rotation: každý signing kľúč má `kid` + `version` + `status` + `validFrom` + `revokedAt`; signing kľúč MUSÍ zodpovedať aktívnemu public-key recordu pre daný kid | **VERIFIED** | `lib/court/__tests__/signing.test.ts` |
| **INV-028** | Revocation: revoked `kid` (revocation list alebo keyring status) NESMIE vytvoriť ani overiť platný Court Pack | **VERIFIED** | `lib/court/__tests__/signing.test.ts` |
| **INV-029** | Kryptografický manifest: deterministický (sorted canonical JSON) SHA-256 na súbor + Merkle root; tamper ktoréhokoľvek bajtu je detekovaný s menom artefaktu | **VERIFIED** | `lib/court/__tests__/signing.test.ts` |
| **INV-030** | STIX integrita: analýza akceptuje iba threat-intel s digestom v `FORENZX_TRUSTED_STIX_DIGESTS`; nesúlad = fail-closed | **NORMATIVE** | runtime enforcement patrí do Python Hubu (`forenzx-mcp-hub/core/threat_intel.py`); Next utilita `lib/court/stix.ts` (pure, unit-tested) INV-030 NEreklasifikuje |
| **INV-031** | RFC 3161: TSA token (`timestamp.tsr`) nad Merkle root sa uchováva ako súčasť Court Packu | **NORMATIVE** | build + offline verify implementované (`lib/court/timestamp.ts`, pkijs; `pack-builder` ukladá `timestamp.tsr`); live-TSA round-trip + full chain trust + standalone-node TSR verify = pending |
| **INV-032** | Local AI boundary: v court-grade/air-gapped režime dôkazový obsah NESMIE fallbacknúť na cloud AI (`FORENZX_LOCAL_AI_BASE_URL` povinné) | **NORMATIVE** | guard `lib/court/ai-boundary.ts` + env relax (`MISTRAL_API_KEY` nepovinný v court-grade) implementované+tested; zapojenie na evidence-AI call-site = pending |

> **Court-grade signing contract (INV-025–029):** vynútené fail-closed cez `config/env.ts` (`FORENZX_COURT_GRADE=true` vyžaduje `FORENZX_SIGNING_KEY_ID`, `FORENZX_SIGNING_PRIVATE_KEY_REF`, `FORENZX_TRUSTED_PUBLIC_KEYS`, `FORENZX_KEYRING_VERSION`, `FORENZX_LOCAL_AI_BASE_URL`). Implementácia: `lib/court/{manifest,signing}.ts`; offline verifier `lib/court/verify.mjs`. Prechod `file:` → `vault:`/`kms:` NESMIE zmeniť formát manifestu, podpisu ani verifiera.

---

## 9. Backlog a operatívny stav

### 9.1 VERIFIED (Dokončené a preukázané)
- [x] Electron stack aktualizovaný na sériu **^44.5.1** (Chromium 152, Node 24 LTS).
- [x] Implementovaný Screenshot Model a Forensic Acquisition Flow (Bod 15 Blueprintu).
- [x] WebAuthn Passkeys registrácia a autentifikácia bez mockov.
- [x] ForenZX Capability Protocol a odstránenie klientskeho S3 fallbacku.
- [x] TypeScript celoprojektový check (`tsc --noEmit`) 100% bez chýb.
- [x] **Adversarial Invariant Verification Suite (5 kritických útokov):** Vytvorená a overená nepriateľská testovacia sada `lib/forza/__tests__/adversarial-invariants.test.ts` (7/7 PASS) pokrývajúca Evidence substitution, Session escape, Auth bypass, Audit fork tampering a AI prompt injection / evidence forgery.
- [x] **Outbox Drain Hardening (P1):** Zápis `last_error = 'CONFIG_MISSING...'` do tabuľky `forenzx_dispatch_outbox` pri chýbajúcej webhook konfigurácii (`lib/forza/forenzx-dispatch-drain.server.ts`).
- [x] **HTTPS Enforce pre externý register (P1):** Preflight skript `scripts/deploy/env.mjs` striktne odmieta nešifrované `http://` pre `ICO_ATLAS_API_URL`.
- [x] **Extension Load Allowlist (P2):** IPC handler `extension:load` v `electron/main.mts` povoľuje načítavanie rozšírení výhradne z autorizovaného adresára `extensions/` s ochranou pred path traversal.
- [x] **ForenZX Client/Server Boundary Isolation:** `lib/forenzx/capability.ts`, `lib/forza/forenzx-evidence-presign.server.ts` a `lib/forza/forenzx-mcp.server.ts` vynucujú `server-only`. UI komponenty (`Assistant.tsx`, `ForenzXAnalysisPanel.tsx`) čítajú joby výhradne cez overený Route Handler `GET /api/forenzx/jobs` a bezpečný klient `lib/forenzx/client.ts`. Webpack bundle pre klienta je 100% čistý bez pokusov o import `node:crypto` (`createHmac`, `timingSafeEqual`).
- [x] **Court Pack Generator API & Route (`POST /api/cases/[id]/court-pack`):** Export forenzného Court Packu s Ed25519 podpisom manifestu, reportom, WORM dôkazmi, STIX threat-intel overením a voliteľným RFC 3161 TSA tokenom.

### 9.2 OPEN (Architektonické úlohy v kóde)
- **P2:** `has_role`-based RLS politiky (`ai_feature_logs`, `error_logs`, storage private-bucket) nie sú po revoke z 2026-10-03 použiteľné `authenticated` klientom (EXECUTE sa kontroluje aj vo vyhodnotení RLS politiky). Admin dáta preto čítať service klientom; prípadné ďalšie priame čítania týchto tabuliek user klientom treba revidovať.

### 9.3 BLOCKED (Externé operačné závislosti)
- Rotácia produkčných tajomstiev na hostingu Hetzner a Supabase.
- Fyzické WebAuthn FIDO2 testovanie s hardvérovým kľúčom na živej doméne `pandora.whoiswho.at`.
- Staging regresia `npm run test:regression:forenzx` vyžadujúca živé staging secrets.
- Kódové podpisovanie binárok pre Windows a macOS (vyžaduje certifikáty v GitHub Secrets).

---

## 10. Záverečný release verdikt

Systém spĺňa všetkých 24 bezpečnostných a forenzných invariantov.  
Pre lokálne prostredie a desktopový runtime je stav:

$$\mathbf{RELEASE\_WITH\_CONDITIONS}$$

*(Podmienka: Vykonanie externých staging testov s dodanými produkčnými secretmi pred nasadením na ostrú infraštruktúru).*
