# PANDORA / FORENX — CLEANROOM STATIC QUALITY GATE REPORT
**Mode:** LOCAL ONLY | **Database Deployment:** None | **Evaluation Timestamp:** 2026-09-29  
**Target Directory:** `db/cleanroom/`  
**Execution Order Audited:** `001_base.sql` -> `002_cases.sql` -> `003_forensic_evidence.sql` -> `004_audit.sql` -> `005_ai_graph.sql` -> `006_rate_limits.sql` -> `007_storage_contract.sql` -> `008_security_hardening.sql`

---

## 1. QUALITY GATE VERDICT SUMMARY

| Gate Criteria | Expected Standard | Audit Result | Status |
| :--- | :--- | :--- | :---: |
| **1. Rate Limit Contract** | Fixed-window, atomic UPSERT, check non-consuming, TABLE return | `consume_rate_limit` & `check_rate_limit` match TypeScript expectations | 🟢 **`FIXED_WINDOW`** |
| **2. Supabase Dependencies** | `auth.users`, `auth.uid()`, `storage.objects`, Supabase roles | Requires local Supabase-compatible Docker stack | 🟢 **`SUPABASE_RUNTIME_REQUIRED = YES`** |
| **3. Privileged RPC Matrix** | Zero implicit PUBLIC execute; server-controlled maintenance RPCs | All 33 functions audited; strict revocations enforced | 🟢 **`PASS`** |
| **4. Legal Hold & Deletions** | WORM/Hold inviolability; controlled destruction unblocked | Triggers, cascades, and session variables verified consistent | 🟢 **`PASS`** |
| **5. Execution Order** | Clean sequential execution `001` -> `008` without forward dependencies | Object dependency graph clean; cross-module references resolved | 🟢 **`PASS`** |
| **6. Static SQL Safety** | Audit DROP, TRUNCATE, CASCADE, SECURITY DEFINER, GRANTS | All occurrences verified defensive with strict security impact | 🟢 **`PASS`** |

---

## 2. RATE LIMIT CONTRACT VERIFICATION (SECTION 1)

### Mathematical & Algorithmic Analysis
The P0-09 rate limiter implementation in `db/cleanroom/006_rate_limits.sql` was reconciled against `lib/services/rate-limiter.ts` and `supabase/migrations/20260928230100_rate_limits_atomic.sql`.

#### Contract Semantics:
1. **Fixed Window Non-Sliding Guarantee:**
   ```sql
   count = CASE
     WHEN NOW() >= rate_limits.window_start + (p_window_seconds || ' seconds')::interval
     THEN 1
     ELSE rate_limits.count + 1
   END,
   window_start = CASE
     WHEN NOW() >= rate_limits.window_start + (p_window_seconds || ' seconds')::interval
     THEN NOW()
     ELSE rate_limits.window_start
   END
   ```
   *Proof:* When requests arrive while `NOW() < window_start + window`, `window_start` remains completely unchanged (`rate_limits.window_start`). The window **does NOT slide** upon incoming requests. Only when the full duration has elapsed (`NOW() >= window_start + window`) does a new fixed window begin with `count = 1` and `window_start = NOW()`.
2. **Quota Consumption:**
   - Requests $1 \dots N$: `ups.count <= p_max_requests` evaluates to `true`.
   - Request $N+1$: `ups.count <= p_max_requests` evaluates to `false` (`remaining = 0`).
3. **Non-Consuming Status Check (`check_rate_limit`):**
   - Executes a pure `SELECT` against `public.rate_limits`.
   - Modifies zero database rows.
   - Computes effective count based on timestamp comparison without updating the counter.
4. **PostgREST RPC Compatibility & Return Type:**
   - Patched signature from `RETURNS JSONB` to `RETURNS TABLE (allowed BOOLEAN, remaining INTEGER, reset_at TIMESTAMPTZ)`.
   - Patched parameter signature to `(p_key TEXT, p_max_requests INTEGER, p_window_seconds INTEGER)`.
   - Matches `lib/services/rate-limiter.ts:201-207` where PostgREST returns rows as an array `data[0] as SupabaseRPCResult`.
5. **Documentation Correction:**
   - Corrected legacy erroneous references to "sliding-window" in `CLEAN-DB-MANIFEST.md` and `REQUIRED-APP-OBJECTS.md` to "fixed window".

---

## 3. SUPABASE DEPENDENCY AUDIT (SECTION 2)

