# PANDORA / FORENX — DATABASE CONTRACT & REGRESSION HARNESS
**Status:** ALL 10 INVARIANTS VERIFIED AT RUNTIME (28/28 TESTS GREEN)  
**Execution Environment:** Isolated In-Memory PostgreSQL 17 (PGlite) & TypeScript Harness  
**Command:** `npm run test:cleanroom`  
**Execution Mode:** STRICT LOCAL ONLY (Zero Docker, Zero Cloud Mutations)

---

## 1. Executive Summary

Prior to initiating the Supabase Docker stage or performing any live database migration, a permanent automated database contract regression suite was constructed under `db/cleanroom/tests/`.

This harness proves at runtime—from an empty database schema up to full transactional operation—that all 10 previously pending database contracts hold true under PostgreSQL 17.

### Summary Test Results
| Test Suite File | Domain Covered | Tests | Result | Duration |
| :--- | :--- | :---: | :---: | :---: |
| `01-migration-order-execution.test.ts` | Clean DB Deployment & Schema Integrity | 1 | **PASS** | ~11s |
| `02-rate-limiter-fixed-window.test.ts` | P0-09 Fixed-Window Rate Limiter & Concurrency | 5 | **PASS** | ~13s |
| `03-privileged-rpc-authorization.test.ts` | GRANT/REVOKE, SECURITY DEFINER & RPC Roles | 4 | **PASS** | ~13s |
| `04-rls-isolation-and-security.test.ts` | Multi-Tenant RLS & 100% Policy Assertion | 4 | **PASS** | ~13s |
| `05-trigger-and-worm-immutability.test.ts` | WORM Immutability, Lifecycle & Hash Normalization | 5 | **PASS** | ~13s |
| `06-legal-hold-and-cascades.test.ts` | Legal Hold Locks, Cascades & Deletion Restrict | 5 | **PASS** | ~13s |
| `07-audit-hash-chain-integrity.test.ts` | Cryptographic SHA-256 Hash Chain & Tamper Alert | 4 | **PASS** | ~13s |
| **TOTAL** | **Full Cleanroom Database Contract** | **28** | **PASS** | **~49s (parallel)** |

---

## 2. Verification of the 10 Pending Runtime Behaviors

### 1. Actual SQL execution from empty database
- **Test:** [`01-migration-order-execution.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/01-migration-order-execution.test.ts)
- **Verified Behavior:**
  - Starts with zero tables, types, or policies.
  - Applies files `001_base.sql` through `008_security_hardening.sql` in strict topological order.
  - Generates 21 public tables and 33 public stored procedures/functions with zero dependency errors or cyclic resolution failures.

### 2. Actual GRANT/REVOKE behavior
- **Tests:** [`03-privileged-rpc-authorization.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/03-privileged-rpc-authorization.test.ts), [`07-audit-hash-chain-integrity.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts)
- **Verified Behavior:**
  - Default function privileges revoked: `anon` receives `permission denied` on all stored procedures.
  - `TRUNCATE` is unconditionally revoked on all tables from `PUBLIC`, `anon`, and `authenticated`, and additionally revoked from `service_role` on sensitive forensic tables (`evidence_items`, `source_snapshots`, `case_audit_log`, `cases`).
  - Table-level access on `public.rate_limits` is denied to all client roles.

### 3. Actual RLS behavior
- **Test:** [`04-rls-isolation-and-security.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/04-rls-isolation-and-security.test.ts)
- **Verified Behavior:**
  - User A cannot view, mutate, or query cases or graph entities belonging to User B (zero rows returned).
  - Calling `public.assert_rls_enabled_on_all_tables()` proves 100% (21/21) of tables in schema `public` have `rowsecurity = true`.
  - Direct client `DELETE` on `evidence_items` is completely blocked.

### 4. SECURITY DEFINER behavior
- **Tests:** [`02-rate-limiter-fixed-window.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/02-rate-limiter-fixed-window.test.ts), [`03-privileged-rpc-authorization.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/03-privileged-rpc-authorization.test.ts)
- **Verified Behavior:**
  - All definer functions enforce `SET search_path = public, pg_temp` to prevent search_path injection.
  - `consume_rate_limit` mutates `public.rate_limits` via elevated definer context even though client roles have zero direct table permissions.

