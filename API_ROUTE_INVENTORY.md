# API Route Inventory - PANDORA/FORENZX

## Overview

This document provides a complete inventory of all API routes in the PANDORA/FORENZX application, including their:
- HTTP methods
- Current authentication mechanisms
- Middleware classification
- Expected security category
- Server-side authorization status
- Risk assessment

## Classification Categories

- **PUBLIC**: Accessible without authentication (e.g., CSP reports, health checks)
- **SYSTEM**: Internal system endpoints (machine-to-machine, cron, etc.)
- **AUTHENTICATED**: Requires valid Supabase session
- **PROJECT_REQUIRED**: Requires authenticated user with case access

## Route Inventory

### 1. `/api/csp-report`

| Aspect | Value |
|--------|-------|
| **Methods** | POST |
| **Current Auth** | None (write-only, rate-limited) |
| **Middleware Category** | PUBLIC |
| **Expected Category** | PUBLIC |
| **Server-Side Auth** | None required (browser-sent reports) |
| **Risk** | LOW |
| **Notes** | CSP violation reports from browsers. Must remain unauthenticated as browsers send these without credentials. Has rate limiting (20/IP/min), payload validation, sanitization, and writes to error_logs only. |

### 2. `/api/csp-report/*`

| Aspect | Value |
|--------|-------|
| **Methods** | POST |
| **Current Auth** | None |
| **Middleware Category** | PUBLIC |
| **Expected Category** | PUBLIC |
| **Server-Side Auth** | None required |
| **Risk** | LOW |
| **Notes** | Wildcard path for CSP reports. Same security considerations as `/api/csp-report`. |

### 3. `/api/healthz`

| Aspect | Value |
|--------|-------|
| **Methods** | GET |
| **Current Auth** | None |
| **Middleware Category** | PUBLIC |
| **Expected Category** | PUBLIC |
| **Server-Side Auth** | None required |
| **Risk** | LOW |
| **Notes** | Health check endpoint for external monitoring. Returns minimal safe response with service name and timestamp. No secrets or sensitive data. |

### 4. `/api/health/observe`

| Aspect | Value |
|--------|-------|
| **Methods** | GET, POST |
| **Current Auth** | `authenticateVaultRequest()` |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Vault authentication |
| **Risk** | LOW |
| **Notes** | POST: Client error reporting with vault auth. GET: Operational metrics for admins only (checked via health_metrics RPC). Both use existing vault-auth mechanism. |

### 5. `/api/vault`

| Aspect | Value |
|--------|-------|
| **Methods** | GET, POST |
| **Current Auth** | `authenticateVaultRequest()` |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Vault authentication + case ownership verification |
| **Risk** | MEDIUM |
| **Notes** | GET: List evidence for a case. POST: Upload evidence. Both require vault auth and verify case ownership via `verifyCaseOwnership()`. Audit logging via `logVaultAccess()`. |

### 6. `/api/vault/*`

| Aspect | Value |
|--------|-------|
| **Methods** | GET, POST |
| **Current Auth** | `authenticateVaultRequest()` |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Vault authentication |
| **Risk** | MEDIUM |
| **Notes** | Wildcard for vault sub-routes. Protected by vault auth. |

### 7. `/api/vault/commit`

| Aspect | Value |
|--------|-------|
| **Methods** | POST |
| **Current Auth** | `authenticateVaultRequest()` |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Vault authentication |
| **Risk** | MEDIUM |
| **Notes** | Commits evidence to ledger after direct S3 upload. Uses `authenticateVaultRequest()` and requires ledger configuration. |

### 8. `/api/vault/presign`

| Aspect | Value |
|--------|-------|
| **Methods** | POST |
| **Current Auth** | `authenticateVaultRequest()` |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Vault authentication + case ownership |
| **Risk** | MEDIUM |
| **Notes** | Generates presigned URLs for direct S3 uploads. Requires vault auth and verifies case ownership. |

### 9. `/api/vault/verify`

| Aspect | Value |
|--------|-------|
| **Methods** | GET, POST |
| **Current Auth** | `isAuthorizedCronRequest()` with `CRON_SECRET` |
| **Middleware Category** | SYSTEM |
| **Expected Category** | SYSTEM |
| **Server-Side Auth** | ✅ CRON_SECRET verification |
| **Risk** | LOW |
| **Notes** | Server-side verification of evidence hashes. Machine-to-machine endpoint for cron/worker jobs. Authorized via `CRON_SECRET` header check. Without CRON_SECRET configured, returns 503. |

### 10. `/api/vault/verify/*`

| Aspect | Value |
|--------|-------|
| **Methods** | GET, POST |
| **Current Auth** | `isAuthorizedCronRequest()` with `CRON_SECRET` |
| **Middleware Category** | SYSTEM |
| **Expected Category** | SYSTEM |
| **Server-Side Auth** | ✅ CRON_SECRET verification |
| **Risk** | LOW |
| **Notes** | Wildcard for vault verify sub-routes. Same auth as `/api/vault/verify`. |

