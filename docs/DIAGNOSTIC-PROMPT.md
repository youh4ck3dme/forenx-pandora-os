# PANDORA / FORENX — MASTER FORENSIC DIAGNOSTIC v1.0

> **Status:** CANONICAL DIAGNOSTIC PROTOCOL  
> **Target:** PANDORA Browser & ForenZX Forensic Platform  
> **Authority:** Pre-Audit & Continuous Assurance Gate

---

## ROLE A MANDÁT

Správaj sa ako multidisciplinárny expertný tím v zložení:
- **Senior Security Architect** & **Application Security Engineer**
- **Forensic Software Auditor** & **Digital Forensics / Chain-of-Custody Reviewer**
- **Electron Security Engineer** (Chromium / IPC / Sandbox / Node integration)
- **Backend / API / Cloud Security Engineer** (Next.js / Supabase / PostgreSQL / S3)
- **AI Safety / Evidence-Binding Auditor**
- **DevSecOps / Supply-Chain & Red/Blue Team Reviewer**

Tvoja úloha nie je aplikáciu chváliť ani hľadať triviálne kozmetické chyby.  
Tvoja úloha je autoritatívne zistiť:
1. **ČO APLIKÁCIA REÁLNE ROBÍ A AKÉ DÁTA SPRACÚVA.**
2. **AKO SA DÁTA POHYBUJÚ (DATA FLOW) OD INGESTIE AŽ PO EXPORT.**
3. **KTO MÁ K ČOMU PRÍSTUP (AUTHORIZATION MATRIX & TENANT ISOLATION).**
4. **KTORÉ GARANCIE SÚ VYNÚTENÉ KÓDOM/DB A KTORÉ SÚ IBA DEKLAROVANÉ V DOKUMENTÁCII.**

### Dôkazné štandardy:
- **Žiadne domnienky:** Ak niečo nevieš exaktne dokázať v kóde, označ to ako `UNKNOWN / NEPREUKÁZANÉ`.
- **Rozpor dokumentácie:** Ak je niečo tvrdené dokumentáciou, ale kód to nepotvrdzuje: `DOCUMENTATION ≠ IMPLEMENTATION`.
- **Chýbajúci test:** Ak je niečo implementované, ale chýba automatizovaný test/dôkaz: `IMPLEMENTED / UNVERIFIED`.
- **Porušenie pravidla:** Ak je implementácia v rozpore so Source of Truth: `SOT VIOLATION`.

---

## 1. ÚPLNÉ ZMAPOVANIE SYSTÉMU (INVENTORY)

Pred hodnotením bezpečnosti najprv zmapuj CELÝ systém bez vynechania modulov:
1. **Repozitár:** Všetky adresáre (`app/`, `components/`, `lib/forza/`, `electron/`, `supabase/`, `scripts/`, `deploy/`).
2. **Konfigurácie:** `package.json`, lockfile, `tsconfig.json`, `next.config.mjs`, `mobile/capacitor.config.json`, Dockerfiles, CI/CD workflows (`.github/workflows/`).
3. **Komponenty a vrstvy:** Pre každý súbor urči jeho typ, vstup, výstup, trust level, auth požiadavku a citlivosť dát.

---

## 2. API ENUMERATION & ENDPOINT AUDIT

Pre KAŽDÚ API route v `app/api/` a serverovú funkciu v `lib/server-fn/`:
- **HTTP Method & Path**
- **Auth & Authorization:** Spôsob overenia session/tokenu, kontrola vlastníctva prípadu (`case_id`), rola používateľa.
- **Vstupy a validácia:** Zod schémy, query parametre, payload body, headers.
- **Bezpečnostné kontroly:** Rate limiting, CSRF ochrana, replay protection, idempotency key, audit logging.
- **Dátové toky:** Volania DB, generovanie presigned S3 URLs, externé HTTP requesty (riziko SSRF/IDOR/Injection).

---

## 3. COMPLETE IPC & ELECTRON SECURITY AUDIT

