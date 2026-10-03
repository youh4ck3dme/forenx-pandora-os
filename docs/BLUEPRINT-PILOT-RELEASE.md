# PΛND0RΛ / ForenX — Plán pilotného releasu

> Tento dokument definuje podmienky, kritériá a postup pre pilotný release. Čas na schválenie: pred prvým reálnym prípadom v produkcii.

## 1. Účel

Tento Blueprint stanovuje presné GO/NO-GO kritériá pre pilotný release systému PΛND0RΛ / ForenX na základe auditov, testov a deployment overení. Formálny GO stav sa zaznamenáva v `docs/PILOT-GO-CHAIN-OF-CUSTODY-PROTOCOL.md`.

## 2. Rozsah pilota

Pilot sa týka:
- jedného aktívneho prípadu s reálnymi dôkazmi,
- jedného alebo dvoch vyšetrovateľov,
- produkčného Supabase projektu `tlmuvzrgighahnjkxoyw`,
- produkčného Hetzner S3 bucketú (Evidence Vault),
- domény `pandora.whoiswho.at`.

## 3. Predpilotné technické požiadavky

Každá položka musí byť `DONE` alebo `VERIFIED` (nie `BLOCKED`, `RED` ani `ROTATION REQUIRED`) pred GO.

### 3.1 Bezpečnosť (P0)

| # | Podmienka | Overenie |
|---|-----------|---------|
| S-01 | Všetky secrets rotované (`SUPABASE_SERVICE_ROLE_KEY`, S3, Mistral, Gemini, `FORENZX_WEBHOOK_SECRET`, `CRON_SECRET`) | `npm run verify:vercel-env -- --strict` bez chýb |
| S-02 | DNS + TLS `pandora.whoiswho.at` overené | `curl -sv https://pandora.whoiswho.at/api/health/public` → HTTP 200, platný certifikát |
| S-03 | WebAuthn / passkey funguje na produkčnej doméne | Registrácia a overenie passkey v produkčnom prehliadači |
| S-04 | `POST /api/vault` bez tokenu → 401; cudzí case → 403 | `curl` test zo stagingu |
| S-05 | Prod bundle neobsahuje `x-dev-user-id`, `dev-investigator-001` | `grep -r "dev-investigator" .next/` → žiadny výsledok |
| S-06 | CSP enforced (nie Report-Only) | Overenie v DevTools → hlavička `Content-Security-Policy` prítomná |
| S-07 | API kľúče (Mistral/OpenAI) nie sú v `localStorage` | DevTools → Application → Local Storage → žiadne `pandora_mistral_key` |
| S-08 | `npm audit --audit-level=high` prechádza bez chýb | CI zelené |

### 3.2 Databáza a migrácie

| # | Podmienka | Overenie |
|---|-----------|---------|
| D-01 | Všetky migrácie aplikované na `tlmuvzrgighahnjkxoyw` | `npx supabase db diff --schema public` → žiadne rozdiely |
| D-02 | RLS a ownership guardy funkčné | `npx vitest run` + smoke test cudzieho case_id |
| D-03 | ForenZX dispatch outbox tabuľka existuje | SQL: `SELECT 1 FROM forenzx_dispatch_outbox LIMIT 1` |

### 3.3 Zálohy a obnova

| # | Podmienka | Overenie |
|---|-----------|---------|
| Z-01 | Supabase PITR aktivovaný (RPO ≤ 15 min) | Supabase dashboard → Point-in-Time Recovery: ON |
| Z-02 | Hetzner S3 Object Lock (WORM) aktivovaný | `aws s3api get-object-lock-configuration --bucket <bucket>` |
| Z-03 | DR drill prebehol a bol zdokumentovaný | Záznamy v `docs/DISASTER_RECOVERY_RUNBOOK.md` |

### 3.4 Funkčnosť

| # | Podmienka | Overenie |
|---|-----------|---------|
| F-01 | Nahratie dôkazu → SHA-256 overenie → ForenZX analýza end-to-end | E2E test alebo manuálny smoke test so staging fixture |
| F-02 | PDF dossier export s manifestom a SHA-256 | Manuálny export → JSON manifest prítomný |
| F-03 | Audit log zaznamená každú operáciu s dôkazom | DB query na `case_audit_log` po teste F-01 |

## 4. Právna a organizačná pripravenosť

| # | Podmienka |
|---|-----------|
| L-01 | DPIA (Data Protection Impact Assessment) vypracované a schválené |
| L-02 | Právny posudok PDF dossier použiteľnosti v súdnom konaní |
| L-03 | Procesný pokyn pre vyšetrovateľov podpísaný |
| L-04 | Incident response postup pre kompromitáciu dôkazov zdokumentovaný |

## 5. GO / NO-GO rozhodnutie

### 5.1 Hlasovanie

GO vyžaduje jednohlasný súhlas:
- technického správcu systému (youh4ck3dme),
- zodpovedného vyšetrovateľa,
- právneho zástupcu organizácie.

### 5.2 Formálny záznam

Po splnení všetkých podmienok sa GO stav zaznamenáva v `docs/PILOT-GO-CHAIN-OF-CUSTODY-PROTOCOL.md`. Dokument obsahuje dátum, verziu commitu (`git rev-parse HEAD`), zoznam overených podmienok a podpisy zodpovedných osôb.

Ak je ktorákoľvek podmienka nesplnená, stav zostáva `NO-GO` a pokračuje sa opravou blokerov.

## 6. Obmedzenia pilota

- Pilot sa vykonáva výhradne na uzatvorených prípadoch alebo testovacích prípadoch so súhlasom dotknutých osôb.
- Žiadne reálne citlivé dôkazy sa nesmú testovať bez právneho súhlasu.
- Rollback: pri kritickom incidente sa systém deaktivuje a záloha z Supabase PITR sa obnoví podľa `docs/DISASTER_RECOVERY_RUNBOOK.md`.

---

*Posledná aktualizácia: 2026-10-03*
