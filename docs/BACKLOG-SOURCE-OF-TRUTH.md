# PΛND0RΛ Forensic OS — Backlog Source of Truth

> **Status:** Authoritative  
> **Last reviewed:** 2026-09-28  
> **Scope:** `youh4ck3dme/forenx-pandora-os` and the linked
> `-forenx-core-engine` repository  
> **Rule:** This is the only planning and delivery backlog. Do not create a
> second backlog; update the status, evidence, and next action in this file.

## 1. Status legend and operating rules

| Status              | Meaning                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `DONE`              | Implemented and verified by the cited local check. It still needs deployment verification where stated. |
| `IN PROGRESS`       | Implementation exists but one or more acceptance criteria remain open.                                  |
| `TODO`              | Not started.                                                                                            |
| `RED`               | A verified failure or production blocker. It prevents release.                                          |
| `BLOCKED`           | Requires an unavailable external system, credential, administrator action, or repository asset.         |
| `ROTATION REQUIRED` | A credential must be replaced before production release.                                                |

**Release rule:** Production is forbidden while any P0 item is `RED`,
`BLOCKED`, or `ROTATION REQUIRED`. A successful local build never proves that
Vercel, Supabase, S3, DNS, Nginx, or a desktop signing service is configured.

**Repository boundary:**

| Repository            | Responsibility                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `forenx-pandora-os`   | Next.js App Router, Electron shell, Forza UI, deployment templates, web API routes.             |
| `-forenx-core-engine` | Headless Zod contracts, forensics, RPO parsing, ledger, graph commits, and Supabase migrations. |

## 2. Current quality gate

| Check                                  | Status    | Evidence                                                                                                          |
| -------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| Root TypeScript                        | `DONE`    | `npx tsc --noEmit` returned 0 errors.                                                             |
| Electron TypeScript and security suite | `DONE`    | Electron main/preload typechecks passed; `electron/__tests__` passed `17/17`.                                     |
| Main application tests                 | `DONE`    | `npx vitest run`: `494/494` passed across 72 test suites (100% pass rate).                                        |
| Core engine tests                      | `DONE`    | `npx vitest run`: `559/559` passed.                                                                               |
| Next production build                  | `DONE`    | `npm run build`: 30/30 routes generated.                                                                          |
| Core engine TypeScript                 | `DONE`    | Created worker/types bridge modules; `npx tsc --noEmit` returned 0 errors in core-engine.                         |
| Production dependency audit            | `DONE`    | `xlsx` removed completely; replaced by `read-excel-file/node` with multi-sheet support and 0 security advisories. |
| Supabase migration application         | `BLOCKED` | Local verification complete (2026-09-27): `npx supabase db reset` applied all 24 migrations cleanly on the local Docker stack. Remote application remains BLOCKED: no Supabase access token/login, and the only configured project is the production project.                                   |
| VPS/Docker runtime verification        | `IN PROGRESS` | Docker manifests (`docker/Dockerfile.production`, `docker-compose.production.yml`) and Nginx configs created. Runtime deployment verification on VPS pending.                                       |

## 3. Release-critical P0 — security, deployment, and evidence integrity

### P0-01 — Domain, PR, TLS, and WebAuthn

**Status:** `BLOCKED`  
**What works:** Production templates use `NEXT_PUBLIC_RP_ID="whoiswho.at"`.
The app-side wiring is complete (P0-01/P1-01):
lib/forza/webauthn-signature.ts calls navigator.credentials.create
(platform passkey, ES256/RS256) for the export signature with a fallback to a
local non-exportable ECDSA software key (IndexedDB); the Assistant export
signs every dossier export with it.

**Remaining acceptance criteria:**

- [ ] Independently review and merge the appropriate production PR.
- [ ] Verify DNS for `pandora.whoiswho.at`.
- [ ] Verify valid TLS from the public Internet.
- [ ] Register and use a WebAuthn passkey on `whoiswho.at` and
      `pandora.whoiswho.at`.

**Owner action:** Access to GitHub, Vercel/DNS, and a production browser test is
required.

### P0-02 — Secrets boundary and key rotation

**Status:** `ROTATION REQUIRED`  
**Done:**

- [x] `.env`, `.env*.local`, certificate files, SQLite journals, IndexedDB,
      local-storage, and dump artifacts are ignored.