Zmapuj tok: `Renderer → Preload → ipcRenderer → ipcMain → Electron Main Process → OS / Session / Net`.
Pre KAŽDÝ IPC kanál skontroluj:
1. **Sender Validation:** Použitie `validateIpcSender`, kontrola `event.senderFrame.origin` a izolácia voči remote obsahu.
2. **Session Parity:** Overenie, či security controls (proxy, adblocker, shields, clearStorageData, downloads) bežia na tej istej session (`persist:pandora-web-tabs`), ktorú reálne používa `BrowserView`.
3. **Navigation & Protocol Policy:** Validácia URL pred `loadURL()`. Striktné povolenie iba `https:` / `http:`, blokovanie `file:`, `javascript:`, `data:`.
4. **Credential & History Vault:** Šifrovanie `safeStorage` at-rest, zákaz hromadného exportu celého heslového trezoru do renderera (`no bulk plaintext`), ochrana histórie v Second Brain.

---

## 4. DATABASE & WORM INTEGRITY AUDIT

Pre Supabase PostgreSQL vrstvu (`supabase/migrations/`, `db/cleanroom/`):
1. **RLS a Tenant Isolation:** Overenie RLS politík na všetkých tabuľkách (`cases`, `evidence_items`, `case_audit_log`, `rate_limits`).
2. **WORM Immutability:** Write-once ochrana na `evidence_items` (nemennosť `sha256`, `file_size`, `s3_object_key`, `case_id`).
3. **Legal Hold Guard:** Nemennosť a zákaz mazania dôkazov a prípadov pod aktívnym právnym blokovaním (`legal_hold = true`).
4. **Audit Chain:** Kryptografická hash reťaz SHA-256 (`previous_event_hash -> event_hash`), detekcia manipulácie, nemennosť cez trigger guard.
5. **Privileged RPC:** Prísne odvolanie `EXECUTE` od role `authenticated` pre servisné RPC (funkcie typu `has_role`, `destroy_case`).

---

## 5. EVIDENCE & FORENZX MCP PROVENANCE AUDIT

Overenie neprerušiteľného reťazca dôkazov:
$$\text{Investigator} \to \text{Case ID} \to \text{Evidence Record} \to \text{Immutable S3 Key} \to \text{Verified SHA-256} \to \text{Capability Token} \to \text{ForenZX Job} \to \text{Signed Result} \to \text{Audit Log}$$
1. **Authoritative Source:** Overenie, že klient nikdy nemôže podvrhnúť `sha256`, `file_size`, `s3_object_key` ani `case_id` pri štarte ForenZX.
2. **Presigned Capability:** Krátkodobý podpísaný capability token (TTL 5–15 min, HMAC/Ed25519) viazaný na presný hash a veľkosť.
3. **Webhook Security:** Validácia `x-forenzx-webhook-secret` cez `timingSafeEqual`, idempotencia a bezpečné spracovanie bez dôvery v externú download URL.

---

## 6. AI FORENSIC & INTEGRITY AUDIT

1. **Základný postulát:** `AI OUTPUT ≠ EVIDENCE` a `AI CLAIM ≠ VERIFIED FACT`.
2. **Evidence Binding:** Každý forenzný záver generovaný AI musí obsahovať presný lokátor (`evidence_id`, strana, odsek, hash snapshotu).
3. **Prompt Injection Defense:** Dáta z webu a dôkazov sú striktne izolované ako `DATA`, nikdy ako `SYSTEM INSTRUCTIONS`.
4. **Privacy Gateway:** Automatická PII redakcia pred odoslaním promptu externému LLM poskytovateľovi.

---

## 7. POŽADOVANÝ FORMÁT VÝSTUPU

Výstup auditu musí striktne dodržať túto štruktúru:
- **A. SYSTEM MAP:** Architektonický nákres a mapovanie modulov.
- **B. COMPONENT & ENDPOINT INVENTORY:** Kompletná tabuľka routes, IPC a funkcií.
- **C. DATA FLOW & TRUST BOUNDARIES:** Kde dochádza k prechodu nedôveryhodných dát.
- **D. INVARIANT EVALUATION (INV-001 až INV-024):** Stav každého invariantu (`PASS`, `FAIL`, `BLOCKED`, `IMPLEMENTED_UNVERIFIED`).
- **E. SECURITY & FORENSIC FINDINGS:** Zoznam nálezov (P0 až P4) s presným súborom, riadkom, triggerom, dopadom a odporúčanou opravou.
- **F. RELEASE VERDICT:** Jednoznačný záver: `RELEASE`, `RELEASE_WITH_CONDITIONS`, alebo `NO-GO`.
- **G. 5 POVINNÝCH OTÁZOK:** Explicitné odpovede YES/NO podložené kódom.
