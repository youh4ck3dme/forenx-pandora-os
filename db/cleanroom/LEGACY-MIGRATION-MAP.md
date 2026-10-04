# PANDORA / FORENX — LEGACY MIGRATION RECONCILIATION MAP

> **Mode:** STRICT READ-ONLY AUDIT & CLEANROOM MAPPING  
> **Target:** Traceability of all legacy migration artifacts into `db/cleanroom/` baseline.  
> **Guiding Principle:** Do not patch historical drift; extract the true verified contract into clean semantic layers.

---

## 1. CLASSIFICATION CRITERIA

| Category | Definition |
| :--- | :--- |
| **`KEEP_SEMANTICS`** | Core business logic or forensic integrity contract preserved directly in the cleanroom baseline. |
| **`REPLACED`** | Incremental `ALTER TABLE` patches or interim schema iterations unified into clean, comprehensive table declarations. |
| **`OBSOLETE`** | One-time data backfills, legacy bug workarounds, or obsolete Supabase template defaults. |
| **`CONFLICTED`** | Version collision where local repository and hosted history assign the same timestamp to different SQL contents. |
| **`MANUAL_HOSTED_ONLY`** | Migrations present exclusively in hosted `supabase_migrations.schema_migrations` and absent from local Git history. |

---

## 2. LEGACY MIGRATION INVENTORY & CLEANROOM MAPPING

