# P0-06 / P6 — Plán obnovy po havárii a bezpečná prevádzka (Disaster Recovery Runbook)

> **Ciele obnovy (SLA/DR):**  
> - **RPO (Recovery Point Objective):** najviac **15 minút** (maximálna strata posledných zmien).  
> - **RTO (Recovery Time Objective):** najviac **4 hodiny** (obnova plnej funkčnosti a overenie integrity).  
> **Klasifikácia:** Dôverné / Forenzná prevádzka (Forensic Evidence Integrity & Court Readiness).  
> **Platnosť pre:** Produkčný VPS Docker Stack (`:3005`), Apache reverzná proxy (`80/443`), Supabase PostgreSQL (`tlmuvzrgighahnjkxoyw`), Hetzner S3 Evidence Vault (`hel1.your-objectstorage.com`).

---

## 1. Architektonické oddelenie záloh

V súlade s forenzným invariantom repozitára platí:
> **Supabase databázová záloha NEOBSAHUJE S3 Storage objekty.**  
> Databáza eviduje metadata, SHA-256 hashe, ledger a prístupový audit. Samotné binárne dáta dôkazov žijú v Hetzner S3 trezore (`hel1.your-objectstorage.com`). Zálohovanie a obnova DB a S3 preto prebiehajú ako dva koordinované, no nezávislé procesy.

| Komponent | Metóda zálohovania | Frekvencia / RPO | Cieľ zálohy |
|---|---|---|---|
| **Supabase PostgreSQL** | Fyzický WAL archiving (PITR) + denný šifrovaný logický dump | RPO ≤ 15 min (PITR) | Supabase Cloud PITR infraštruktúra + off-site S3 cold storage |
| **Hetzner S3 Evidence Vault** | Object Lock (WORM) + rclone šifrované zrkadlenie | Priebežná replikácia | Sekundárny geograficky oddelený bucket s oddelenými credentials |
| **Aplikačná konfigurácia** | Git SHA release manifest + šifrovaný `.env.production` trezor | Pri každom release | Bezpečný správca tajomstiev (mimo VPS disku) |

---

## 2. Postup PITR (Point-in-Time Recovery) pre Supabase PostgreSQL

V prípade poškodenia integrity dát, neoprávneného zásahu alebo zlyhania databázového uzla sa vykoná obnova k presnému časovému bodu (pred incidentom).

### Krok 2.1 — Zastavenie prevádzky a údržbový mód
Aby sa predišlo zápisom nových operácií počas incidentu:
```bash
# 1. Pripojenie na produkčný VPS
ssh user@forenzx-vps

# 2. Aktivácia údržbového módu na Apache proxy (porty 80/443)
# Presmerovanie požiadaviek na statickú stránku /var/www/html/maintenance.html
sudo a2ensite 000-maintenance.conf && sudo a2dissite pandora.conf && sudo systemctl reload apache2

# 3. Zastavenie aplikačného kontajnera (port 3005)
cd /opt/pandora-os
docker-compose -f docker-compose.production.yml stop app
```

### Krok 2.2 — Identifikácia bezpečného bodu obnovy (UTC)
Určite presný UTC timestamp incidentu zo záznamov v auditnom ledgeri alebo error logoch:
```bash
# Zistenie posledného overeného stavu pred incidentom
psql "$DB_URL" -c "
  SELECT created_at, action, table_name, record_id 
  FROM public.case_audit_log 
  ORDER BY created_at DESC 
  LIMIT 10;"
```

### Krok 2.3 — Spustenie PITR obnovy
Obnova k bodu v čase sa spúšťa cez Supabase Management API alebo Supabase Dashboard:

**Možnosť A: Supabase Management API (Automatizovaná)**
```bash
# Nahraďte $SUPABASE_ACCESS_TOKEN, $PROJECT_REF a $RECOVERY_TIMESTAMP (ISO 8601 UTC)
curl -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/restore" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "recovery_time": "2026-10-01T14:30:00Z"
  }'
```

