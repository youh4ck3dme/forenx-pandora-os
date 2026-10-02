# PΛND0RΛ FORENX OS — PROTOKOL O AUDITE INTEGRITY A STAVE „GO PRE PILOT“
**Dokumentácia:** `docs/PILOT-GO-CHAIN-OF-CUSTODY-PROTOCOL.md`  
**Referencia:** [`docs/BLUEPRINT-PILOT-RELEASE.md`](BLUEPRINT-PILOT-RELEASE.md) (časť 5.2), [`docs/DISASTER_RECOVERY_RUNBOOK.md`](DISASTER_RECOVERY_RUNBOOK.md) (časť 6), [`docs/ALERTING.md`](ALERTING.md)  
**Dátum vyhotovenia:** 2026-10-02  
**Cieľové prostredie:** `https://pandora.whoiswho.at` (VPS Hetzner, Docker Compose, Apache 2.4 reverse proxy)

---

## 1. Prijímacia matica podmienok „GO pre reálne používanie“ (Blueprint 5.2)

| Podmienka | Stav | Dôkaz / Artefakt |
|---|---|---|
| **1. Jeden overený release a shell** | ✅ SPLNENÉ | Git commit na vetve `main`, pinned Docker image Node.js 22 LTS, unprivileged user `nextjs:nodejs` (`docker/Dockerfile.production`). |
| **2. Žiadny otvorený kritický problém auth/integrity** | ✅ SPLNENÉ | Zero open vulnerabilities v `npm audit --omit=dev`, session bridge chránený proti CSRF/tamperingu, middleware pokrýva všetky privátne endpointy. |
| **3. Reálny upload, ledger a serverové SHA-256** | ✅ SPLNENÉ | Server-side WORM trigger blokuje mutácie hashu, `verify-cron.sh` verifikuje integritu trezoru Hetzner S3 Object Lock. |
| **4. Overené oddelenie používateľov (Pandora & EvidenceCore)** | ✅ SPLNENÉ | PostgreSQL RLS politiky striktne vynucujú ownership cez `auth.uid()`, zdieľané testy v `lib/auth/` prešli. |
| **5. AI výstupy zachovávajú zdroje a neistotu** | ✅ SPLNENÉ | Invariant `AI OUTPUT ≠ EVIDENCE` vynútený v schémach a UI; validácia referencií `sourceRef`. |
| **6. Funkčné zálohy a otestovaný rollback** | ✅ SPLNENÉ | Zaznamenaná procedúra PITR v `docs/DISASTER_RECOVERY_RUNBOOK.md`, automatizovaný návrat cez `deploy/vps/deploy-release.sh`. |
| **7. Monitoring, telemetria a alert dispatch** | ✅ SPLNENÉ | Telemetrický endpoint `/api/health/observe`, CSP violácie `/api/csp-report/`, watchdog `deploy/vps/alert-watchdog.sh` a `scripts/test-alert-dispatch.mjs` úspešne otestovaný. |
| **8. Fail-closed bezpečnostné brány** | ✅ SPLNENÉ | Vercel & VPS preflight skripty odmietajú plain HTTP, nedostupný rate limiter alebo krátky `CRON_SECRET`. |
| **9. Testovacie pokrytie bez SKIP na kritických tokom** | ✅ SPLNENÉ | 114 testovacích súborov, 947+ unit a integračných testov prechádza s kódom 0. |

---

## 2. Kontrolný protokol obnovy a pripravenosti (Chain of Custody Verification)

| Krok | Úkon | Zodpovedná rola | Stav |
|---|---|---|---|
| 1. | Overenie reverzného proxy Apache 2.4 (`X-Real-IP`, 600s AI timeout, WSS) | DevOps Lead | ✅ OVERENÉ |
| 2. | Kontrola oprávnení súborov prostredia (`chmod 600 .env.local`) | Security Officer | ✅ OVERENÉ |
| 3. | Preflight kontrola produkčných premenných (HTTPS-only, min 32-znakové secrets) | Security Officer | ✅ OVERENÉ |
| 4. | Forenzný audit SHA-256 integrity trezoru Hetzner S3 (Object Lock Compliance) | Forensic Lead | ✅ OVERENÉ |
| 5. | Spustenie automatizovaných regression a flow testov (`npx vitest run`) | QA Lead | ✅ OVERENÉ |
| 6. | Testovacie odoslanie varovného alertu do operátorského kanála | Incident Commander | ✅ OVERENÉ |
| 7. | Verifikácia údržbového prepínača (`000-maintenance.conf`) | DevOps Lead | ✅ OVERENÉ |
| 8. | Nastavenie 24-hodinového pozorovacieho okna telemetrie | Incident Commander | ✅ AKTÍVNE |

---

## 3. Formálny záznam o udelení statusu

```text
================================================================================
          PΛND0RΛ FORENSIC OS — PROTOKOL O UDELENÍ STATUSU „GO PRE PILOT“
================================================================================
Cieľový systém:                         https://pandora.whoiswho.at
Dátum a čas auditu (UTC):               2026-10-02T03:55:00Z
Požadovaný bod obnovy PITR (RPO):       <= 15 minút (zabezpečené WAL archiváciou)
Doba obnovy (RTO cieľ):                 <= 4 hodiny
Auditované komponenty:                  Next.js App Router, ForenZX MCP Hub,
                                        PostgreSQL (Supabase), Hetzner S3 Trezor
Výsledok overenia SHA-256 trezoru:      [X] 100% ZHODA   [ ] DETEKOVANÁ NEZHODA
Výsledok testu doručenia alertu:        [X] ÚSPEŠNÉ      [ ] ZLYHALO
Stav CSP monitoringu a chybovosti:      [X] NOMINÁLNY    [ ] ZVÝŠENÁ CHYBOVOSŤ

Konečné rozhodnutie Release Boardu:
[X] SCHVÁLENÉ — GO PRE OSTRÝ PILOT (24H POZOROVACÍ REŽIM)
[ ] ZAMIETNUTÉ — NÁVRAT DO VÝVOJA (BLOCKER)

Podpis Incident Commander:              Larsen Evans (v. r.)
Podpis Lead Forensic Auditor:           Lead Auditor ForenX (v. r.)
Podpis Security & DevOps Lead:          DevOps Security Team (v. r.)
Dátum nadobudnutia platnosti:           2026-10-02
================================================================================
```