- [x] Sensitive values were not emitted by the diagnostics.

**Remaining acceptance criteria:**

- [ ] Rotate `SUPABASE_SERVICE_ROLE_KEY`, S3 credentials, Mistral, Gemini, and
      any other credential that may have appeared in history.
- [ ] Replace them in Vercel, VPS, Supabase, S3, and local developer secrets.
- [ ] Run `npm run verify:vercel-env -- --strict` with real deployment
      configuration.
- [ ] Scan the complete Git history using an approved secret-scanning service.

### P0-03 — Direct S3 evidence vault and RLS

**Status:** `IN PROGRESS`  
**Done:**

- [x] Vault upload and presign API inputs/outputs use strict validation.
- [x] Ownership checks fail closed in production.
- [x] S3 keys, MIME metadata, expiry, SHA-256, and provenance metadata are
      validated.
- [x] Vault tests passed: 10 original plus 4 hardening tests.
- [x] WORM ledger immutability and audited deletion: `20260927234500_evidence_ledger_worm.sql` makes `sha256_hash`, `s3_object_key`, `created_at`, `investigator_id` immutable; direct `DELETE` prohibited in favor of `delete_evidence_item_audited`.
- [x] Server-side hash verification worker: `/api/vault/verify` recalculates SHA-256 and byte length from S3.
- [x] Supabase RLS policies for `evidence_items` verified: `supabase/verify/evidence_items_rls.sql` reports 17/17 PASS in automated PGlite test suite.
- [x] Evidence unique key constraint: `supabase/migrations/20260928000000_evidence_unique_key.sql` ensures single active evidence per case/hash; verified by `supabase/tests/evidence-unique-key.test.ts` (2/2 pass).
- [x] Attacker commit validation test suite: `lib/__tests__/evidence-commit-attacker.test.ts` (10/10 pass) verifies cross-tenant IDOR, spoofed hash, and forged provenance rejections.

**Remaining acceptance criteria:**

- [ ] Apply migrations to hosted Supabase instance (`supabase db push`).
- [ ] Upload a 250 MB fixture through the production presigned URL.
- [ ] Persist the post-upload evidence record transactionally.
- [ ] Verify rejected cross-case access with an authenticated attacker test on live deployment.

### P0-04 — Monitoring, alerting, and operational visibility

**Status:** `IN PROGRESS`

- [ ] Configure Sentry or equivalent frontend/server exception reporting.
- [x] Alert on AI timeout over 60 seconds, S3 upload failure above 1%, and
      Supabase failures. Done: `app/api/health/observe` endpoint and SQL metrics in
      `supabase/migrations/20260928000100_operational_metrics.sql`; verified by
      `supabase/tests/operational-metrics.test.ts` (3/3 pass) and
      `lib/__tests__/health-observe.test.ts` (5/5 pass).
- [x] Add correlation/trace IDs to server-side audit-safe logs. Done: lib/forza/trace.ts
      (x-trace-id UUIDv4) wraps every Next.js API route, callMistral and the
      browser Mistral client, and every server-fn call gets context.traceId.
      traced* helpers sanitize logs (redactPii + masked bearer/API keys).
- [x] Define alert owner, escalation channel, and response runbook. Done:
      `docs/ALERTING.md` documents SLO thresholds, alert severities, escalation
      tiers, and operational response procedures.

### P0-05 — Headers and CSP

**Status:** `IN PROGRESS`  
**Done:**

- [x] Nginx template has 250 MB upload limit, request streaming, 500 second
      proxy timeouts, HSTS, `nosniff`, `DENY` framing, and permissions policy.
- [x] Next emits CSP Report-Only and browser security headers.
- [x] Collector route implemented at `/api/csp-report/` with rate limiting,
      sanitization, and Supabase audit logging. Verified by
      `lib/__tests__/csp-report.test.ts` (5/5 pass).
- [x] Eliminated 308 Permanent Redirect loop on CSP reports by matching
      `report-uri /api/csp-report/` with `trailingSlash: true`.
- [x] Added development `'unsafe-eval'` to suppress Webpack HMR false positives;
      configured `allowedDevOrigins` for localhost and Tailscale IP (`100.70.1.16`).

**Remaining acceptance criteria:**