**Možnosť B: Supabase Dashboard (Manuálna)**
1. Prihláste sa do [Supabase Dashboard](https://supabase.com/dashboard/project/tlmuvzrgighahnjkxoyw).
2. Prejdite na **Database** → **Backups** → **Point in Time (PITR)**.
3. Zadajte zvolený čas v UTC a potvrďte akciu **Restore to point in time**.
4. Počkajte na dokončenie obnovy (stav projektu prejde z `RESTORING` do `ACTIVE`).

### Krok 2.4 — Kontrola schémy a spustenie integračných testov
Po obnove okamžite overte funkčnosť databázových funkcií a ledgeru:
```bash
# Spustenie testov integrity schémy a rate limiteru
npx vitest run supabase/tests/
```

---

## 3. Obnova S3 Evidence Vault a verifikácia WORM integrity

Trezor dôkazov (`evidence_items`) funguje v režime **WORM** (Write Once, Read Many). 

### Krok 3.1 — Server-side audit zhody SHA-256 hashu
Overte integritu všetkých binárnych objektov voči ledgery:
```bash
# Hromadná serverová verifikácia pre vybraný prípad
curl -X POST \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"caseId": "UUID_PRIPADU"}' \
  https://pandora.whoiswho.at/api/vault/verify
```

### Krok 3.2 — Riešenie detekovaných nezrovnalostí
- **`hash_verification_status = 'verified'`**: Reťazec dôkazov je neporušený, súbory na S3 zodpovedajú pôvodnému uploadu.
- **`hash_verification_status = 'mismatch'`**:
  1. Okamžite aktivujte **Legal Hold** pre dotknutý prípad:
     ```sql
     SELECT set_case_status('UUID_PRIPADU', 'legal_hold', 'Zistená nezhoda SHA-256 hashu dôkazu');
     ```
  2. Objekt bol v S3 poškodený alebo pozmenený. Obnovte verziu objektu zo zrkadleného sekundárneho bucketu s Object Lock ochranou:
     ```bash
     # Obnova konkrétneho objektu z off-site zrkadla
     rclone copy secondary-backup:vault-backup/cases/UUID_PRIPADU/ hetzner-s3:evidence-vault/cases/UUID_PRIPADU/
     ```
  3. Znova spustite verifikáciu. Priamy `UPDATE` alebo `DELETE` v databáze je blokovaný triggerom `evidence_items_worm_guard()`.

---

## 4. Scenár koordinovanej rotácie secrets (Secret Rotation)

Ak dôjde k podozreniu na kompromitáciu prístupových údajov, vykonajte koordinovanú rotáciu tak, aby **nedošlo k výpadku bežiacich uploadov**.

### Krok 4.1 — Hetzner S3 prístupové kľúče
1. V Hetzner Console vytvorte nový kľúčový pár (`S3_ACCESS_KEY_ID` a `S3_SECRET_ACCESS_KEY`).
2. **Ponechajte starý kľúč aktívny minimálne 15 minút** — bežiace multipart uploady a presigned URL musia dobehnúť.
3. Vložte nové kľúče do `.env.production` na VPS.
4. Po uplynutí 15 minút a overení nových uploadov starý kľúč v Hetzner Console zmažte.

### Krok 4.2 — Supabase Service Role Key & JWT Secret
1. V Supabase Dashboard (`Project Settings` → `API` / `JWT Settings`) vygenerujte nový `service_role` kľúč.
2. Aktualizujte konfiguráciu koordinovane pre:
   - PΛND0RΛ OS (`.env.production` na VPS)
   - EvidenceCore
   - Asynchrónny worker / MCP hub
3. Reštartujte aplikačné služby.

### Krok 4.3 — AI API kľúče (Mistral / Gemini)
1. Vygenerujte nový kľúč v Mistral Console (`MISTRAL_API_KEY`).
2. Vygenerujte nový kľúč v Google AI Studio (`GEMINI_API_KEY`).
3. Aktualizujte `.env.production` na VPS a overte spojenie cez `/api/health/public/`.
4. Zmažte staré kľúče v príslušných konzolách.

### Krok 4.4 — Aplikácia a overenie na VPS
```bash
# Na VPS:
chmod 600 /opt/pandora-os/.env.production

# Znovunačítanie kontajnera s novými premennými
docker-compose -f docker-compose.production.yml up -d --force-recreate app

# Overenie dostupnosti
curl -k https://127.0.0.1:3005/healthz
curl -k https://127.0.0.1:3005/api/health/public/

# Návrat Apache z údržbového módu
sudo a2dissite 000-maintenance.conf && sudo a2ensite pandora.conf && sudo systemctl reload apache2
```

---

## 5. Prevádzkové predpisy: retencia, prístup a incidenty

1. **Retencia dôkazov počas pilota:**
   - Počas pilota platí zákaz automatického alebo manuálneho mazania dôkazov z trezoru.
   - S3 bucket má aktívny versioning a Object Lock.
   - Skutočné vymazanie dát (napr. súdny príkaz na likvidáciu spisu) vyžaduje dvojitú autorizáciu (Lead Forensic Auditor + Incident Commander) a zápis do auditného ledgeru s právnym dôvodom.
2. **Pravidlá pre cloudovú AI:**
   - Pred odoslaním textov do modelu Mistral prebieha automatická redakcia PII a citlivých dát.
   - Používateľovi sa zobrazí rozsah odosielaných dát s povinným potvrdením.
   - Žiadne surové binárne dôkazy (napr. disk images, multimédiá) sa do cloudovej AI neposielajú.
   - Modely majú zmluvne garantované nezapracovávanie dát do trénovacích datasetov.
3. **Fail-Closed zásada pri incidente:**
   - Pri zlyhaní rate limiteru, výpadku databázy alebo nesúlade SHA-256 hashu systém operáciu zamietne (HTTP 503/429/403). Nikdy sa nepoužije neoverený bypass.

---

## 6. Kontrolný protokol obnovy (Chain of Custody Protocol)

| Krok | Úkon | Zodpovedná osoba | Stav |
|---|---|---|---|
| 1. | Aktivácia údržbového módu na Apache proxy | Incident Commander | [ ] HOTOVO |
| 2. | Zastavenie aplikačného kontajnera (`docker-compose stop app`) | DevOps Lead | [ ] HOTOVO |
| 3. | Forenzný snapshot VPS disku pred zásahom | DevOps Lead | [ ] HOTOVO |
| 4. | PITR obnova PostgreSQL databázy k bezpečnému timestampu | Database Admin | [ ] HOTOVO |
| 5. | Spustenie automatizovaných testov schémy (`vitest run supabase/tests/`) | QA Lead | [ ] HOTOVO |
| 6. | Audit a prepočet SHA-256 hashov S3 trezoru | Forensic Lead | [ ] HOTOVO |
| 7. | Koordinovaná rotácia kľúčov v `.env.production` | Security Officer | [ ] HOTOVO |
| 8. | Spustenie kontajnera a preflight overenie endpointov | DevOps Lead | [ ] HOTOVO |
| 9. | Deaktivácia údržbového módu a obnova prevádzky | Incident Commander | [ ] HOTOVO |

```text
================================================================================
          PΛND0RΛ FORENSIC OS — PROTOKOL O OBNOVENÍ INTEGRITY SPISOV
================================================================================
Dátum a čas incidentu (UTC):           _________________________________________
Požadovaný bod obnovy PITR (UTC):     _________________________________________
Doba obnovy (RTO dosiahnuté):          _____ hodín _____ minút (limit: 4 hodiny)
Strata dát (RPO dosiahnuté):           _____ minút (limit: 15 minút)
Počet auditovaných dôkazov:           _________________________________________
Výsledok overenia SHA-256 hashov:     [ ] 100% ZHODA   [ ] DETEKOVANÁ NEZHODA
Právny stav dotknutých prípadov:       [ ] AKTÍVNE      [ ] LEGAL HOLD

Podpis Incident Commander:             _________________________________________
Podpis Lead Forensic Auditor:          _________________________________________
Dátum podpisu:                         _________________________________________
================================================================================
```
