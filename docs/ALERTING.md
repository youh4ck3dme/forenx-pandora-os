# P0-04 — Alerting & Operačný runbook

Zdroj pravdy pre operatívne metriky PANDORA ForenX OS. Endpoint
`GET /api/health/observe` (iba administrátor) vracia agregáty za 24 h
(`public.health_metrics()`) aj s vyhodnotenými alert prahmi.

## Alert prahy

| Alert | Prah | Zdroj dát | Závažnosť |
|---|---|---|---|
| `ai_timeouts_over_60s` | akékoľvek AI volanie > 60 s (alebo `error_code = 'timeout'`) v okne 24 h | `ai_usage` | vysoká |
| `s3_failure_rate_over_1pct` | > 1 % dôkazov v stave `mismatch` / `object_missing` / `error` v okne 24 h | `evidence_items` | kritická |
| `supabase_errors_high` | >= 10 záznamov v `error_logs` za 24 h | `error_logs` | stredná |

## Dotaz na metriky

```bash
# Administrátorská relácia (Bearer token z prihlásenia)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://pandora.whoiswho.at/api/health/observe | jq '.metrics.alerts'
```

Odpoveď obsahuje `window_hours`, `generated_at`, sekcie `ai`, `s3`,
`supabase` a `alerts` (booleovské vyhodnotenie prahov).

## Frontend error reporting

Klient posiela neošetrené chyby (`window.onerror`, `unhandledrejection`,
React error boundary) na `POST /api/health/observe`. Server pred zápisom do
`error_logs` (source `client`) každé hlásenie prečistí — redakcia PII
(rodné čísla, IBAN, mená svedkov…) a maskovanie bearer tokenov / API kľúčov
(`sanitizeForLog`). Rate limit: 10 hlásení / používateľ / minúta (429).

## Postup pri alerte (response runbook)

### 1. AI timeouty > 60 s (`ai_timeouts_over_60s: true`)

1. Over rozsah: `metrics.ai.timeouts_over_60s` a `metrics.ai.failure_rate_percent`.
2. Skontroluj `FORENX_AI_WORKER_URL` / Mistral dostupnosť (VPS worker
   `/v1/mistral/chat` odozva, priamy endpoint 429/503).
3. Ak ide o jednorazový zásek (Retry-After), potvrď normalizáciu v ďalšom
   okne 24 h — žiadna akcia.
4. Opakované timeouty: zváž prechod analysis volaní výhradne cez VPS worker
   (proxy_read_timeout 300 s) a zvýš `MISTRAL_API_TIMEOUT_MS`.

### 2. S3 failure rate > 1 % (`s3_failure_rate_over_1pct: true`)

1. **Kritické** — dotknuté sú dôkazy; hash `mismatch` znamená porušený
   alebo vymenený objekt v trezore.
2. Identifikuj postihnuté objekty (`evidence_items` kde
   `hash_verification_status in ('mismatch','object_missing')`).
3. Pri `mismatch`: okamžite nastav legal hold na prípad a začni incident
   (reťaz zabezpečenia bol fakticky narušený — audit log je zdroj súdu).
4. Pri `object_missing`: skontroluj Hetzner S3 ( bucket politiky, Outposts),
   prípadne reinstaluj objekt z archívu a preveľ override cez
   `/api/vault/verify` — nikdy manuálne v DB (WORM trigger to blokuje).

### 3. Supabase chyby (`supabase_errors_high: true`)

1. Skontroluj `error_logs` (route, severity, source) za okno 24 h.
2. Rozhodni podľa koncentrácie: jedna route = aplikačná chyba (bug report);
   rozptýlené = infraštruktúra (pooler, Postgres, sieť).
3. Pri databázovej nedostupnosti: over `db_health_stats()` (admin) a
   Supabase status; zváž failover komunikácie na priamy Postgres endpoint.

## Alert owner & eskalácia

| Úroveň | Owner | Kanál | Reakcia |
|---|---|---|---|
| Vysoká (AI timeouty) | prevádzkar aplikácie | e-mail + log monitoringu | do 4 h |
| Kritická (S3 integrity) | prevádzkar + zodpovedný vyšetrovateľ (admin) | telefón + e-mail | do 1 h, incident |
| Stredná (Supabase chyby) | prevádzkar aplikácie | e-mail | do 24 h |

Doporučenie: endpoint_GET /api/health/observe pripoj do externého uptime
monitora (UptimeRobot / Better Stack / cron na VPS) s intervalom 5 min —
`alerts.* === true` má spustiť notifikáciu na owner kanál.