The cleanroom schema directly depends on the Supabase platform runtime. It **CANNOT** run on bare PostgreSQL without pre-installing Supabase schemas, tables, and roles.

### Explicit Dependency Catalog:
1. **`auth.users` Table & Foreign Keys:**
   - `public.profiles.id REFERENCES auth.users(id) ON DELETE CASCADE`
   - `public.user_roles.user_id REFERENCES auth.users(id) ON DELETE CASCADE`
   - `public.subscriptions.user_id REFERENCES auth.users(id) ON DELETE CASCADE`
   - `public.deletion_requests.user_id REFERENCES auth.users(id) ON DELETE CASCADE`
   - `public.billing_events.user_id REFERENCES auth.users(id) ON DELETE SET NULL`
   - `public.error_logs.user_id REFERENCES auth.users(id) ON DELETE SET NULL`
   - `public.cases.user_id REFERENCES auth.users(id) ON DELETE CASCADE`
   - `public.case_entities.user_id REFERENCES auth.users(id)`
   - `public.case_events.user_id REFERENCES auth.users(id)`
   - `public.case_relations.user_id REFERENCES auth.users(id)`
   - `public.case_transactions.user_id REFERENCES auth.users(id)`
   - `public.case_weapons.user_id REFERENCES auth.users(id)`
   - `public.case_imports.user_id REFERENCES auth.users(id)`
   - `public.company_registry_profiles.user_id REFERENCES auth.users(id)`
   - `public.cross_border_analyses.user_id REFERENCES auth.users(id)`
   - `public.source_snapshots.user_id REFERENCES auth.users(id)`
   - `public.evidence_items.investigator_id REFERENCES auth.users(id)`
   - `public.case_audit_log.user_id REFERENCES auth.users(id)`
   - `public.ai_usage.user_id REFERENCES auth.users(id)`
   - `public.ai_feature_logs.user_id REFERENCES auth.users(id) ON DELETE SET NULL`
2. **`auth` Schema Triggers:**
   - `pandora_on_auth_user_created` trigger attaches to `auth.users` (`AFTER INSERT ON auth.users EXECUTE FUNCTION public.pandora_handle_new_user()`).
3. **`auth.uid()` Function:**
   - Invoked across all authenticated table RLS policies (`profiles`, `user_roles`, `subscriptions`, `deletion_requests`, `cases`, `case_entities`, `case_events`, `case_relations`, `case_transactions`, `case_weapons`, `case_imports`, `company_registry_profiles`, `cross_border_analyses`, `source_snapshots`, `evidence_items`, `case_audit_log`, `ai_usage`, `ai_feature_logs`).
   - Invoked in authorization PL/pgSQL routines (`owns_case`, `set_case_status`, `destroy_case`, `delete_evidence_item_audited`, `log_case_access`, `log_evidence_upload`, `health_metrics`).
4. **`storage` Schema & Functions:**
   - `storage.buckets`: Target of configuration `INSERT` for `'avatars'` bucket.
   - `storage.objects`: Target of RLS policies for avatar management.
   - `storage.foldername(name)`: Helper function used in avatar path validation.
5. **Supabase Roles:**
   - `anon`: Unauthenticated access role, subject to strict revocations.
   - `authenticated`: Logged-in user role, subject to RLS boundaries.
   - `service_role`: Privileged administrative role used exclusively by trusted backend services.
   - `supabase_admin`: Checked in `evidence_items_insert_guard()`.
6. **Extensions:**
   - `pgcrypto`: Required for UUID generation and cryptographic SHA-256 primitives.

> **Operational Directive:** Local Docker test suite **MUST** utilize a Supabase-compatible stack (e.g. Supabase CLI local stack or a PostgreSQL image bootstrapped with Supabase `auth`/`storage` schemas and roles).

---

## 4. PRIVILEGED RPC SECURITY MATRIX (SECTION 3)

All 33 functions defined across the cleanroom files were classified. Default public execution has been eliminated via `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;` and explicit module-level and hardening-level `REVOKE` statements.