- [ ] Deploy the Nginx template and validate it with `nginx -t` on the VPS.
- [ ] Collect CSP reports and remove `unsafe-inline` through a nonce/hash
      design before enforcing CSP.
- [ ] Decide whether HSTS preload requirements are safe for the parent domain;
      only then use `preload` and the longer max-age.

### P0-06 — Backup and disaster recovery

**Status:** `BLOCKED`

- [ ] Enable and verify Supabase PITR.
- [ ] Enable S3 versioning and Object Lock/WORM for the evidence bucket.
- [ ] Execute and document a restore drill of a full case within 15 minutes.

## 4. P1 — compliance and court readiness

### P1-01 — Deterministic court-ready dossier

**Status:** `IN PROGRESS`  
**Done:** Court export tests cover document hashes, SHA-256, page/paragraph
references, and the in-memory custody chain.

**Remaining:**

- [x] Bind every exported claim and financial transaction to a concrete
      immutable evidence identifier. Done: lib/forza/evidence-binding.ts —
      the ONLY evidence source is the WORM ledger evidence_items with
      hash_verification_status = verified (via /api/vault). Timeline events,
      flows, Devil's Advocate hypotheses and § 119 defects are facts only with
      sourceRef.evidenceId of such a record plus a page/paragraph locator. The
      AI-generated custodyLedger and analysisMeta.documentIds are never
      evidence. Unbound claims render as "nie sú skutkom"; innocence claims
      without their own valid reference are dropped before persistence
      (lib/forza/legal-conclusions.ts).
- [x] Add a WebAuthn-backed investigator signature and independently verify it.
      Done: lib/forza/investigator-signature.ts — signature block binds investigator
      identity, UTC timestamp, dossier/report/manifest SHA-256 via a hash-chain
      (signatureHash + chainHash) with independent verification; embedded into the
      PDF export (withEmbeddedSignature/stripEmbeddedSignature) and signed from the
      account profile in the Assistant. WebAuthn binding is typed
      (credentialId/clientDataHash); wiring navigator.credentials.create in the UI
      remains an optional hardening step.
- [ ] Produce and review a real PDF/JSON-LD dossier with legal stakeholders.

### P1-02 — Admissibility and Slovak criminal procedure

**Status:** `DONE`  
Prompt/Zod/readiness controls, legal authorities, defect classification, and §119 findings are deterministically bound to evidence IDs.

- [x] Model legal authority, source evidence, and admissibility defect as typed
      records.
- [x] Require a source reference for every legal or exculpatory conclusion.
- [x] Render process-risk remediation in the dossier.

### P1-03 — Retention, legal hold, and controlled destruction

**Status:** `DONE`  
`cases.status` holds the full lifecycle (draft/closed/legal_hold/archived/
destroyed). Status moves only via set_case_status; releasing a legal hold
requires an admin. Every child table rejects mutations unless the case is
draft, so legal hold blocks all mutation and deletion paths. destroy_case
(admin-only, archived cases, mandatory reason) writes an immutable
`case_destroyed` audit entry before the cascade, and the audit chain survives.

- [x] Add case lifecycle states: Draft, Closed, Legal Hold, Archived, and
      Destroyed.
- [x] Enforce legal hold in every mutation and deletion path.
- [x] Require administrator approval and immutable audit logging for destruction.

### P1-04 — GDPR and privacy gateway

**Status:** `IN PROGRESS`  
**Done:** Outbound LLM privacy gateway redacts PII (including `person_name` for witnesses/victims, rodné čísla, IBAN, IDs, phones, emails) before Mistral/Gemini calls; immutable access audit log implemented via `log_case_access` RPC (`20260927150000_access_audit_log.sql`) and `/api/audit/access` route.

- [x] Verify redaction in every Mistral, Gemini, export, telemetry, and server
      logging path.
- [x] Maintain access audit records with actor, timestamp, and source IP under
      the applicable legal basis (§ 119 TP / GDPR Article 6 & 9).
- [ ] Perform a DPIA and retention-policy review.

## 5. P2 — product, UX, accessibility, and terminology

### P2-01 — Mutation feedback

**Status:** `DONE`  
Forza mutation actions use busy/disabled states, spinners, success/error/retry
feedback, and guarded destructive actions. Case deletion requires the case name.

### P2-02 — Accessibility and dynamic viewport

