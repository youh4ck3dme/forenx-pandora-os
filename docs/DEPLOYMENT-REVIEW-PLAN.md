# Deployment review plan

## Scope

This plan records the manual review required before any production deployment work derived from the large release branch is accepted. It authorizes no deployment, infrastructure access, secret change, database migration, container publication, cron installation, or VPS cleanup.

## Preconditions

Before approval, use a clean worktree based on the then-current `main` and verify:

1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npx vitest run`
5. `npm run audit:ast`
6. the exact commit, artifact digest, and migration set under review

All environment values must remain in the deployment environment or approved secret store. Do not place values in source, issue comments, pull requests, logs, or shell history.

## Manual approval gates

### Database and Supabase

Manual schema and RLS review is required for all files under `supabase/migrations/`, including policies, RPCs, buckets, triggers, and storage rules. Apply migrations first in an isolated staging project with fixture data only. Confirm rollback behavior and that a failed migration cannot weaken ownership, evidence integrity, or audit controls.

### Web and authentication runtime

Manual security review is required for `middleware.ts`, `integrations/supabase/auth-middleware.ts`, `lib/auth/**`, `lib/storage/vault-auth.ts`, `lib/security/**`, `app/api/auth/**`, `app/api/vault/**`, `app/api/forenzx/**`, and `app/api/health/**`.

Verify server-side authentication, route classification, redirect handling, authorization, rate limits, correlation IDs, error redaction, and the invariant `AI OUTPUT ≠ EVIDENCE` before release.

### Container and CI

Manual CI review is required for `.github/workflows/**`, `docker/Dockerfile.production`, `.dockerignore`, `scripts/vercel-preflight.mjs`, and `scripts/deploy/**`.

Review every build argument and environment variable name without printing values. Confirm that public build-time values are deliberately public, server secrets are unavailable to the browser bundle, image publishing uses an immutable digest, and secret scanning remains enabled.

### VPS, proxy, cron, and operations

The following files require explicit infrastructure-owner approval and must not be executed by a repository merge alone:

- `deploy/vps/apache-pandora.conf`
- `deploy/vps/000-maintenance.conf`
- `deploy/vps/deploy-release.sh`
- `deploy/vps/safe-vps-cleanup.sh`
- `deploy/vps/setup-verification-cron.sh`
- `deploy/vps/verify-cron.sh`
- `deploy/vps/verify-vps-env.sh`
- `deploy/vps/alert-watchdog.sh`
- `deploy/nginx.conf`

Required review topics are trusted-proxy boundaries, loopback-only upstream access, TLS ownership, cron authorization, failure handling, disk cleanup scope, backup/rollback readiness, health checks, alert routing, and least privilege.

## Release sequencing

1. Merge and validate application-only pull requests first.
2. Review and apply database migrations in staging.
3. Run staging regression and operational health checks.
4. Review the exact container digest and release artifact.
5. Obtain explicit infrastructure approval for proxy, cron, alerting, and cleanup changes.
6. Schedule production deployment separately with a rollback owner and verification checklist.

## Current decision

The broad release pull request remains unsuitable for a one-step merge because it combines application behavior, schema changes, CI, container packaging, and VPS operations. Split review and explicit approval are required for every deployment-facing component.
