# Production deployment

## Vercel web/API deployment

Import `youh4ck3dme/forenx-pandora-os` into Vercel and use the repository
configuration. The build command is `npm run verify:vercel-deploy`, which runs
the strict environment preflight before the complete production quality gate.

Assign the following values to the **Production** environment. Add the same
server secrets to Preview only when its data must target an isolated nonproduction
Supabase project and S3 bucket.

| Variable | Scope | Requirement |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | Public | `https://pandora.whoiswho.at` |
| `NEXT_PUBLIC_RP_ID` | Public | `pandora.whoiswho.at` |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Supabase publishable/anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Server-only; never prefix with `NEXT_PUBLIC_` |
| `MISTRAL_API_KEY` | Secret | Single shared Mistral key, or use both dedicated keys below |
| `MISTRAL_API_KEY_CHAT` | Secret | Required with `MISTRAL_API_KEY_ANALYSIS` when split keys are used |
| `MISTRAL_API_KEY_ANALYSIS` | Secret | Required with `MISTRAL_API_KEY_CHAT` when split keys are used |
| `MISTRAL_MODEL` | Server | Optional; defaults to `mistral-large-latest` |
| `S3_ENDPOINT` | Server | Hetzner S3 HTTPS endpoint |
| `S3_REGION` | Server | Hetzner region, normally `hel1` |
| `S3_BUCKET` | Server | Dedicated production bucket |
| `S3_ACCESS_KEY_ID` | Secret | Least-privileged production S3 key |
| `S3_SECRET_ACCESS_KEY` | Secret | Matching production S3 secret |
| `S3_FORCE_PATH_STYLE` | Server | `true` for the current Hetzner path-style signer |
| `FORENX_ADMIN_EMAILS` | Secret | Comma-separated administrator allowlist |

`/api/vault` is fail-closed in production: it returns HTTP 503 instead of
using its development in-memory fallback when S3 credentials are absent.

## Evidence vault release blocker

The current vault route accepts multipart uploads and performs server-side hash
verification. Vercel serverless request-body and execution limits make this
unsuitable for the supported 250 MB evidence limit. Do **not** expose evidence
ingest publicly until it is migrated to authenticated direct-to-S3 multipart
uploads with a server-issued short-lived upload capability and a persistent
Supabase evidence ledger. The Vercel deployment can host the web application,
but this blocker must be resolved before treating it as a production forensic
vault.

## Electron release

Electron is not deployed to Vercel. Build Windows artifacts locally or in a
trusted release runner:

```powershell
npm run electron:build
```

The verified Windows artifacts are emitted in `dist\`. Before a public desktop
release, configure platform-specific code-signing certificates and publish
through a controlled updater/release workflow.