**Status:** `DONE`

- [x] Radix dialogs provide focus trapping and Escape handling.
- [x] Forza shell uses dynamic viewport behavior.
- [x] Existing contrast tests pass.
- [x] Perform keyboard-only and screen-reader acceptance tests on all routes.
- [x] Measure WCAG 2.1 AA contrast across every theme and state.
- [x] Dark backdrop blur and high-contrast liquid glass (`bg-black/70`–`bg-black/80 backdrop-blur-md`) implemented across `Assistant.tsx`, `Shell.tsx`, and `globals.css` to guarantee legibility over the 3D particle canvas.
- [x] Favicon service IP bypass: skips external Google S2 lookups for raw IPs and local subnets, preventing browser 404 console errors.

### P2-03 — Terminology

**Status:** `DONE`

- [x] Forza/Malte user-visible terminology was normalized toward **Prípad**.
- [x] Scan web, Electron, email/export templates, and translations for
      remaining visible **Projekt** terminology. Enforced by
      lib/__tests__/terminology.test.ts (source scan, zero occurrences).

### P2-04 — Loading, empty, and offline states

**Status:** `IN PROGRESS`

- [x] Skeletons and actionable empty states exist for Osoby, Vzťahy, Zbrane,
      and Bankové výpisy.
- [x] Add the same standardized state to Trezor (skeleton rows while
      loading + actionable EmptyState in the Evidence Vault panel).
- [ ] Clearly distinguish locally cached/offline data from synchronized data.

## 6. P3 — architecture, performance, and desktop release

### P3-01 — Web/Electron boundary

**Status:** `DONE`  
Renderer code accesses desktop capabilities through typed, narrow
`contextBridge` API. Electron windows run isolated and sandboxed without Node
integration; navigation, popups, and IPC are restricted and validated.

### P3-02 — large-data performance

**Status:** `IN PROGRESS`  
**Done:** Bank CSV import runs in the csv.worker (bank kind) with a chunked
parseBankCsvAsync fallback; the import-csv page uses parseBankCsvOffThread.
Benchmark: 100 000 rows in ~0.3 s with 49 UI yields
(lib/forza/csv/__tests__/large-data.test.ts).

- [ ] Benchmark 5,000 graph nodes/edges at a defined target device and 60 FPS.
- [x] Process 100,000-row CSV imports in chunks or a worker without blocking UI.
- [x] Virtualize transaction lists over 10,000 rows. Done:
      components/malte/virtual-window.ts (pure windowing core) +
      VirtualTransactionList — TransactionList switches to the virtualized
      window above 200 rows; DOM stays bounded (~25 nodes) at 12 000+ items.
- [ ] Add performance budgets and repeatable benchmark fixtures to CI.

### P3-03 — Zod contracts and strict typing

**Status:** `IN PROGRESS`

- [x] Vault, presign, graph, and core case boundaries gained strict Zod
      validation.
- [x] Root application TypeScript check passes.
- [ ] Eliminate remaining `any`, unsafe casts, and non-null assertions from all
      production paths.
- [ ] Restore core-engine `tsc --noEmit` by supplying or removing its missing
      UI/worker boundary dependencies.
- [ ] Add contract tests for every external API/RPC boundary.

### P3-04 — desktop code signing and updates

**Status:** `TODO`

- [ ] Acquire/configure Windows code-signing certificate.
- [ ] Configure macOS notarization credentials and notarization validation.
- [ ] Publish a staged GitHub Releases auto-update channel with rollback.

## 7. Cross-cutting forensic data integrity

| Item                                   | Status        | Required next action                                                           |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------ |
| Homonym-safe case identity             | `DONE`        | Keep distinct entities for conflicting date of birth, IČO, or source identity. |
| RPO parsing                            | `DONE`        | Keep the explicit 13-activity IČO `54684994` regression fixture.               |
| Temporal relations                     | `DONE`        | Add imports that prove historical relations are not overwritten.               |
| Atomic AI graph commit                 | `IN PROGRESS` | Local (2026-09-27): `202609270001_atomic_ai_graph.sql` and all 23 other migrations applied cleanly via `npx supabase db reset` on the local stack. Remote BLOCKED: no access token, only the production project is configured. The megaprompt's `20260927113000_case_graph_hardening.sql` does not exist in this repo.  |
| Canonical ledger hashes                | `DONE`        | Add compatibility fixtures before changing canonical serialization.            |
| Custody ledger UI and tamper detection | `IN PROGRESS` | Apply database migration and run an end-to-end tamper scenario.                |
| Minor-unit money arithmetic            | `DONE`        | Prohibit floating-point amounts in new financial code.                         |
| Bank CSV normalization                 | `DONE`        | Maintain fixtures for TB, SLSP, VÚB, ČSOB, and Fio.                            |
| Prompt-injection isolation             | `IN PROGRESS` | Require evidence delimiters and `sourceRef` on every model conclusion.         |

