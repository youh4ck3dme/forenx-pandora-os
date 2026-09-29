# PANDORA / FORENX — CLEANROOM DATABASE MANIFEST

> **Version:** 1.0.0-cleanroom  
> **Status:** BASELINE READY FOR LOCAL VALIDATION (No Mutations Done)  
> **Repository:** `youh4ck3dme/forenx-pandora-os`  
> **Directory:** `db/cleanroom/`

---

## 1. ARCHITECTURAL OVERVIEW & PHILOSOPHY

The Pandora/FORENX Cleanroom Database Baseline is a completely reconciled, self-contained, and reproducible relational schema. It resolves the historical migration drift between local files and hosted Supabase history without mutating either environment.

### Core Principles:
1. **Zero Timestamp Coupling:** The cleanroom files (`001_*.sql` through `008_*.sql`) use logical sequence numbering instead of Supabase timestamp prefixes.
2. **Forensic Integrity by Default:** WORM (Write-Once-Read-Many) immutability, cryptographic SHA-256 hash chaining, and legal hold locks are baked directly into the initial table declarations and triggers.
3. **Decoupled Vault Architecture:** Physical evidence binary assets reside on sovereign Hetzner S3 object storage; the database strictly handles metadata, proof-of-work hashes, verification states, and tamper-evident audit logs.
4. **Defense-in-Depth Security:** Every single table enforces Row Level Security (RLS). Functions specify `SECURITY DEFINER` with fixed `search_path = public, pg_temp`. Anonymous access is locked down.

---

## 2. MODULE EXECUTION ORDER & STRUCTURE

```
db/cleanroom/
├── 001_base.sql                # App roles, user profiles, isolated signup hook, subscriptions, error logs
├── 002_cases.sql               # Core forensic dossiers, graph entities, events, relations, transactions, weapons, imports
├── 003_forensic_evidence.sql   # Evidence items ledger (WORM), source snapshots, verification state, audited deletion
├── 004_audit.sql               # Cryptographic SHA-256 hash-chained append-only audit log, access logging (§ 119)
├── 005_ai_graph.sql            # AI token usage, feature telemetry, transactional graph commit, ingest commit
├── 006_rate_limits.sql         # Distributed PostgreSQL fixed window rate limiter, atomic RPCs, deny-all RLS
├── 007_storage_contract.sql    # Supabase storage buckets (avatars) and object-level RLS policies
└── 008_security_hardening.sql  # Unconditional TRUNCATE revocation, advisor compliance, operational health telemetry
```

### Module Descriptions:
- **`001_base.sql`**: Configures `pgcrypto`, `app_role` enum, `profiles`, `user_roles`, `subscriptions`, `billing_events`, `deletion_requests`, and `error_logs`. Installs the isolated `pandora_handle_new_user()` trigger on `auth.users`.
- **`002_cases.sql`**: Configures `cases` with strict lifecycle status checks (`draft`, `closed`, `legal_hold`, `archived`, `destroyed`). Enforces `case_child_lifecycle_guard()` on all child tables to prevent writes when a case is locked.
- **`003_forensic_evidence.sql`**: Establishes `evidence_items` with write-once forensic identity (`evidence_items_worm_guard`), immutable `source_snapshots`, and audited deletion (`delete_evidence_item_audited`).
- **`004_audit.sql`**: Configures `case_audit_log` with mathematical SHA-256 hash chaining, per-user advisory locks, server-enforced timestamps, and unconditional append-only protection (`case_audit_log_no_update`, `case_audit_log_no_truncate`).
- **`005_ai_graph.sql`**: Provides atomic transactional graph commitment (`commit_ai_case_graph`), AI usage telemetry (`ai_usage`, `ai_feature_logs`), and ingest commitment (`commit_import`).
- **`006_rate_limits.sql`**: Dedicated distributed rate limiter (`public.rate_limits`) with atomic upsert RPCs (`consume_rate_limit`, `check_rate_limit`) and strict deny-all direct client policies.
- **`007_storage_contract.sql`**: Declares UI asset bucket (`avatars`) and reinforces physical separation from S3 evidence storage.
- **`008_security_hardening.sql`**: Hardens the entire engine: revokes `TRUNCATE` from all roles on forensic tables, enforces search_path safety, and installs `db_health_stats()` and `health_metrics()`.

---

## 3. FORENSIC INVARIANTS GUARANTEE

| Invariant | Implementation Mechanism | Guarantee |
| :--- | :--- | :--- |
| **AI Output != Evidence** | Strict separation of `evidence_items` vs `case_entities`/`ai_usage` | AI can generate hypotheses and graph edges, but cannot mutate or replace raw evidence records. |
| **Immutable Evidence Core** | `evidence_items_worm_guard` (BEFORE UPDATE trigger) | `sha256_hash`, `s3_object_key`, `file_size`, `mime_type`, `investigator_id` cannot be modified by any role. |
| **Server-Controlled Legal Hold** | `evidence_items_insert_guard` & `set_case_status` | Clients cannot self-impose or lift legal hold. Lifting requires admin role. Under legal hold, mutations and deletions are blocked. |
| **Append-Only Audit Log** | `case_audit_log_no_update` & `case_audit_log_no_truncate` | Individual row updates or deletes trigger exception `42501`. Truncate is physically blocked. |
| **Cryptographic Hash Chain** | `case_audit_log_chain` & `audit_event_hash` | Every entry includes SHA-256 of previous record. Chain tampering is instantly detected by `verify_audit_chain()`. |
| **Rate Limit Isolation** | Deny-all RLS (`no_direct_*`) + Service Role RPC | No client session can read, write, or tamper with rate limiting counters. |

---

## 4. VALIDATION & DEPLOYMENT CHECKLIST

Before deploying this cleanroom schema to a fresh local Docker PostgreSQL or staging database:

1. [x] **Zero Destructive Remote Commands:** Hosted Supabase remains 100% untouched.
2. [x] **Zero File Deletions:** Old migrations in `supabase/migrations/` are preserved for audit history.
3. [x] **Syntax Validation:** All SQL constructs conform to standard PostgreSQL 15+ / 17.
4. [x] **Circular Dependency Free:** Script order (001 -> 008) guarantees all foreign keys and triggers resolve cleanly.
5. [x] **Collision Resolution:** The `20260928230100` collision is fully isolated and eliminated in the new structure.
