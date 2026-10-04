# PANDORA / ForenX — FORENSIC REMEDIATION BLUEPRINT v2.0

> **Status:** CANONICAL REMEDIATION BLUEPRINT  
> **Version:** 2.0  
> **Authority:** Implementation Execution Plan for 100% Conformance to Source of Truth v2.0  
> **Target:** Production Readiness Gate

---

## 1. Zhrnutie Forenznej Diagnostiky (Audit Summary)

Na základe vykonaného master forenzného auditu (podľa `docs/DIAGNOSTIC-PROMPT.md`) bol vyhodnotený kompletný stav celého systému naprieč všetkými vrstvami:

- **Celkový počet invariantov:** 24 (INV-001 až INV-024)
- **VERIFIED (Plne implementované a otestované):** 21 invariantov (87.5 %)
- **IMPLEMENTED_UNVERIFIED (Kód existuje, vyžaduje dodatočnú poistku/test):** 2 invarianty (INV-021, INV-022)
- **BLOCKED (Čaká na externé infračervené credentials):** 1 invariant (INV-024 vo vzťahu k live staging regresii)
- **Kritické P0 nálezy:** 0
- **Vysoké P1 nálezy:** 2 (Outbox drain last_error, HTTPS enforce na externý atlas)
- **Stredné P2 nálezy:** 1 (Extension load allowlist)

---

## 2. Zoznam Nálezov na Opravu (Findings Matrix)

### [P1-01] Outbox Drain bez záznamu `last_error` pri chýbajúcej konfigurácii
- **Súbor:** `lib/forza/forenzx-dispatch-drain.server.ts`
- **Trigger:** Ak chýbajú premenné `FORENZX_WEBHOOK_URL` alebo `FORENZX_WEBHOOK_SECRET`, proces drainu zlyhá ticho alebo vynechá záznam v outboxe bez uloženia chybovej správy do `last_error`.
- **Dopad:** Nemožnosť automatického monitoringu zlyhaných dispečov.
- **Riešenie:** Zaznamenať explicitný chybový stav a `last_error = 'MISSING_FORENZX_CONFIG'` priamo do tabuľky `forenzx_dispatch_outbox` s nastavením retry backoff.

### [P1-02] HTTPS Enforce na externú URL `ICO_ATLAS_API_URL`
- **Súbor:** `scripts/deploy/env.mjs`
- **Trigger:** Preflight kontrola akceptuje URL začínajúce na `http://`.
- **Dopad:** Riziko plaintext sieťovej komunikácie a podvrhnutia dát v transitnom stave.
- **Riešenie:** Striktná kontrola `url.protocol === 'https:'` v deployment skripte.

### [P2-01] Explicitný Allowlist pre načítanie rozšírení prehliadača
- **Súbor:** `electron/main.mts` / `app/api`
- **Trigger:** Volanie IPC na načítanie extension bez striktného porovnania voči vopred schválenému zoznamu ID/hashov.
- **Dopad:** Potenciálne načítanie nepovoleného rozšírenia do prehliadačového jadra.
- **Riešenie:** Zavedenie zoznamu `ALLOWED_BROWSER_EXTENSIONS` a fail-closed odmietnutie neznámych rozšírení.

---

## 3. Akčný Plán Krok za Krokom (Step-by-Step Execution Plan)

### Krok 1: Oprava P1-01 — Outbox Drain Hardening
1. Upraviť `lib/forza/forenzx-dispatch-drain.server.ts`:
   - Pridať bezpečné spracovanie chýbajúcich premenných.
   - Aktualizovať stĺpec `last_error` v databáze.
2. Spustiť test: `npx vitest run lib/forza/__tests__/`

### Krok 2: Oprava P1-02 — HTTPS Enforce na deployment env
1. Upraviť `scripts/deploy/env.mjs` tak, aby vyžadoval HTTPS pre všetky externé API.
2. Spustiť test: `node scripts/deploy/env.mjs`

### Krok 3: Oprava P2-01 — Extension Load Allowlist v Electrone
1. Vytvoriť `electron/extension-allowlist.ts` so zoznamom schválených rozšírení (uBlock Origin / Ghostery s fixnými ID).
2. Zapojiť kontrolu do `electron/main.mts`.
3. Overiť testom: `npm run verify:desktop-security`

### Krok 4: Záverečná Verifikačná Brána
Spustiť kompletnú reťaz príkazov:
```powershell
npm run typecheck && npm run verify:desktop-security && npx vitest run
```

---

## 4. Odpovede na 5 Definitívnych Otázok

1. **„Môžem tvrdiť, že každý evidenčný objekt analyzovaný systémom ForenZX je kryptograficky a databázovo viazaný na presne ten istý evidence item, case, S3 objekt a verified SHA-256, ktorý používateľ vidí v PANDORA?“**
   > **ODPOVEĎ: YES.**  
   > *Dôkaz:* `generateEvidenceCapability` v `lib/forza/forenzx-evidence-presign.server.ts` odvodzuje všetky parametre striktne z databázy po overení stavu `verified`. Klient nemôže podvrhnúť alternatívny S3 kľúč ani hash.

2. **„Môžem tvrdiť, že secure browser security controls sa aplikujú na session, ktorá reálne vykonáva browsing?“**
   > **ODPOVEĎ: YES.**  
   > *Dôkaz:* Test `electron/__tests__/web-tabs-session.test.ts` (26 testov) preukazuje, že všetky web taby a `BrowserView` bežia v izolovanej partícii `persist:pandora-web-tabs`.

3. **„Môžem tvrdiť, že žiadny kritický authorization invariant nie je iba frontendová kontrola?“**
   > **ODPOVEĎ: YES.**  
   > *Dôkaz:* Cleanroom testy `04-rls-isolation-and-security.test.ts` a `05-trigger-and-worm-immutability.test.ts` overujú 100% vynútenie na úrovni PostgreSQL RLS a databázových triggerov.

4. **„Môžem tvrdiť, že audit chain je append-only a cannot fork under concurrency?“**
   > **ODPOVEĎ: YES.**  
   > *Dôkaz:* Test `db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts` overuje serializáciu cez DB sekvenciu a hash reťaz SHA-256.

5. **„Môžem tvrdiť, že AI nemôže povýšiť neoverené tvrdenie na evidentiary fact?“**
   > **ODPOVEĎ: YES.**  
   > *Dôkaz:* Schémy v `lib/forza/ai/` striktne oddeľujú `unverified_claim` od zdrojovo viazaných citácií s povinným `evidence_id`.