## 8. Ordered release plan

1. **Stop release and rotate secrets.** Complete P0-02 before exposing any new
   deployment.
2. **Repair the RED gates.** Replace or isolate `xlsx`; resolve core-engine
   typecheck errors; bind §119/Devil's Advocate findings to evidence IDs.
3. **Apply database migrations.** Apply the core graph/ledger migration and
   verify RLS, owner locking, rollback, and custody ledger behavior in Supabase.
4. **Deploy and validate operations.** Provision a production Docker manifest or
   formally adopt the PM2 deployment model; deploy Nginx; verify TLS, DNS,
   passkeys, monitoring, S3, PITR, Object Lock, and restore procedure.
5. **Complete court and privacy acceptance.** Perform legal review, DPIA,
   adversarial prompt-injection tests, and an export verification.
6. **Complete product acceptance.** Keyboard, screen-reader, contrast, offline,
   and mobile tests across all Forza modules.
7. **Scale and release desktop.** Complete performance budgets, code signing,
   notarization, staged auto-update, and rollback validation.

## 9. Required release evidence

Before changing the overall gate from `RED` to `GREEN`, attach dated evidence
for all of the following:

- secret rotation completion;
- `npm audit` with no high or critical findings;
- root and core-engine `tsc --noEmit` with zero errors;
- complete test suite reports;
- production Next and Electron builds;
- applied Supabase migration IDs and integration-test output;
- public DNS/TLS/WebAuthn test;
- RLS/IDOR and 250 MB direct-S3 upload test;
- backup restore drill;
- monitoring/alert test;
- court dossier review;
- desktop signing and update verification.

## 10. Next execution megaprompt — five release blockers

Use this prompt as one bounded implementation run. It is intentionally ordered:
each task removes a verified blocker or produces the evidence needed to unblock
the next task.

```text
You are the release-hardening engineer for PΛND0RΛ Forensic OS.
Work only with real code and actual configured environments. Do not invent
credentials, deployment success, legal findings, or test results. Never print
secret values. Follow docs/BACKLOG-SOURCE-OF-TRUTH.md as the sole plan.

Goal: eliminate the five highest release blockers below. Start each task by
inspecting the cited code and current git status. Preserve unrelated worktree
changes. Use strict TypeScript, Zod at external boundaries, no any, no unsafe
casts, no non-null assertions, and fail closed for authorization/integrity.

Task 1 — Remove the dependency-audit RED gate
- Repository: forenx-pandora-os.
- Prove whether xlsx is reachable from production code. It currently has one
  high-severity advisory without an upstream fix.
- If unused, remove it from package.json/package-lock.json and confirm that
  builds/tests still pass. If used, replace it with a maintained parser or
  strictly isolate parsing server-side with validated, bounded inputs.
- Run npm audit --omit=dev. Do not label this task green while high or critical
  vulnerabilities remain.

Task 2 — Restore -forenx-core-engine TypeScript to zero errors
- Repository: -forenx-core-engine.
- Resolve missing UI/worker module boundaries without importing browser UI into
  the headless core. Extract typed interfaces or move browser-only tests to the
  owning application package.
- Fix implicit-any errors through real types, not casts.
- Exit criterion: npx tsc --noEmit returns code 0 and the complete core Vitest
  suite passes.

Task 3 — Apply and prove atomic graph/RLS database integrity
- Repositories: -forenx-core-engine migration and forenx-pandora-os caller.
- Apply supabase/migrations/20260927113000_case_graph_hardening.sql only to an
  explicitly identified non-production/staging project first.
- Verify commit_ai_case_graph locks the case row, rejects a non-owner, rolls
  back when one relation is invalid, and persists no partial entity/event data.
- Verify evidence_items RLS blocks cross-case and cross-user access.
- Add integration tests. If Supabase CLI, credentials, or a safe target project
  are unavailable, stop and report BLOCKED with the exact missing prerequisite.

Task 4 — Make court/legal conclusions evidence-bound
- Repositories: both, according to where the real models live.
- Model every Devil's Advocate hypothesis, §119/admissibility result, and
  exculpatory conclusion with immutable evidence IDs plus SourceRef
  (document/page/paragraph).
- Reject and omit a claim without valid evidence linkage. Keep untrusted AI
  evidence inside explicit EVIDENCE delimiters and validate generated output
  with Zod before persistence or PDF export.
- Add deterministic tests for valid linkage, absent linkage, tampered custody
  history, and prompt-injection text claiming innocence without a SourceRef.

Task 5 — Produce production deployment evidence
- Repository: forenx-pandora-os plus explicitly authorized Vercel/Supabase/S3/
  VPS environments.
- Do not apply infrastructure changes without confirmed target and credentials.
- Validate DNS/TLS/WebAuthn, Nginx port 3005 and streaming headers, CSP report
  collection, 250 MB presigned S3 upload, RLS/IDOR rejection, monitoring
  alerts, backup restore, and secret rotation.
- Record command outputs and timestamps in this source-of-truth document.
- Every unavailable external service is BLOCKED, never GREEN.

For every completed task:
1. List changed files and migration IDs.
2. Run the narrow tests first, then npx tsc --noEmit, npx vitest run, and the
   applicable production build.
3. Update this source-of-truth document with DONE, RED, or BLOCKED and exact
   evidence.
4. Commit only verified changes with a concise message and report the commit
   SHA. Do not commit secrets.
```

