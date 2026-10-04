# P0-06 — Plán obnovy po havárii (Disaster Recovery Runbook)

> **Cieľ:** Obnova kritických operácií PΛND0RΛ Forensic OS s RTO < 15 minút a RPO < 1 minúta.  
> **Klasifikácia:** Dôverné / Prísne operačné (Forensic Evidence Integrity & Court Readiness).  
> **Platnosť pre:** Vercel, Supabase PostgreSQL, Hetzner S3 Evidence Vault, VPS Docker Stack.

---

## 1. Postup PITR (Point-in-Time Recovery) pre Supabase PostgreSQL

V prípade poškodenia integrity databázy, neoprávneného zásahu alebo zlyhania disku sa vykoná okamžitá obnova stavu k presnému časovému bodu (pred incidentom).

### Krok 1.1 — Identifikácia bodu zlyhania
Určite presný UTC timestamp incidentu zo záznamov v `public.case_audit_log` alebo `public.error_logs`:
```bash
# Zistenie posledného dôveryhodného záznamu pred incidentom (nahraďte $DB_URL)
psql "$DB_URL" -c "
  SELECT created_at, action, table_name, record_id 
  FROM public.case_audit_log 
  ORDER BY created_at DESC 
  LIMIT 5;"
```

### Krok 1.2 — Spustenie PITR cez Supabase CLI / Management API
```bash
# 1. Zastavenie produkčných prístupov (aktivácia údržbového módu na reverznom proxy)
# Na VPS / Nginx:
sudo systemctl stop nginx-pandora || docker-compose -f docker-compose.production.yml stop app

# 2. Spustenie PITR obnovy projektu cez Supabase CLI (nahraďte $PROJECT_REF a $RECOVERY_TIMESTAMP)
# Formát timestampu: YYYY-MM-DDTHH:MM:SSZ (napr. 2026-09-27T21:45:00Z)
npx supabase backup restore \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --timestamp "2026-09-27T21:45:00Z"

# 3. Overenie stavu obnovenej databázy
npx supabase status --project-ref "$SUPABASE_PROJECT_REF"
```

### Krok 1.3 — Verifikácia integrity schémy po PITR
Po dokončení obnovy okamžite spustite overenie databázy:
```bash
# Spustenie automatizovaného testovacieho balíka PGlite / Supabase testov
npx vitest run supabase/tests/
```

---

## 2. Obnova S3 Evidence Vault a verifikácia WORM integrity

Trezor dôkazov (`evidence_items`) funguje v režime **WORM** (Write Once, Read Many). Ak dôjde k výpadku alebo zlyhaniu objektového úložiska:

### Krok 2.1 — Audit zhody hashu SHA-256
Spustite server-side audit hashu proti fyzickému S3 úložisku:
```bash
# Hromadná verifikácia SHA-256 pre všetky aktívne dôkazy daného prípadu
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"caseId": "UUID_PRIPADU"}' \
  https://pandora.whoiswho.at/api/vault/verify
```

### Krok 2.2 — Detekcia integrity
- Ak je `hash_verification_status = 'verified'`: Reťazec dôkazov je neporušený.
- Ak je `hash_verification_status = 'mismatch'`:
  1. Okamžite nastavte prípad do stavu **Legal Hold**:
     ```sql
     SELECT set_case_status('UUID_PRIPADU', 'legal_hold', 'Zistená nezhoda SHA-256 hashu dôkazu');
     ```
  2. Objekt bol v S3 zmenený alebo poškodený. Obnovte verziu objektu zo zrkadleného S3 bucketu s Object Lock ochranou.
  3. Spustite opätovnú verifikáciu. Priamy `UPDATE` alebo `DELETE` je blokovaný triggerom `evidence_items_worm_guard()`.

---

## 3. Scenár núdzovej rotácie uniknutých kľúčov (Secret Rotation)

Ak dôjde k podozreniu na kompromitáciu prístupových údajov, vykonajte okamžitú rotáciu v tomto presnom poradí:

### Krok 3.1 — Supabase Service Role Key & Database Password
1. Otvorte **Supabase Dashboard -> Project Settings -> API**.
2. Kliknite na **Rotate `service_role` secret**. (Vygeneruje nový kľúč, starý kľúč ihneď zneplatní).
3. Prejdite na **Database -> Reset database password**.

### Krok 3.2 — S3 Access Keys (Hetzner / AWS)
1. V administračnej konzole S3 (Hetzner Cloud Console / AWS IAM) vytvorte nový `S3_ACCESS_KEY_ID` a `S3_SECRET_ACCESS_KEY`.
2. Starý kľúč zatiaľ nedeaktivujte (ponechajte 5-minútové okno na dokončenie bežiacich multipart uploadov).

### Krok 3.3 — AI API kľúče (Mistral / Gemini)
1. Vygenerujte nový kľúč v Mistral Console (`MISTRAL_API_KEY`).
2. Vygenerujte nový kľúč v Google AI Studio (`GEMINI_API_KEY`).

### Krok 3.4 — Aplikácia do produkčného prostredia
```bash
# A) Aktualizácia Vercel produkčného prostredia (ak je nasadené na Vercel):
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add S3_ACCESS_KEY_ID production
vercel env add S3_SECRET_ACCESS_KEY production
vercel env add MISTRAL_API_KEY production
vercel redeploy --prod

# B) Aktualizácia VPS prostredia:
# Upravte súbor .env.production na VPS
chmod 600 .env.production
# Reštartujte Docker stack s novými premennými
docker-compose -f docker-compose.production.yml up -d --force-recreate app

# C) Validácia konfigurácie novým preflightom:
npm run verify:vercel-env -- --strict
```

### Krok 3.5 — Deaktivácia starých kľúčov
Po úspešnom preflight overení zmažte staré S3 kľúče a staré Mistral tokeny.

---

## 4. Kontrolný checklist obnovy a protokol reťazca dôkazov (Chain of Custody)

| Krok | Úkon | Zodpovedná osoba | Stav |
|---|---|---|---|
| 1. | Zastavenie prevádzky / aktivácia maintenance okna | Incident Commander | [ ] HOTOVO |
| 2. | Záloha poškodeného stavu (forenzný snapshot disku & DB dump) | DevOps Lead | [ ] HOTOVO |
| 3. | PITR obnova databázy k bezpečnému timestampu | Database Admin | [ ] HOTOVO |
| 4. | Validácia WORM hashu SHA-256 pre všetky dotknuté súbory | Forensic Lead | [ ] HOTOVO |
| 5. | Rotácia všetkých produkčných kľúčov a hesiel | Security Officer | [ ] HOTOVO |
| 6. | Spustenie automatizovaného overenia `scripts/ci/run-performance-budget.mjs` | QA Engineer | [ ] HOTOVO |
| 7. | Spustenie integrity testov `npx vitest run supabase/tests/` | QA Engineer | [ ] HOTOVO |
| 8. | Uvoľnenie údržbového módu a obnova prevádzky | Incident Commander | [ ] HOTOVO |

### Protokol o obnovení integrity (Chain of Custody Certificate)

```text
Dátum a čas incidentu (UTC): __________________________________________________
Obnovený bod v čase (PITR UTC): _____________________________________________
Počet auditovaných dôkazových položiek: _______________________________________
Výsledok verifikácie SHA-256 hashu: [ ] 100% ZHODA  [ ] ZISTENÉ ANOMÁLIE
Podpis veliteľa incidentu (Incident Commander): _______________________________
Forenzný overovateľ (Lead Forensic Auditor): __________________________________
```
