# PANDORA / FORENX — DATABASE BASELINE V1 RELEASE
**Baseline Identifier:** `PANDORA_DB_BASELINE_V1`  
**Schema Signature Hash:** `6ba5375159b8e6284a6fdc9087572a105df46147633366d1e517814279399b99`  
**Status:** 🔒 IMMUTABLE BASELINE FROZEN  
**Target Engine:** PostgreSQL 17.6 / Supabase Runtime Stack  

---

## 1. Immutable Baseline Policy

As of this release, the cleanroom SQL migration chain in `db/cleanroom/`:
- `001_base.sql`
- `002_cases.sql`
- `003_forensic_evidence.sql`
- `004_audit.sql`
- `005_ai_graph.sql`
- `006_rate_limits.sql`
- `007_storage_contract.sql`
- `008_security_hardening.sql`

is formally declared **IMMUTABLE**.

### Strict Change Rules
1. **Never edit Baseline V1 files directly.** Any retrospective alteration invalidates the cryptographic schema hash and contract proof.
2. **All future schema modifications MUST be forward migrations** (`009_*.sql`, `010_*.sql`, etc.).
3. **No manual hotfixes or unverified SQL pushes** are permitted on staging or production instances.

---

## 2. Verified Invariant Specifications

| Contract Domain | Specification & Enforcement | Verification Test |
| :--- | :--- | :--- |
| **P0-09 Rate Limiting** | Strict Fixed-Window atomic algorithm; check does not consume quota; expires and resets cleanly. | [`02-rate-limiter-fixed-window.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/02-rate-limiter-fixed-window.test.ts) |
| **WORM Forensic Evidence** | Database-level triggers prevent updates/deletions on `source_snapshots` and forensic identity columns (`file_hash_sha256`, `s3_object_key`, `file_size_bytes`). | [`05-trigger-and-worm-immutability.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/05-trigger-and-worm-immutability.test.ts) |
| **Audit Hash-Chain** | Cryptographic SHA-256 chain links events; advisory lock prevents concurrency forks; `verify_audit_chain` flags tampering. | [`07-audit-hash-chain-integrity.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/07-audit-hash-chain-integrity.test.ts) |
| **Legal Hold Protection** | Non-admins cannot release legal hold; evidence and cases under legal hold cannot be deleted or destroyed. | [`06-legal-hold-and-cascades.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/06-legal-hold-and-cascades.test.ts) |
| **Account Deletion Restrict** | Foreign key `ON DELETE RESTRICT` on active evidence prevents evidence destruction during user deletion. | [`06-legal-hold-and-cascades.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/06-legal-hold-and-cascades.test.ts) |
| **Row Level Security** | 100% of public tables have `rowsecurity = true`; cross-tenant zero leakage; anon table access blocked. | [`04-rls-isolation-and-security.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/04-rls-isolation-and-security.test.ts) |
| **Definer Search Path** | All functions locked to `SET search_path = public, pg_temp` with explicit execution revocations. | [`03-privileged-rpc-authorization.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/03-privileged-rpc-authorization.test.ts) |
| **PostgREST Integration** | All 19 application RPCs verified across Happy Path, Unauthorized Path, and Invalid Input Path. | [`08-supabase-docker-integration.test.ts`](file:///c:/Projects/forenzX-pandora-os/forenx-pandora-os/db/cleanroom/tests/08-supabase-docker-integration.test.ts) |

---

## 3. Cryptographic Checksums (SHA-256)

```
1ed4d1ad36cba965041aebd9182f886702d63797a2d9d5a9dcb0fdb5b126d23f  db/cleanroom/001_base.sql
ce39b8a1917efaaae913c35a81c315efff0ea8f4fd5f178acedd9ba25b92b815  db/cleanroom/002_cases.sql
780f1745dc84f2f082cadd32454687524f72e3d4d66aa80553ca06ad2ea63a3b  db/cleanroom/003_forensic_evidence.sql
bfe471dfe81905ac9034fe8fcda963ac9166735b97c9ab35022f63a90359789a  db/cleanroom/004_audit.sql
6d19641931c8ee90ff0ca19f7b4d577d8d67ecdbeac1e1ff5b44141b6cf18833  db/cleanroom/005_ai_graph.sql
29b3a9b39a9eebfedee924ac21ba76d7b4df5798483eb1bfc0e5167d2a099c67  db/cleanroom/006_rate_limits.sql
824a7e0391d1214d255b3435ee612d439ce6c1f9cc6b56bdd95c872e5d4fecde  db/cleanroom/007_storage_contract.sql
9561f85fcbcbf31370e17b97970bab203f424aedeafd4afed54089198807e64a  db/cleanroom/008_security_hardening.sql
39ace7fa96b0559338adea1fbc25ef05f0900e39a26ff033e6f1addb4905bb26  db/cleanroom/DATABASE-CONTRACT-HARNESS.md
e929580a4a3ae9e7bead57d40d9d4786eb4ffe1b57162e4d759926a1a3004af4  db/cleanroom/STATIC-QUALITY-GATE.md
97956b69d8cd9eb903772244233de6406c9ff2f8f9f7f382635783b778be6466  db/cleanroom/CLEAN-DB-MANIFEST.md
```

---

## 4. Verification Commands

Run in-memory regression tests:
```bash
npm run test:cleanroom
```

Run dual-build zero-state Docker proof:
```bash
npm run test:docker:proof
```