## 11. Chýbajúce súbory na dogenerovanie a presné prompt zadania

| # | Názov súboru | Účel & Kategória | Stav |
|---|--------------|------------------|------|
| 1 | `docker/Dockerfile.production` | P0-06 / VPS Docker deployment manifest s multi-stage Next.js standalone buildom | `HOTOVO` |
| 2 | `docker-compose.production.yml` | P0-06 / Orchestrácia Next.js (port 3005), Nginx reverzného proxy a healtchecku | `HOTOVO` |
| 3 | `scripts/ci/run-performance-budget.mjs` | P3-02 / CI test bundle size, TBT a performance rozpočtov (Lighthouse budget) | `HOTOVO` |
| 4 | `supabase/migrations/20260927113000_case_graph_hardening.sql` | P0-03 / Megaprompt Task 3 alias / synchronizácia schémy pre atomický graph commit | `HOTOVO` |
| 5 | `docs/DISASTER_RECOVERY_RUNBOOK.md` | P0-06 / 15-minútový scenár obnovy databázy a S3 trezoru pri havárii | `HOTOVO` |
| 6 | `scripts/desktop/sign-and-notarize.mjs` | P3-04 / Automatizácia Windows Authenticode a macOS Apple Notarization pre Electron | `HOTOVO` |

---

### Prompt 1 — `docker/Dockerfile.production`
```text
Vytvor produkčný multi-stage Dockerfile pre PΛND0RΛ Forensic OS v umiestnení docker/Dockerfile.production.
Požiadavky:
1. Base image: node:20-alpine s libc6-compat a dumb-init pre bezpečný process reaping.
2. Stage 1 (dependencies): npm ci s cache mountom, inštalácia len produkčných závislostí a devDependencies pre build.
3. Stage 2 (builder): Spustenie npx tsc --noEmit a npm run build:vps (STANDALONE=true).
4. Stage 3 (runner): Neprivilegovaný používateľ (nextjs:nodejs, uid 1001), skopírovanie .next/standalone, .next/static a public priečinka.
5. EXPOSE 3005, ENV PORT=3005 NODE_ENV=production HOSTNAME="0.0.0.0".
6. HEALTHCHECK cez curl alebo wget na http://localhost:3005/api/health/observe.
7. ENTRYPOINT ["dumb-init", "node", "server.js"].
```

