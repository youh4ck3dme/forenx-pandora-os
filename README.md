# PΛND0RΛ / ForenX

## Forensic Intelligence & Evidence Operating System

PANDORA / ForenX is a case-centered platform for preserving, verifying, analyzing, and auditing digital evidence. Its governing rule is:

> **AI output is not evidence.**

AI findings remain hypotheses until bound to a verified source. Runtime behavior, evidence integrity, and auditability take precedence over presentation or model output.

## Architecture

- **Web application:** Next.js, React, and TypeScript; production process runs under PM2 behind nginx.
- **Identity and data:** Supabase Auth and PostgreSQL, with case-scoped ownership checks, Row Level Security (RLS), constraints, and server-side functions.
- **Evidence:** S3-compatible object storage plus a PostgreSQL evidence ledger, SHA-256 verification, source snapshots, and append-only audit history.
- **Analysis:** Forza case workflows and server-side AI integrations. AI output is parsed, schema-validated, and checked against authorized evidence before persistence.
- **Clients:** Browser/PWA and Electron desktop; mobile configuration is isolated under `mobile/`.

## Forensic invariants

1. **Provenance:** A finding must refer to evidence or a captured source snapshot. AI-generated claims do not become evidence by being stored or repeated.
2. **Integrity:** Evidence is bound to case, owner, storage reference, and verified SHA-256. Failed verification fails closed.
3. **Authorization:** Authenticate first, then verify case ownership and evidence ownership. Client-supplied IDs never grant access.
4. **Append-only history:** Audit events and immutable analysis runs preserve who/what/when and their hash lineage.
5. **Determinism where required:** Calculated time deltas and severity are computed by application logic, not delegated to a language model.
6. **No silent downgrade:** Missing authorization, integrity, or persistence guarantees must reject the operation rather than create an apparently valid result.

## Key features

### Asset Timeline Forensics — “Časostroj majetku & Detektor bielych koní”

PR [#61](https://github.com/youh4ck3dme/forenx-pandora-os/pull/61) adds an evidence-bound workflow for correlating asset-related events across a case. **It is not yet merged or deployed; its database migration has not been applied to production.** The feature must not be treated as available in the live product until those release steps are completed.

The workflow is designed to:

- Bind each analysis input to owned case evidence and its verified SHA-256; include those verified hashes in the canonical input digest.
- Validate quoted text against the referenced source and verify source references before accepting a finding. Invalid or unsupported legal/source claims are downgraded rather than presented as verified.
- Preserve date-only values and unknown times without inventing precision.
- Compute elapsed time and severity deterministically in application code.
- Record prompt version/hash and the actual provider/model used, including provider fallback.
- Store each result as a separate immutable run with result SHA-256, evidence bindings, workflow metadata, and audit event.
- Enforce canonical idempotency and link reruns through `supersedes_run_id`; client-provided idempotency values cannot redefine the canonical input identity.
- Restrict writes to the server/service role. Authenticated clients may read only their own case runs under RLS; update and delete are blocked.

## Production deployment

| Item | Current production configuration |
|---|---|
| Public app | [pandora.whoiswho.at](https://pandora.whoiswho.at) |
| VPS | `2.29.52.59` |
| Application directory | `/var/www/pandora-browser` |
| Process | PM2 `pandora-browser`, port `3005` |
| Reverse proxy | nginx |
| Production database | Supabase project `tlmuvzrgighahnjkxoyw` |
| Main baseline | `2a8caca485467bbc09ecbd3e49e98a727ce78a1c` |

The official VPS release entry point is `scripts/deploy/staging-update.sh`. It defaults to a dry run, builds and smoke-checks a separate release before switching, reloads PM2, and rolls back on failure. It does **not** apply database migrations. Migration deployment is a separate, reviewed operation.

## Database

Supabase/PostgreSQL schema changes are versioned in `supabase/migrations/`. Production uses project `tlmuvzrgighahnjkxoyw`.

- Review migration status and the exact pending plan before applying a migration.
- Never use `supabase db reset` against production.
- Never apply a migration by editing hosted schema manually or manipulating migration history without evidence.
- Asset Timeline migration `20261010120000_asset_timeline_forensics.sql` is on PR #61 only and is **not applied to production**.

## AI

Provider credentials are server-side. AI is an untrusted analysis component: requests are authenticated, consent and ownership are checked, evidence is bound and verified, and structured output is validated before immutable persistence. Prompt and provider/model provenance are retained with the result. Secrets must never appear in README, source control, browser bundles, URLs, or logs.

## Testing and verification

Run the checks relevant to the change, and report their results separately:

```bash
npm run typecheck
npx vitest run
npm run build
```

Database behavior requires migration/RLS verification against the intended database. A successful unit test, build, or health endpoint alone does not prove production behavior. The production smoke endpoint is `/api/healthz`.

## Release and deploy procedure

1. Review the code and migration on the intended branch; run typecheck, targeted tests, the applicable full test suite, and build.
2. Review migration ordering and the remote migration state. Apply migrations only through the approved, explicit database procedure; the VPS deploy script never applies them.
3. Merge the reviewed release to `main).
4. Run `scripts/deploy/staging-update.sh` to inspect the plan. Use `--apply` only for the intended release; if new migrations are present, explicitly acknowledge that script guard and apply the migration separately according to the database procedure.
5. Verify the deployed commit, PM2 process, HTTP health endpoint, application smoke checks, and any changed end-to-end workflow. Record evidence for each result.

## Security boundaries

- Browser and desktop clients are untrusted. Never expose Supabase service-role, S3, database, or AI-provider credentials to them.
- Enforce authentication, case ownership, and evidence ownership on the server; RLS provides the database boundary as well.
- Only trusted server code may write Asset Timeline runs. Client access is read-only and constrained by RLS.
- Treat uploads, external sources, model responses, and client identifiers as untrusted input.
- Preserve immutable evidence and audit records; do not silently replace or overwrite previous analysis runs.
- Do not include secrets or sensitive production configuration values in documentation.

## Current status — 10 October 2026

- **Production runtime:** The public application and `/api/healthz` both returned HTTP 200 during the README update check.
- **Autopilot 403 fix:** Verified with HTTP 200 and a completed workflow.
- **Production baseline:** `main` baseline `2a8caca485467bbc09ecbd3e49e98a727ce78a1c`.
- **Asset Timeline Forensics PR #61:** Open, not merged, not deployed; its migration is not applied to production.
- **Secrets:** No credentials are documented here.

## License

WTFPL — Do What The Fuck You Want To Public License.
