# PΛND0RΛ Forensic OS — Backlog Source of Truth

> **Status:** Authoritative  
> **Last reviewed:** 2026-09-27  
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
| Root TypeScript                        | `DONE`    | `npx tsc --noEmit` returned 0 errors after a completed Next build.                                                |
| Electron TypeScript and security suite | `DONE`    | Electron main/preload typechecks passed; `electron/__tests__` passed `17/17`.                                     |
| Main application tests                 | `DONE`    | `npx vitest run`: `349/349` passed across 51 test suites.                                                         |
| Core engine tests                      | `DONE`    | `npx vitest run`: `559/559` passed.                                                                               |
| Next production build                  | `DONE`    | `npm run build`: 30/30 routes generated.                                                                          |
| Core engine TypeScript                 | `DONE`    | Created worker/types bridge modules; `npx tsc --noEmit` returned 0 errors in core-engine.                         |
| Production dependency audit            | `DONE`    | `xlsx` removed completely; replaced by `read-excel-file/node` with multi-sheet support and 0 security advisories. |
| Supabase migration application         | `BLOCKED` | Supabase CLI/database access was unavailable; migrations have not been applied.                                   |
| VPS/Docker runtime verification        | `BLOCKED` | No production Docker manifest or VPS access is available in this workspace.                                       |

## 3. Release-critical P0 — security, deployment, and evidence integrity

### P0-01 — Domain, PR, TLS, and WebAuthn

**Status:** `BLOCKED`  
**What works:** Production templates use `NEXT_PUBLIC_RP_ID="whoiswho.at"`.

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

**Remaining acceptance criteria:**

- [ ] Apply and verify Supabase RLS policies for `evidence_items`.
- [ ] Upload a 250 MB fixture through the production presigned URL.
- [ ] Persist the post-upload evidence record transactionally.
- [ ] Verify rejected cross-case access with an authenticated attacker test.

### P0-04 — Monitoring, alerting, and operational visibility

**Status:** `TODO`

- [ ] Configure Sentry or equivalent frontend/server exception reporting.
- [ ] Alert on AI timeout over 60 seconds, S3 upload failure above 1%, and
      Supabase failures.
- [x] Add correlation/trace IDs to server-side audit-safe logs. Done: lib/forza/trace.ts
      (x-trace-id UUIDv4) wraps every Next.js API route, callMistral and the
      browser Mistral client, and every server-fn call gets context.traceId.
      traced* helpers sanitize logs (redactPii + masked bearer/API keys).
- [ ] Define alert owner, escalation channel, and response runbook.

### P0-05 — Headers and CSP

**Status:** `IN PROGRESS`  
**Done:**

- [x] Nginx template has 250 MB upload limit, request streaming, 500 second
      proxy timeouts, HSTS, `nosniff`, `DENY` framing, and permissions policy.
- [x] Next emits CSP Report-Only and browser security headers.

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
      timeline events and suspicious flows export as facts only when their
      sourceRef.documentId exists in analysisMeta.documentIds/custody ledger;
      unbound claims render in an explicit "nie sú skutkom" section.
- [ ] Add a WebAuthn-backed investigator signature and independently verify it.
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

### P2-03 — Terminology

**Status:** `IN PROGRESS`

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

**Status:** `TODO`

- [ ] Benchmark 5,000 graph nodes/edges at a defined target device and 60 FPS.
- [ ] Process 100,000-row CSV imports in chunks or a worker without blocking UI.
- [ ] Virtualize transaction lists over 10,000 rows.
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
| Atomic AI graph commit                 | `IN PROGRESS` | Apply and integration-test `commit_ai_case_graph` migration against Supabase.  |
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