| # | Legacy Migration File / Hosted Version | Status | Cleanroom Target File | Rationale / Resolution |
| :---: | :--- | :---: | :---: | :--- |
| **1** | `20260915190356_8c26b7d6-0a53-4765-a67c-8c4d8e2f20e0.sql` | `REPLACED` | `001_base.sql`<br>`002_cases.sql` | Initial tables (`profiles`, `cases`, `case_entities`, etc.) unified into clean baseline with all final constraints. |
| **2** | `20260916150741_50cb881c-1663-4f3a-b792-4aebcecec5f6.sql` | `REPLACED` | `008_security_hardening.sql` | `db_health_stats()` replaced by final security-hardened version with strict role revocation. |
| **3** | `20260916151306_bd620097-876e-4494-adef-f027bd3690d3.sql` | `REPLACED` | `001_base.sql`<br>`002_cases.sql`<br>`005_ai_graph.sql` | Incremental column additions, `subscriptions`, `billing_events`, `company_registry_profiles` unified in baseline. |
| **4** | `20260916151341_8533205f-9c23-465e-bfcc-b3576bd5da60.sql` | `REPLACED` | `008_security_hardening.sql` | Interim RPC grant revocations consolidated in security hardening. |
| **5** | `20260916151453_89f7e1cf-1caa-46fe-98fa-f328b7216d37.sql` | `OBSOLETE` | `001_base.sql` | Permissions patch on initial schema superseded by strict default cleanroom grants. |
| **6** | `20260916160736_da047fbc-4b0f-4c5e-830b-50db746ad592.sql` | `REPLACED` | `002_cases.sql` | Relation and transaction constraints unified into `002_cases.sql`. |
| **7** | `20260916194748_143738c5-5035-4b43-9084-e12cf2fd46b0.sql` | `REPLACED` | `004_audit.sql` | Interim audit log schema replaced by final cryptographic hash-chained log. |
| **8** | `20260917193202_6679e439-7f2a-4ebc-81a4-8adeab156f04.sql` | `REPLACED` | `002_cases.sql` | Entity and relation extensions merged directly into `002_cases.sql`. |
| **9** | `20260920021805_7fbcaef1-96c5-4e67-834b-c605a810c823.sql` | `REPLACED` | `002_cases.sql` | Case import fields and statuses consolidated. |
| **10** | `20260920021841_e7bc1478-9322-4acb-8a3b-aef44cffeda3.sql` | `REPLACED` | `002_cases.sql` | `owns_case` function unified with final search_path hardening. |
| **11** | `20260921040519_63e51aba-932c-4c05-9ba7-fb3d8a0b3b6e.sql` | `REPLACED` | `008_security_hardening.sql` | Interim security revocations merged into `008_security_hardening.sql`. |
| **12** | `20260921040609_bdc8c677-043f-45c3-b220-d0a3b892948e.sql` | `KEEP_SEMANTICS` | `008_security_hardening.sql` | Core `db_health_stats()` logic preserved with search_path safety. |
| **13** | `20260925140000_avatars_storage_bucket.sql` | `KEEP_SEMANTICS` | `007_storage_contract.sql` | Avatars bucket declaration and storage RLS preserved. |
| **14** | `20260925143000_admin_email_bizagent.sql` | `REPLACED` | `001_base.sql` | Admin email allowlist integrated into isolated `pandora_handle_new_user()`. |
| **15** | `202609270001_atomic_ai_graph.sql` | `REPLACED` | `002_cases.sql`<br>`005_ai_graph.sql` | `identity_key` column on `case_entities` and initial AI graph commit merged. |
| **16** | `20260927113000_case_graph_hardening.sql` | `KEEP_SEMANTICS` | `005_ai_graph.sql` | Hardened `commit_ai_case_graph()` with FOR UPDATE locking and audit trail. |
| **17** | `20260927120000_court_ready_evidence_ledger.sql` | `REPLACED` | `003_forensic_evidence.sql` | Base `evidence_items` table unified with WORM triggers and verification fields. |
| **18** | `20260927130000_forensic_integrity.sql` | `KEEP_SEMANTICS` | `003_forensic_evidence.sql`<br>`004_audit.sql` | `source_snapshots` table, SHA-256 hash chaining, advisory locks, append-only triggers. |
| **19** | `20260927140000_case_lifecycle_legal_hold.sql` | `KEEP_SEMANTICS` | `002_cases.sql` | Case lifecycle states, `set_case_status`, `destroy_case`, child lifecycle guards. |
| **20** | `20260927150000_access_audit_log.sql` | `KEEP_SEMANTICS` | `004_audit.sql` | `log_case_access()` for legal compliance (§ 119 Trestného poriadku). |
| **21** | `20260927160000_access_audit_upload.sql` | `KEEP_SEMANTICS` | `004_audit.sql` | `log_evidence_upload()` audit helper. |
| **22** | `20260927234500_evidence_ledger_worm.sql` | `KEEP_SEMANTICS` | `003_forensic_evidence.sql` | Full WORM update guard, insert guard, audited deletion procedure `delete_evidence_item_audited()`. |
| **23** | `20260927235000_harden_case_lifecycle_guard.sql` | `KEEP_SEMANTICS` | `002_cases.sql` | Child table mutation guards on draft status. |
| **24** | `20260928000000_evidence_unique_key.sql` | `KEEP_SEMANTICS` | `003_forensic_evidence.sql` | Unique index `evidence_items_s3_object_key_uidx` for idempotent concurrency. |
| **25** | `20260928000100_operational_metrics.sql` | `KEEP_SEMANTICS` | `008_security_hardening.sql` | `health_metrics()` 24-hour aggregator and threshold alerts. |
| **26** | `20260928230000_pandora_signup_hook_isolation.sql` | `KEEP_SEMANTICS` | `001_base.sql` | Isolated `pandora_handle_new_user()` and `pandora_on_auth_user_created` trigger. |
| **27** | `20260928230100_rate_limits_atomic.sql` | 🔴 **`CONFLICTED`** | `006_rate_limits.sql` | **Critical Version Collision.** Local file defined atomic rate limiter. Extracted into clean `006_rate_limits.sql` with zero timestamp dependency. |
| **28** | `20260928230100` (`revoke_anon_privileged_rpcs`) | 🔴 **`CONFLICTED`** | `008_security_hardening.sql` | **Hosted-Only Migration.** Revoked anon execution on privileged RPCs. Semantics merged cleanly into `008_security_hardening.sql`. |
| **29** | `20260928230200` (`advisor_hardening`) | 🟡 **`MANUAL_HOSTED_ONLY`** | `008_security_hardening.sql` | **Hosted-Only Migration.** Supabase Advisor linter fixes (search_path, grants). Integrated natively in `008_security_hardening.sql`. |

---

## 3. DEEP-DIVE RESOLUTION: THE 20260928230100 & 20260928230200 COLLISION

### The Anatomy of the Collision:
1. **Local Repository State:**
   - Commit `270f7cd` created `20260928230100_rate_limits_atomic.sql`.
   - Content: `public.rate_limits` table, `consume_rate_limit()`, `check_rate_limit()`, `cleanup_expired_rate_limits()`.
2. **Hosted Database State:**
   - Migration `20260928230100` was recorded in `supabase_migrations.schema_migrations` as `revoke_anon_privileged_rpcs`.
   - Migration `20260928230200` was recorded as `advisor_hardening`.
   - The user then manually ran the SQL body of `rate_limits_atomic` via the Supabase SQL Editor.
   - Result: Database objects existed in PostgreSQL, but were completely disconnected from the migration version chain, and the version number was already consumed by an unrelated security patch.

### Cleanroom Resolution:
- **No historical timestamps are reused.**
- The rate limiter is extracted into a dedicated, clean module: `db/cleanroom/006_rate_limits.sql`.
- The security revocations (`revoke_anon_privileged_rpcs` and `advisor_hardening`) are extracted into `db/cleanroom/008_security_hardening.sql`.
- In cleanroom, both modules coexist in perfect mathematical harmony, with zero version overlap and zero migration engine ambiguity.