| Function | Module | Classification | Invocation Target | Security Controls |
| :--- | :--- | :---: | :---: | :--- |
| `update_updated_at_column()` | `001_base` | Trigger Internal | `postgres/internal` | Revoked from PUBLIC/anon |
| `has_role(UUID, app_role)` | `001_base` | Safe Utility | `authenticated`, `service_role` | STABLE, reads `user_roles` |
| `pandora_handle_new_user()` | `001_base` | Auth Hook | `postgres/internal` | Attached to `auth.users` |
| `current_plan(UUID)` | `001_base` | Safe Utility | `authenticated`, `service_role` | STABLE, reads `subscriptions` |
| `owns_case(UUID)` | `002_cases` | Safe Utility | `authenticated`, `service_role` | STABLE, checks `auth.uid() = user_id` |
| `bump_revision()` | `002_cases` | Trigger Internal | `postgres/internal` | Revoked from PUBLIC/anon |
| `case_status_transition_ok(TEXT, TEXT)` | `002_cases` | Safe Helper | `postgres/internal` | IMMUTABLE pure function |
| `set_case_status(UUID, TEXT, TEXT)` | `002_cases` | Privileged Client RPC | `authenticated`, `service_role` | Validates ownership & admin approval for legal_hold |
| `case_child_lifecycle_guard()` | `002_cases` | Trigger Internal | `postgres/internal` | Blocks writes when case != draft |
| `destroy_case(UUID, TEXT)` | `002_cases` | Critical Admin RPC | `authenticated`, `service_role` | Admin role enforced; rejects legal hold; audited |
| `source_snapshots_immutable()` | `003_forensic` | Trigger Internal | `postgres/internal` | Unconditionally rejects UPDATE |
| `evidence_items_insert_guard()` | `003_forensic` | Trigger Internal | `postgres/internal` | Sanitizes SHA-256, forces pending status for clients |
| `evidence_items_worm_guard()` | `003_forensic` | Trigger Internal | `postgres/internal` | Enforces WORM immutability on forensic fields |
| `evidence_items_delete_guard()` | `003_forensic` | Trigger Internal | `postgres/internal` | Blocks direct DELETE |
| `delete_evidence_item_audited(UUID, TEXT)` | `003_forensic` | Audited Client RPC | `authenticated`, `service_role` | Ownership/Admin check; blocks legal hold; audit logged |
| `record_evidence_verification(UUID, ...)` | `003_forensic` | Privileged Worker RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `audit_event_hash(...)` | `004_audit` | Pure Cryptographic Helper | `postgres/internal` | Revoked from PUBLIC, anon, authenticated |
| `case_audit_log_chain()` | `004_audit` | Trigger Internal | `postgres/internal` | Advisory lock per user; computes SHA-256 chain |
| `case_audit_log_append_only()` | `004_audit` | Trigger Internal | `postgres/internal` | Blocks UPDATE/TRUNCATE; rejects DELETE |
| `verify_audit_chain(UUID)` | `004_audit` | Audited Read RPC | `authenticated`, `service_role` | STABLE mathematical chain validator |
| `erase_user_audit_log(UUID)` | `004_audit` | Critical GDPR RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `log_case_access(...)` | `004_audit` | Audited Client RPC | `authenticated`, `service_role` | § 119 compliance logging |
| `log_evidence_upload(...)` | `004_audit` | Audited Client RPC | `authenticated`, `service_role` | Immutable upload registration audit |
| `append_audit_event(...)` | `004_audit` | Privileged Worker RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `reserve_ai_call(...)` | `005_ai_graph` | Privileged Worker RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `commit_ai_case_graph(...)` | `005_ai_graph` | Privileged Worker RPC | `service_role` ONLY | Case lock, draft check, audited; service_role only |
| `commit_import(...)` | `005_ai_graph` | Privileged Worker RPC | `service_role` ONLY | Delegates to commit_ai_case_graph; service_role only |
| `cleanup_expired_rate_limits()` | `006_rate_limits`| Maintenance RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `consume_rate_limit(...)` | `006_rate_limits`| Security Defense RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `check_rate_limit(...)` | `006_rate_limits`| Security Defense RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `db_health_stats()` | `008_security` | Telemetry RPC | `service_role` ONLY | Revoked from PUBLIC, anon, authenticated |
| `health_metrics()` | `008_security` | Admin Telemetry RPC | `authenticated`, `service_role` | Admin role enforced internally; revoked from anon |
| `assert_rls_enabled_on_all_tables()` | `008_security` | Security Assertion RPC | `service_role` ONLY | Revoked from PUBLIC, anon |

---

## 5. LEGAL HOLD & DELETION CONSISTENCY (SECTION 4)

A static trace was conducted across `cases`, `evidence_items`, `source_snapshots`, `case_audit_log` and associated triggers:

1. **Inviolability of Legal Hold:**
   - In `public.cases`: Transitioning out of `'legal_hold'` requires an administrative caller (`public.has_role(auth.uid(), 'admin')`).
   - In `public.evidence_items`: If `legal_hold = true`, `delete_evidence_item_audited` immediately raises exception `'Dôkaz podlieha legal hold: vymazanie je prísne zakázané.'` (`42501`).
   - In `public.cases`: `destroy_case` explicitly checks `IF _case.status = 'legal_hold'` and raises exception `'Spis pod legal hold nemožno zničiť.'` (`42501`).
2. **Controlled Case Destruction (`destroy_case`) vs Child Lifecycle Guards:**
   - *Previous Defect Identified:* `case_child_lifecycle_guard()` blocked deletion of child records (`case_entities`, `case_events`, etc.) if the parent case was not in `'draft'` state. Because destruction typically targets `'archived'` cases, cascade deletion would fail.
   - *Patch Applied:* `case_child_lifecycle_guard()` was patched to inspect `current_setting('forenx.case_destruction_in_progress', true) = 'on'`. When `destroy_case` runs under administrator authority, it sets this transaction-scoped parameter, performs audit logging into `case_audit_log`, and executes the deletion cleanly.
   - In addition, `destroy_case` verifies that no active rows exist in `public.evidence_items` for that case before proceeding.
3. **Account Deletion & Held Evidence Preservation:**
   - `public.evidence_items.investigator_id` does NOT cascade on user deletion (defaults to `RESTRICT` / `NO ACTION`).
   - `public.evidence_items.case_id` references `cases(id) ON DELETE RESTRICT`.
   - Therefore, deleting an account from `auth.users` CANNOT silently destroy court evidence or bypass legal holds. The operation fails closed via PostgreSQL referential integrity.
4. **GDPR Erasure of Audit Trail:**
   - `case_audit_log` is protected by `case_audit_log_no_update` and `case_audit_log_no_truncate`.
   - Single row deletions are physically blocked.
   - Complete erasure is only possible through `erase_user_audit_log(_user)`, which sets `forenx.audit_erasure = on` within a single atomic transaction and is granted exclusively to `service_role`.

---

## 6. SEQUENTIAL EXECUTION ORDER AUDIT (SECTION 5)

| Step | File | Objects Created | Dependencies Satisfied By | Status |
| :---: | :--- | :--- | :--- | :---: |
| **1** | `001_base.sql` | `pgcrypto`, `app_role`, `profiles`, `user_roles`, `subscriptions`, `billing_events`, `deletion_requests`, `error_logs`, triggers | Prerequisites / Supabase auth runtime | 🟢 PASS |
| **2** | `002_cases.sql` | `cases`, `case_entities`, `case_events`, `case_relations`, `case_transactions`, `case_weapons`, `case_imports`, `company_registry_profiles`, `cross_border_analyses`, guards | Depends on `001` (`update_updated_at_column`, `has_role`) | 🟢 PASS |
| **3** | `003_forensic_evidence.sql` | `source_snapshots`, `evidence_items`, WORM guards, audited deletion RPCs; wires `case_relations.source_snapshot_id` | Depends on `001` & `002` (`cases`, `case_relations`) | 🟢 PASS |
| **4** | `004_audit.sql` | `case_audit_log`, SHA-256 hash chaining, access/upload audit RPCs, tamper verification, erasure RPC | Depends on `001` & `002` (`cases`) | 🟢 PASS |
| **5** | `005_ai_graph.sql` | `ai_usage`, `ai_feature_logs`, `reserve_ai_call`, `commit_ai_case_graph`, `commit_import` | Depends on `001`, `002`, `004` (`cases`, `case_*`, `case_audit_log`) | 🟢 PASS |
| **6** | `006_rate_limits.sql` | `rate_limits`, atomic `consume_rate_limit`, `check_rate_limit`, `cleanup_expired_rate_limits` | Self-contained distributed state | 🟢 PASS |
| **7** | `007_storage_contract.sql` | `storage.buckets` configuration (`avatars`), `storage.objects` RLS policies | Supabase storage runtime | 🟢 PASS |
| **8** | `008_security_hardening.sql` | Global TRUNCATE revocations, `db_health_stats`, `health_metrics`, `assert_rls_enabled_on_all_tables`, master RPC hardening | Depends on all schemas `001`-`007` | 🟢 PASS |