### 5. Trigger behavior
- **Test:** [`05-trigger-and-worm-immutability.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts)
- **Verified Behavior:**
  - `set_updated_at` automatically updates `updated_at = NOW()` and increments `revision`.
  - `source_snapshots_immutable_guard` aborts any UPDATE or DELETE attempt on raw snapshots.
  - `evidence_items_immutable_guard` prevents tampering with forensic identity columns (`file_hash_sha256`, `s3_object_key`, `file_size_bytes`).
  - `evidence_items_insert_guard` automatically normalizes sha256 to lowercase hex and validates format.
  - `case_child_lifecycle_guard` blocks modification to case child tables when case is not in `draft` status.

### 6. FK/cascade/restrict behavior
- **Test:** [`06-legal-hold-and-cascades.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/06-legal-hold-and-cascades.test.ts)
- **Verified Behavior:**
  - Attempting to delete a user account (`auth.users`) that owns active forensic evidence fails closed with foreign key violation (`ON DELETE RESTRICT`). Evidence is never orphaned or deleted by user account manipulation.
  - Authorised case destruction cascades to entities, relations, transactions, events, and weapons cleanly.

### 7. RPC role authorization
- **Test:** [`03-privileged-rpc-authorization.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/03-privileged-rpc-authorization.test.ts)
- **Verified Behavior:**
  - Server-only RPCs (`commit_ai_case_graph`, `reserve_ai_call`, `record_evidence_verification`, `erase_user_audit_log`, `append_audit_event`) reject execution by `authenticated` clients.
  - `destroy_case()` and `health_metrics()` inspect `public.has_role(auth.uid(), 'admin')` and reject non-admin users with error code `42501`.

### 8. Fixed-window concurrency & semantics
- **Test:** [`02-rate-limiter-fixed-window.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/02-rate-limiter-fixed-window.test.ts)
- **Verified Behavior:**
  - Exactly fixed-window: requests 1..N return `allowed = true` with decremented `remaining`; request N+1 returns `allowed = false`.
  - `check_rate_limit()` inspects current quota without incrementing count or modifying `reset_at`.
  - When the window expires, the window does NOT slide; an atomic new window begins with full quota.
  - Invalid parameters (max <= 0, window <= 0, empty key) fail with SQL state `22023`.

### 9. Legal-hold destruction behavior
- **Test:** [`06-legal-hold-and-cascades.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/06-legal-hold-and-cascades.test.ts)
- **Verified Behavior:**
  - A case under `legal_hold` cannot be changed to another status by a regular user. Only users with role `admin` can release the hold.
  - Evidence under legal hold cannot be deleted, even by `service_role`.
  - `destroy_case()` refuses to destroy cases that are under legal hold or contain active evidence.
  - When eligible, `destroy_case()` sets `forenx.case_destruction_in_progress = 'on'`, purges children, deletes the case, and records a cryptographically hashed audit entry in `case_audit_log`.

### 10. Audit hash-chain behavior
- **Test:** [`07-audit-hash-chain-integrity.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts)
- **Verified Behavior:**
  - Genesis audit event has `previous_event_hash = '0'*64`. Subsequent events chain their `previous_event_hash` to the exact SHA-256 `event_hash` of the preceding record.
  - Per-user advisory lock serializes concurrent audit appends, preventing chain bifurcation.
  - Tamper detection via `public.verify_audit_chain(user_id)` flags corrupted hashes as `event_hash_mismatch`.
  - Direct `UPDATE`, `DELETE`, and `TRUNCATE` are unconditionally rejected by database triggers and privilege revocations.
  - GDPR right-to-erasure is supported exclusively via privileged `erase_user_audit_log(user_id)`, which removes the user's entire chain atomically under a transaction-scoped GUC flag.

---

## 3. How to Run the Regression Suite

The regression test harness is registered in [`package.json`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/package.json):

```bash
npm run test:cleanroom
```

Or run individual suites:
```bash
npx vitest run db/cleanroom/tests/01-migration-order-execution.test.ts
npx vitest run db/cleanroom/tests/02-rate-limiter-fixed-window.test.ts
npx vitest run db/cleanroom/tests/03-privileged-rpc-authorization.test.ts
npx vitest run db/cleanroom/tests/04-rls-isolation-and-security.test.ts
npx vitest run db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts
npx vitest run db/cleanroom/tests/06-legal-hold-and-cascades.test.ts
npx vitest run db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts
```

---

## 4. How to Run the Regression Suites

### Pre-Docker In-Memory Suite (PGlite)
```bash
npm run test:cleanroom
```

### Full Local Supabase Docker Dual-Build Proof (Automated from Zero)
```bash
npm run test:docker:proof
```

---

## 5. Local Supabase Docker Runtime Proof & Dual-Build Verification

On a real local Supabase Docker stack (PostgreSQL 17.6, PostgREST 14.5, Kong 2.8.1, Storage API 1.77.5, GoTrue 2.197.0), a complete dual-build zero-state verification cycle was executed:

1. **BUILD 1:**
   - Applied cleanroom SQL baseline (`001_base.sql` → `008_security_hardening.sql`) on fresh Docker database.
   - Deterministic schema signature computation:
     `SCHEMA_HASH_1 = 6ba5375159b8e6284a6fdc9087572a105df46147633366d1e517814279399b99` (450 canonical schema tokens).
   - Executed full test suite (31/31 tests across files `01` through `08`). Result: **PASS**.
2. **VOLUME PURGE:**
   - Executed `supabase stop --no-backup`, completely destroying all local Docker data volumes (`supabase_db_*`, `supabase_storage_*`, etc.).
   - Verified 0 persistent volumes remained.
3. **BUILD 2 (RECREATED FROM ZERO):**
   - Executed `supabase start` to provision completely fresh containers.
   - Applied cleanroom SQL baseline (`001_base.sql` → `008_security_hardening.sql`).
   - Deterministic schema signature computation:
     `SCHEMA_HASH_2 = 6ba5375159b8e6284a6fdc9087572a105df46147633366d1e517814279399b99` (450 canonical schema tokens).
   - Asserted mathematical equality: `SCHEMA_HASH_1 === SCHEMA_HASH_2` (**PASS**).
   - Executed full test suite again against BUILD 2. Result: **PASS**.

### RPC Matrix 3-Path Verification Results
All 19 application RPCs were verified over HTTP/PostgREST and direct SQL across Happy Path, Unauthorized Path, and Invalid Input Path:
- `consume_rate_limit`: Happy (service_role), Unauthorized (anon/auth 42501), Invalid (max<=0 22023)
- `check_rate_limit`: Happy (service_role), Unauthorized (auth 42501), Invalid (window<=0 22023)
- `cleanup_expired_rate_limits`: Happy (service_role), Unauthorized (auth 42501)
- `has_role`: Happy (auth), Unauthorized (anon 42501), Invalid (unknown role)
- `current_plan`: Happy (auth), Unauthorized (anon 42501), Invalid (malformed UUID)
- `set_case_status`: Happy (auth owner), Unauthorized (anon 42501), Invalid (illegal transition)
- `destroy_case`: Happy (admin audited), Unauthorized (regular auth 42501), Invalid (non-existent P0002 / active evidence P0001)
- `db_health_stats`: Happy (service_role), Unauthorized (client 42501)
- `health_metrics`: Happy (admin 24h stats), Unauthorized (regular auth 42501)
- `log_case_access`: Happy (auth § 119), Unauthorized (anon 42501), Invalid (empty legal basis P0001)
- `log_evidence_upload`: Happy (auth), Unauthorized (anon 42501), Invalid (malformed UUID)
- `record_evidence_verification`: Happy (service_role), Unauthorized (auth 42501), Invalid (illegal status)
- `delete_evidence_item_audited`: Happy (auth investigator), Unauthorized (anon 42501), Invalid (non-existent P0002 / legal hold 42501)
- `verify_audit_chain`: Happy (auth/service_role), Unauthorized (anon 42501), Invalid (malformed UUID)
- `erase_user_audit_log`: Happy (service_role), Unauthorized (auth 42501), Invalid (malformed UUID)
- `commit_ai_case_graph`: Happy (service_role draft case), Unauthorized (auth 42501), Invalid (non-draft / non-existent case 42501)
- `commit_import`: Happy (service_role draft case), Unauthorized (auth 42501), Invalid (non-draft / non-existent case 42501)
- `reserve_ai_call`: Happy (service_role), Unauthorized (auth 42501), Invalid (missing task)
- `append_audit_event`: Happy (service_role), Unauthorized (auth 42501), Invalid (malformed action pattern)

**Uncovered RPCs:** `[]` (0 uncovered).

---

## 6. Final Verdict

```
================================================================================
  BUILD_1                      : PASS
  BUILD_2                      : PASS
  SCHEMA_HASH_1 == SCHEMA_HASH_2: PASS (6ba5375159b8e6284a6fdc9087572a105df46147633366d1e517814279399b99)
  ALL_RPC_CONTRACTS            : PASS (19/19 verified across 3 paths)
  ALL_RLS_CONTRACTS            : PASS (auth.uid, anon, authenticated, service_role)
  ALL_FORENSIC_INVARIANTS      : PASS (WORM, Legal Hold, Hash Chain, Delete Restrict)
  UNCOVERED_RPCS               : [] (0 uncovered)
================================================================================
  FINAL VERDICT: READY_FOR_BASELINE_FREEZE
================================================================================
```

