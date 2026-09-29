# PANDORA / FORENX — REQUIRED APPLICATION DATABASE OBJECTS

> **Audit Source:** Static analysis of application routes (`app/`), service layers (`lib/`), components (`components/`), and integration tests (`supabase/tests/`).  
> **Verdict:** Every object in the Cleanroom baseline corresponds to active, verified production workflows.

---

## 1. TABLE INVENTORY & PRODUCTION EVIDENCE

| # | Database Table | Production Usage in Codebase | Responsible Files / Routes | Classification |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `public.profiles` | User identity, preferences, avatar URL, onboarding state | `lib/forza/account.functions.ts`<br>`components/forza/user-nav.tsx`<br>`app/account/page.tsx` | Core Identity |
| **2** | `public.user_roles` | RBAC role checking (`admin` vs `user`), access gate | `lib/forza/health.functions.ts`<br>`lib/forza/account.functions.ts`<br>`pandora_handle_new_user()` | Core Security |
| **3** | `public.cases` | Forensic dossiers, reference dates, legal hold status, revision tracking | `lib/forza/cases.server.ts`<br>`lib/forza/case-write.functions.ts`<br>`app/cases/page.tsx` | Forensic Core |
| **4** | `public.case_entities` | Graph nodes, corporate entities, natural persons, ORSR ICO cache | `lib/forza/case-graph.functions.ts`<br>`components/forza/graph-canvas.tsx`<br>`lib/forza/import.functions.ts` | Graph Intelligence |
| **5** | `public.case_events` | Chronological investigation timeline, evidence milestones | `lib/forza/case-write.functions.ts`<br>`components/forza/timeline-view.tsx` | Timeline Engine |
| **6** | `public.case_relations` | Graph edges, corporate ownership, transactions, temporal validity | `lib/forza/case-graph.functions.ts`<br>`components/forza/graph-canvas.tsx` | Graph Intelligence |
| **7** | `public.case_transactions` | Financial audit ledger, suspicious transfers, currency conversions | `lib/forza/case-write.functions.ts`<br>`components/forza/transaction-ledger.tsx` | Financial Forensic |
| **8** | `public.case_weapons` | Ballistic and weapons tracing, serial number verification | `lib/forza/case-write.functions.ts`<br>`components/forza/weapons-inventory.tsx` | Special Investigations |
| **9** | `public.case_imports` | Ingest job tracking, CSV/JSON parsing metrics, row validation | `lib/forza/import.functions.ts`<br>`app/cases/[id]/import/page.tsx` | Data Ingestion |
| **10** | `public.case_audit_log` | Cryptographic SHA-256 hash-chained immutable audit log | `lib/storage/vault-auth.ts`<br>`app/api/audit/access/route.ts`<br>`lib/forza/case-write.functions.ts` | Legal Audit (§ 119) |
| **11** | `public.evidence_items` | Court-ready evidence ledger, S3 object keys, SHA-256, WORM locks | `lib/storage/evidence-ledger.ts`<br>`app/api/vault/commit/route.ts`<br>`lib/storage/evidence-verify.ts` | Forensic Core (WORM) |
| **12** | `public.source_snapshots` | Raw HTTP upstream response snapshots, immutable provenance | `lib/forza/import.functions.ts`<br>`case_relations(source_snapshot_id)` | Upstream Provenance |
| **13** | `public.ai_usage` | LLM token metering, model usage tracking, latency monitoring | `lib/forza/ai.functions.ts`<br>`app/api/health/observe/route.ts` | AI Telemetry |
| **14** | `public.ai_feature_logs` | AI analysis outputs, prompts, execution timings, error logs | `lib/forza/ai.functions.ts` | AI Telemetry |
| **15** | `public.subscriptions` | User plan entitlement (`free` vs `pro`), Stripe subscription state | `lib/forza/entitlements.server.ts`<br>`app/account/billing/page.tsx` | Billing & Plans |
| **16** | `public.billing_events` | Webhook idempotency ledger, Stripe charge events | `app/api/webhooks/stripe/route.ts` | Billing & Plans |
| **17** | `public.deletion_requests` | GDPR Art 17 right to erasure requests and tracking | `lib/forza/account.functions.ts`<br>`app/api/account/delete/route.ts` | Compliance |
| **18** | `public.company_registry_profiles` | ORSR / Commercial register cached snapshots and company profile data | `lib/forza/orsr.functions.ts`<br>`app/api/orsr/route.ts` | Open Source Intelligence |
| **19** | `public.cross_border_analyses` | International tax routing and shell company structural analysis | `lib/forza/cross-border.functions.ts`<br>`app/cases/[id]/cross-border/` | Graph Intelligence |
| **20** | `public.rate_limits` | Distributed PostgreSQL atomic fixed window rate limiter | `lib/services/rate-limiter.ts`<br>`app/api/csp-report/limiter.ts`<br>`app/api/health/observe/limiter.ts` | Security Defense |
| **21** | `public.error_logs` | Server and client exception tracking, operational 24h health alerts | `lib/logger.ts`<br>`app/api/health/observe/route.ts` | Observability |

---

## 2. RPC FUNCTIONS & PRODUCTION INVOCATIONS

| RPC Function | Signature | Invocation in Codebase | Security Level |
| :--- | :--- | :--- | :---: |
| `consume_rate_limit` | `(p_key, p_max_requests, p_window_seconds)` | `lib/services/rate-limiter.ts:201` | Service Role Only |
| `check_rate_limit` | `(p_key, p_max_requests, p_window_seconds)` | `lib/services/rate-limiter.ts:223` | Service Role Only |
| `cleanup_expired_rate_limits` | `()` | Background maintenance / cron | Service Role Only |
| `commit_ai_case_graph` | `(_case, _actor, _entities, _events, _relations)` | `lib/forza/case-graph.functions.ts:111` | Service Role / Definer |
| `commit_import` | `(_case, _data, _actor)` | `lib/forza/import.functions.ts:119` | Service Role / Definer |
| `reserve_ai_call` | `(_user_id, _case_id, _task, ...)` | `lib/forza/ai.functions.ts:489` | Service Role / Definer |
| `set_case_status` | `(_case_id, _status, _reason)` | `lib/forza/case-write.functions.ts:534` | Authenticated / Definer |
| `destroy_case` | `(_case_id, _reason)` | `lib/forza/case-write.functions.ts:570` | Admin Only / Definer |
| `has_role` | `(_user_id, _role)` | `lib/forza/health.functions.ts:76` | Authenticated |
| `current_plan` | `(_user)` | `lib/forza/entitlements.server.ts:14` | Authenticated / Definer |
| `db_health_stats` | `()` | `lib/forza/health.functions.ts:102` | Service Role Only |
| `health_metrics` | `()` | `app/api/health/observe/route.ts:141` | Admin / Definer |
| `log_case_access` | `(_case_id, _action, _legal_basis, ...)` | `lib/storage/vault-auth.ts:190` | Authenticated / Definer |
| `log_evidence_upload` | `(_case_id, _evidence_id, ...)` | `app/api/vault/commit/route.ts` | Authenticated / Definer |
| `record_evidence_verification`| `(_evidence_id, _status, ...)` | `lib/storage/evidence-verify.ts:133` | Service Role / Definer |
| `delete_evidence_item_audited`| `(_id, _reason)` | Audited evidence removal endpoint | Authenticated / Definer |
| `verify_audit_chain` | `(_user)` | Verification test suites & compliance check | Service Role / Definer |
| `erase_user_audit_log` | `(_user)` | `lib/forza/account.functions.ts:163` | Service Role Only |
