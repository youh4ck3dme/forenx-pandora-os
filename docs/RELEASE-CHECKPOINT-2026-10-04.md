# Release Checkpoint — 2026-10-04

## Build

- `npm run build:vps`: **PASS**, exit `0`.
- Optimized production compilation completed in approximately 2.5 minutes.
- Static generation completed: 33/33 pages.
- The build was resource-heavy on the diagnostic host: free physical memory
  fell to approximately 128 MB and pagefile peak reached approximately
  31,021 MB. CPU continued to advance, so no build deadlock was confirmed.
- Static client/server-boundary audit found no confirmed Node-only import in a
  client dependency graph and no confirmed build-time network side effect.

## Verified tests

### Currently run

- `npm run build:vps`: **PASS**, exit `0`, static pages 33/33.

### Previously verified in the same working tree

- `npm run typecheck`: **PASS**.
- `npm run verify:desktop-security`: **PASS**, 7 files and 111 tests.
- `npx vitest run`: **PASS**, exit `0` after the `evidence_items.case_id`
  fixture corrections.
- Focused evidence fixture suites: **PASS** (WORM/vault/unique and
  reconciliation/RLS/metrics).

The ForenZX staging regression has not run because isolated staging
configuration and authorization have not been supplied.

## Court

- Court Pack signing, self-contained trust context, historical revocation
  semantics, and offline verifier regression coverage are present in the
  repository.
- The verifier now fails closed when `--require-timestamp` is requested and
  `timestamp.tsr` is missing or empty.
- RFC 3161 live-TSA round trip, certificate-chain trust validation, and
  standalone-node TSR cryptographic verification remain unverified.
- Court-grade cloud-AI guards are implemented for the currently audited
  Mistral/Gemini server paths, but a functional local evidence-AI provider
  is not implemented.

## Evidence / DB

- New `evidence_items` inserts without `case_id` are rejected by the
  transitional database trigger with SQLSTATE `23502`.
- Existing rows with `case_id IS NULL` are inventoried in
  `evidence_items_legacy_unresolved`; no case association is guessed.
- Evidence fixtures, RLS verification SQL, WORM, unique-key, reconciliation,
  metrics, and vault-commit test adapters now create or use a valid owned case.
- The live database has not been audited in this checkpoint. The remaining
  legacy NULL and unresolved inventory counts are **NOT VERIFIED**. Final
  `case_id NOT NULL` migration is therefore not ready.

## ForenZX

- Job listing now scopes a requested case to the authenticated `user_id`.
- Analysis start records server-authoritative evidence provenance in
  `case_audit_log`.
- Caller-supplied download URLs remain rejected by the evidence provenance
  flow.
- `npm run test:regression:forenzx` is **BLOCKED** pending staging-only URLs,
  credentials, fixture identities, and explicit confirmation.

## AI

- Current runtime has Mistral server paths, Gemini fallback/runtime paths, and
  Electron/browser direct cloud-provider paths.
- `FORENZX_LOCAL_AI_BASE_URL` is a court-grade configuration contract, not a
  functional local inference adapter.
- No AI architecture redesign is part of this checkpoint.

## Deployment

- No deployment, release tag, or staging mutation was performed.
- `build:vps` is a valid local build checkpoint only; it does not verify
  staging, production secrets, or external service reachability.

## Outstanding release blockers

### B1 — Court-grade local evidence-AI execution

- **Severity:** P0.
- **Evidence:** `docs/SOURCE-OF-TRUTH.md` records INV-032 evidence call-site
  wiring as pending; no runtime consumer invokes `FORENZX_LOCAL_AI_BASE_URL`.
- **Blocks:** A court-grade/local-only claim for evidence processing.
- **Definition of Done:** A server-authoritative local provider executes
  evidence tasks; cloud fallback is regression-tested as impossible.

### B2 — Court Pack TSA cryptographic verification

- **Severity:** P0 for timestamp-required Court Pack releases.
- **Evidence:** INV-031 remains NORMATIVE; only timestamp presence and
  fail-closed absence checks are verified locally.
- **Blocks:** Claiming live RFC 3161 trust-chain verification.
- **Definition of Done:** Staging/live TSA round trip, trusted-chain
  validation, and standalone verifier cryptographic TSR verification pass.

### B3 — Evidence `case_id` live transition audit

- **Severity:** P0 for final non-null evidence integrity closure.
- **Evidence:** Migration preserves and inventories legacy NULL rows; no
  safe read-only database audit was available for this checkpoint.
- **Blocks:** `ALTER COLUMN evidence_items.case_id SET NOT NULL`.
- **Definition of Done:** Audited unresolved count is zero after an approved
  resolve-or-retire procedure, then the final NOT NULL migration passes.

### B4 — ForenZX isolated staging regression

- **Severity:** P1 release gate.
- **Evidence:** Regression script requires explicit staging confirmation and
  dedicated staging-only configuration, which is not present.
- **Blocks:** End-to-end verification of webhook, Hub download, SSE, signed
  result, and Supabase job projection.
- **Definition of Done:** Staging target is independently identified,
  isolated fixture identities are supplied, and the opt-in regression passes.