### 11. `/api/audit/access`

| Aspect | Value |
|--------|-------|
| **Methods** | POST |
| **Current Auth** | Bearer token validation via Supabase |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Supabase token validation |
| **Risk** | MEDIUM |
| **Notes** | Logs case access audits. Validates Supabase JWT token via `supabase.auth.getUser()`. In production, rejects without valid token (401). In dev, allows without audit. |

### 12. `/api/fn/[...id]`

| Aspect | Value |
|--------|-------|
| **Methods** | POST, OPTIONS |
| **Current Auth** | `requireSupabaseAuth` per function |
| **Middleware Category** | AUTHENTICATED |
| **Expected Category** | AUTHENTICATED |
| **Server-Side Auth** | ✅ Per-function Supabase auth (in registry) |
| **Risk** | MEDIUM |
| **Notes** | Server function gateway. Each function in registry server enforces its own auth via `requireSupabaseAuth()`. POST handles function execution, OPTIONS handles CORS preflight. |

## Summary Table

| Route | Methods | Category | Auth Mechanism | Risk |
|-------|---------|----------|---------------|------|
| `/api/csp-report` | POST | PUBLIC | None | LOW |
| `/api/csp-report/*` | POST | PUBLIC | None | LOW |
| `/api/healthz` | GET | PUBLIC | None | LOW |
| `/api/health/observe` | GET, POST | AUTHENTICATED | Vault auth | LOW |
| `/api/vault` | GET, POST | AUTHENTICATED | Vault auth + case ownership | MEDIUM |
| `/api/vault/*` | GET, POST | AUTHENTICATED | Vault auth | MEDIUM |
| `/api/vault/commit` | POST | AUTHENTICATED | Vault auth | MEDIUM |
| `/api/vault/presign` | POST | AUTHENTICATED | Vault auth + case ownership | MEDIUM |
| `/api/vault/verify` | GET, POST | SYSTEM | CRON_SECRET | LOW |
| `/api/vault/verify/*` | GET, POST | SYSTEM | CRON_SECRET | LOW |
| `/api/audit/access` | POST | AUTHENTICATED | Supabase token | MEDIUM |
| `/api/fn/[...id]` | POST, OPTIONS | AUTHENTICATED | Per-function Supabase auth | MEDIUM |

## Public Routes Explanation

The following routes remain PUBLIC and require no authentication:

1. **`/api/healthz`** - External health monitoring endpoint. Must be accessible without credentials to allow monitoring systems to check service status.

2. **`/api/csp-report`** and **`/api/csp-report/*`** - Content Security Policy violation reports. Browsers automatically send these reports without user credentials. Requiring authentication would break CSP reporting entirely.

All PUBLIC routes have appropriate safeguards:
- Input validation and sanitization
- Rate limiting
- Write-only operations (no sensitive data returned)
- No access to user data or privileged information

## Machine-to-Machine Routes

The following routes use machine-to-machine authentication:

1. **`/api/vault/verify`** and **`/api/vault/verify/*`** - Use CRON_SECRET for cron job authentication. This is a shared secret model appropriate for internal system processes.

## Key Security Properties

### ✅ Strengths

1. **All routes have defined authentication**: Every API route has either explicit auth checks or is intentionally PUBLIC/SYSTEM.

2. **No route relies on middleware alone**: Even routes classified by middleware have additional server-side authorization (vault-auth, Supabase token validation, CRON_SECRET checks).

3. **PUBLIC routes are minimal and safe**: Only health checks and CSP reports are PUBLIC, both with appropriate safeguards.

4. **Vault routes have strong protection**: All `/api/vault/*` routes use the existing `authenticateVaultRequest()` which provides:
   - Supabase session validation
   - Case ownership verification
   - Audit logging
   - Dev bypass only in safe conditions

5. **Cron routes are isolated**: `/api/vault/verify` uses CRON_SECRET, not user sessions, preventing any user from triggering verification.

### ⚠️ Considerations

1. **Middleware matcher now includes `/api/*`**: The updated middleware matcher processes all API routes, providing baseline auth protection while static assets remain excluded.

2. **Default protection**: Any new `/api/*` route not explicitly classified will default to AUTHENTICATED, requiring a valid Supabase session.

3. **Status code consistency**: API routes return 401 JSON (not HTML redirects) when authentication fails. Page routes redirect to login.

## Recommendations

1. **Maintain the route classification system** in middleware.ts for centralized control.

2. **Preserve existing auth mechanisms**: The current vault-auth, Supabase token validation, and CRON_SECRET models work well and should not be replaced.

3. **Add new routes carefully**: Always explicitly classify new API routes or they will default to AUTHENTICATED (which is safe).

4. **Test PUBLIC routes**: Ensure `/api/healthz` and `/api/csp-report` remain accessible without authentication in all environments.

5. **Audit CRON_SECRET usage**: Ensure CRON_SECRET is properly configured in production and rotated periodically.