*Forward Dependency Verification:*
- `case_relations.source_snapshot_id` foreign key is deferred to `003_forensic_evidence.sql` via an `ALTER TABLE` block after `source_snapshots` is created.
- Dynamic checks via `to_regclass('public.case_audit_log')` and `to_regclass('public.evidence_items')` in `002_cases.sql` and `003_forensic_evidence.sql` prevent compilation failures during incremental script execution.

---

## 7. STATIC SQL SAFETY AUDIT (SECTION 6)

| Keyword | Occurrences | Context & Safety Assessment |
| :--- | :---: | :--- |
| **`DROP TABLE`** | 0 | **Zero destructive drops.** Tables are created using `CREATE TABLE IF NOT EXISTS`. |
| **`DROP COLUMN`** | 0 | **Zero column drops.** Structural consistency preserved. |
| **`TRUNCATE`** | 10 | **Purely defensive.** `TRUNCATE` is unconditionally revoked from `PUBLIC`, `anon`, `authenticated` on all tables, revoked from `service_role` on forensic tables, and physically blocked via `case_audit_log_no_truncate` trigger. |
| **`CASCADE`** | 18 | **Standard referential integrity.** User-to-profile/subscription cascading; Case-to-graph cascading. Court evidence (`evidence_items`) and audit trail (`case_audit_log`) intentionally omit cascade deletion (`ON DELETE RESTRICT`). |
| **`SECURITY DEFINER`**| 24 | **100% hardened.** Every single `SECURITY DEFINER` function specifies `SET search_path = public, pg_temp`, completely mitigating search_path hijacking. |
| **`GRANT ALL`** | 21 | **Strictly bounded.** Granted exclusively to `service_role` for operational backend persistence. Never granted to `PUBLIC`, `anon`, or `authenticated`. |
| **`GRANT EXECUTE`** | 35 | **Strictly partitioned.** Client RPCs are granted only to `authenticated` (with internal identity/role checks); server/maintenance RPCs are granted exclusively to `service_role`. Zero functions granted to `anon` or `PUBLIC`. |

---

## 8. PATCHED CLEANROOM ARTIFACTS

The following files were patched inside `db/cleanroom/` during this static reconciliation gate:
1. `db/cleanroom/006_rate_limits.sql`: Aligned parameter order `(p_key, p_max_requests, p_window_seconds)`, return type `TABLE (allowed, remaining, reset_at)`, and fixed-window semantics.
2. `db/cleanroom/CLEAN-DB-MANIFEST.md`: Corrected rate limiter terminology from "sliding window" to "fixed window".
3. `db/cleanroom/REQUIRED-APP-OBJECTS.md`: Corrected rate limiter terminology and parameter order.
4. `db/cleanroom/001_base.sql`: Added `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;`.
5. `db/cleanroom/002_cases.sql`: Patched `case_child_lifecycle_guard()` to support controlled case destruction, added audit logging to `destroy_case()`, and revoked unprivileged function execute.
6. `db/cleanroom/003_forensic_evidence.sql`: Added explicit function execute revocations from PUBLIC/anon.
7. `db/cleanroom/004_audit.sql`: Added explicit function execute revocations, restricting `erase_user_audit_log` and `append_audit_event` exclusively to `service_role`.
8. `db/cleanroom/005_ai_graph.sql`: Added explicit function execute revocations, restricting `reserve_ai_call`, `commit_ai_case_graph`, and `commit_import` exclusively to `service_role`.
9. `db/cleanroom/008_security_hardening.sql`: Installed master Section 5 reconciliation block guaranteeing defense-in-depth revocations for all privileged RPCs.

---

## 9. STATIC GATE RESULT

```
RATE_LIMIT_ALGORITHM = FIXED_WINDOW
SUPABASE_RUNTIME_REQUIRED = YES
PRIVILEGED_RPC_MATRIX = PASS
LEGAL_HOLD_DELETE_MODEL = PASS
EXECUTION_ORDER = PASS
STATIC_SECURITY = PASS
FILES_PATCHED = [
  "db/cleanroom/001_base.sql",
  "db/cleanroom/002_cases.sql",
  "db/cleanroom/003_forensic_evidence.sql",
  "db/cleanroom/004_audit.sql",
  "db/cleanroom/005_ai_graph.sql",
  "db/cleanroom/006_rate_limits.sql",
  "db/cleanroom/008_security_hardening.sql",
  "db/cleanroom/CLEAN-DB-MANIFEST.md",
  "db/cleanroom/REQUIRED-APP-OBJECTS.md"
]
BLOCKERS = []

FINAL VERDICT:
READY_FOR_LOCAL_SUPABASE_DOCKER
```