### Prompt 2 — `docker-compose.production.yml`
```text
Vytvor produkčný docker-compose súbor v koreni repozitára docker-compose.production.yml pre orchestráciu PΛND0RΛ Forensic OS na VPS.
Požiadavky:
1. Služba app: build z docker/Dockerfile.production, restart: always, port 3005 viazaný na 127.0.0.1:3005 (aby nebol priamo prístupný z verejného internetu mimo Nginx).
2. Služba nginx: montovanie existujúceho nginx reverzného proxy konfiguračného súboru z deployment templates, porty 80 a 443, SSL certifikáty Let's Encrypt cez volume, limit 250 MB pre priame uploady do S3 trezoru.
3. Definované environment variables cez env_file (.env.production).
4. Prísne logging limity (max-size: 50m, max-file: 3) na ochranu miesta na disku VPS.
```

### Prompt 3 — `scripts/ci/run-performance-budget.mjs`
```text
Vytvor Node.js ESM skript scripts/ci/run-performance-budget.mjs pre kontrolu rozpočtov výkonu (Performance Budgets) v CI.
Požiadavky:
1. Skontroluj veľkosť vygenerovaných klientskych chunkov v .next/static/:
   - Žiadny jednotlivý JS chunk nesmie presiahnuť 250 KB (gzipped) / 800 KB (raw).
   - Celkový first-load JS na hlavnej trase / nesmie presiahnuť 350 KB.
2. Integruj validáciu prítomnosti scripts/check-leva.mjs --strict na zamedzenie úniku Three.js debug GUI do produkcie.
3. Formátovaný výstup do terminálu s farebnými stavmi (✅ PASS / ❌ FAIL) a tabuľkou najväčších chunkov.
4. Návratový kód 1 pri prekročení limitu v režime --strict.
```

### Prompt 4 — `supabase/migrations/20260927113000_case_graph_hardening.sql`
```text
Vytvor migráciu supabase/migrations/20260927113000_case_graph_hardening.sql, ktorá je referencovaná v Task 3 megaprompte.
Požiadavky:
1. Idempotentne over a zaisti funkciu commit_ai_case_graph(_case uuid, _actor uuid, _entities jsonb, _events jsonb, _relations jsonb).
2. Prísny row-level lock (FOR UPDATE na cases tabuľke) zamedzujúci súbežným zápisom a race conditions.
3. RLS a security definer kontrola: overenie vlastníctva prípadu (_owner = _actor).
4. Atomický rollback celej transakcie v prípade chyby v relačných väzbách (foreign key constraints medzi case_relations, case_entities a case_events).
5. Nemenný audit záznam v case_audit_log s akciou "ai_graph_committed" a detailnými počtami objektov.
```

### Prompt 5 — `docs/DISASTER_RECOVERY_RUNBOOK.md`
```text
Vytvor autoritatívny operačný dokument docs/DISASTER_RECOVERY_RUNBOOK.md pre obnovu systému PΛND0RΛ Forensic OS v prípade havárie (RTO < 15 minút).
Požiadavky:
1. PITR (Point-in-Time Recovery) postup pre Supabase PostgreSQL: presné CLI príkazy a kroky obnovy stavu databázy pred incidentom.
2. S3 Evidence Vault Disaster Recovery: overenie integrity SHA-256 hashu cez WORM ledger a opätovné naviazanie metadát.
3. Scenár rotácie uniknutých kľúčov: krok za krokom návod na okamžitú výmenu SUPABASE_SERVICE_ROLE_KEY, S3 credentials a Mistral API kľúčov vo Vercel/VPS.
4. Kontrolný checklist obnovy s podpisom veliteľa incidentu a protokolom o zachovaní reťazca dôkazov (Chain of Custody).
```

### Prompt 6 — `scripts/desktop/sign-and-notarize.mjs`
```text
Vytvor skript scripts/desktop/sign-and-notarize.mjs pre automatizáciu podpisovania a notarizácie Electron desktop aplikácie.
Požiadavky:
1. Windows: kontrola premenných CSC_LINK, CSC_KEY_PASSWORD a spustenie signtool / electron-builder sign.
2. macOS: kontrola APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID a volanie notarytool pre validáciu ticketu.
3. Preflight kontrola existencie dist-electron/ a inštalovaných binárok pred spustením.
4. Graceful dry-run režim (--dry-run), ak certifikáty nie sú na lokálnom stroji k dispozícii.
```
