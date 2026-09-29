# FORENX / PANDORA - Gemini Quality Gate

> **Independent Code Quality Reviewer for FORENX / PANDORA OS**

## Purpose

The **Gemini Quality Gate** is an independent, server-only code reviewer that provides a second opinion on changes to the FORENX / PANDORA codebase. It uses Google's **Gemini** AI models to analyze code for:

- Security vulnerabilities and anti-patterns
- Production readiness and architecture concerns
- Forensic invariants preservation
- Evidence handling correctness
- TypeScript strictness violations
- Concurrency and race condition risks
- Database migration safety
- Authentication and authorization gaps
- Rate limiting and fail-closed behavior

**Mistral remains the PRIMARY IMPLEMENTATION AGENT.**
**Gemini is the SECOND INDEPENDENT REVIEWER.**

---

## Quick Start

### Prerequisites

1. **Google Gemini API Key** - Required to run reviews
2. **Node.js** - Already required by the project
3. **npm** - Already used by the project

### Setup

Add your **SERVER-ONLY** API key to your environment:

```bash
# Option 1: Set in current shell session
export GEMINI_API_KEY="your-gemini-api-key-here"

# Option 2: Add to .env.local (recommended for development)
echo "GEMINI_API_KEY=your-gemini-api-key-here" >> .env.local

# Option 3: Add to .env (never commit this!)
echo "GEMINI_API_KEY=your-gemini-api-key-here" >> .env
```

> **WARNING**: NEVER commit API keys to version control. The `.env.local` file is gitignored by default.

---

## Local Command

```bash
# Basic usage (reviews current git changes)
npm run quality:gemini

# With a specific task description
npm run quality:gemini -- --task "P0-09 rate limiter audit"

# With output file
npm run quality:gemini -- --write-output

# With custom output path
npm run quality:gemini -- --write-output --output-path .qa/review-123.json

# With specific files to review
npm run quality:gemini -- --files "lib/rate-limiter.ts,lib/api/rate-limit/route.ts"

# Show help
npm run quality:gemini -- --help
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEMINI_API_KEY` | **Yes** | - | Google Gemini API key (SERVER-ONLY) |
| `GEMINI_QUALITY_MODEL` | No | `gemini-3.7-flash` | Model to use for reviews |
| `GEMINI_QUALITY_TIMEOUT_MS` | No | `120000` | Request timeout in milliseconds |
| `GEMINI_QUALITY_MAX_FILES` | No | `40` | Maximum files to process |
| `GEMINI_QUALITY_MAX_FILE_BYTES` | No | `157286` | Maximum bytes per file (150 KB) |
| `GEMINI_QUALITY_MAX_TOTAL_CONTEXT` | No | `1048576` | Maximum total context bytes (1 MB) |

Add these to your `.env.example` or `.env.local` files:

```bash
# GEMINI QUALITY GATE
GEMINI_API_KEY=""
GEMINI_QUALITY_MODEL="gemini-3.7-flash"
GEMINI_QUALITY_TIMEOUT_MS="120000"
GEMINI_QUALITY_MAX_FILES="40"
GEMINI_QUALITY_MAX_FILE_BYTES="157286"
GEMINI_QUALITY_MAX_TOTAL_CONTEXT="1048576"
```

---

## Security Boundary

### NEVER

The **Gemini Quality Gate** is a **REVIEW-ONLY** system. It will **NEVER**:

- Commit changes to Git
- Push to remote repositories
- Reset or stash changes
- Delete files
- Run arbitrary shell commands
- Access production secrets
- Modify Supabase or other databases
- Deploy to Vercel or other platforms
- Execute code in your repository

### SERVER-ONLY

The **Gemini Quality Gate**:

- Runs **only** on the server (Node.js)
- **Never** exposes API keys to browser bundles
- **Never** uses `NEXT_PUBLIC_*` environment variables
- **Never** stores API keys in localStorage, sessionStorage, or IndexedDB
- **Never** sends API keys in URLs or query strings

### Redaction

Before sending any code to the **Gemini** API, the system:

1. **Excludes** known secret-bearing files (`.env`, `.pem`, `.key`, `.p12`, etc.)
2. **Redacts** likely secrets from content:
   - JWT tokens and Bearer tokens
   - AWS Access Key IDs (AKIA*, ABIA*, ACCA*, ASIA*)
   - Generic API key patterns (`sk_*`, `pk_*`, etc.)
   - Private key headers (PEM format)
   - Certificate headers
   - High-entropy strings (32+ hex chars, 64+ base64 chars)
   - Authorization headers

> **WARNING**: Regex-based redaction is **NOT** a guarantee. The real security boundary is that secrets should **NEVER** be committed to the repository.

---

## REVIEW_ONLY Behavior

The **Gemini Quality Gate** operates in **REVIEW_ONLY** mode by default. This means:

1. **Read-Only**: Only reads repository files, never writes
2. **Safe Commands**: Only executes pre-approved, read-only Git commands:
   - `git branch --show-current`
   - `git rev-parse HEAD`
   - `git status --short`
   - `git diff --stat`
   - `git diff --name-status`
   - `git diff --no-ext-diff`
3. **No Code Execution**: Never executes code from the repository
4. **No Shell Access**: Never provides shell access to the AI

---

## Exit Codes

| Code | Meaning | Description |
|------|--------|-------------|
| 0 | `SAFE_TO_ACCEPT_LOCALLY` | Code is safe to accept locally |
| 1 | `NEEDS_PATCH` | Code needs patches before acceptance |
| 2 | `REJECT` | Code should be rejected |
| 3 | `EXECUTOR_ERROR` | Configuration or API failure |

Use these in CI/CD pipelines:

```bash
# Exit with appropriate code
npm run quality:gemini
echo "Exit code: $?"

# Fail CI on REJECT
npm run quality:gemini
if [ $? -eq 2 ]; then
  echo "Quality Gate: REJECT - Failing CI"
  exit 1
fi
```

---

## Output Format

### Console Output

```
═══════════════════════════════════════════════════════════════════════
FORENX QUALITY GATE
═══════════════════════════════════════════════════════════════════════

Verdict: NEEDS_PATCH
Readiness: 72/100

Findings:
  Critical: 0
  High: 2
  Medium: 3
  Low: 1
  Informational: 0

False Confidence:
  - PostgreSQL migration execution
  - Vercel multi-instance behavior

Unverified:
  - Rate limiting under concurrent load

Minimal Required Action:
  Run migration against local PostgreSQL.

Metadata:
  Model: gemini-3.7-flash
  Reviewed: 2026-09-28T10:00:00.000Z
  Commit: abc12345
  Branch: main
  Files: 5
  Secrets Redacted: 0
═══════════════════════════════════════════════════════════════════════
```

### JSON Output File

When `--write-output` is specified, the result is also written to `.qa/gemini-quality-gate.json`:

```json
{
  "result": {
    "verdict": "NEEDS_PATCH",
    "productionReadiness": 72,
    "findings": [
      {
        "id": "finding-001",
        "severity": "HIGH",
        "file": "lib/rate-limiter.ts",
        "symbol": "rateLimiter",
        "failureMode": "TOCTOU race condition in read-modify-write",
        "impact": "Multiple concurrent requests can bypass rate limiting",
        "proof": "Line 42: const count = this.get(key); this.set(key, count + 1);",
        "requiredFix": "Use atomic operations or distributed lock for multi-instance deployments",
        "lineNumber": 42,
        "columnNumber": 5
      }
    ],
    "falseConfidence": [
      "PostgreSQL migration execution not verified"
    ],
    "unverified": [
      "Vercel multi-instance behavior not tested"
    ],
    "minimalRequiredAction": "Run migration against local PostgreSQL and test rate limiting under concurrent load",
    "metadata": {
      "model": "gemini-3.7-flash",
      "reviewedAt": "2026-09-28T10:00:00.000Z",
      "commitSha": "abc12345def67890",
      "branch": "main",
      "changedFiles": [
        "lib/rate-limiter.ts"
      ],
      "secretRedactionsCount": 0,
      "contextTruncated": false,
      "totalContextBytes": 1024
    }
  },
  "rawResponse": "{...}",
  "timestamp": "2026-09-28T10:00:00.000Z"
}
```

---

## Verdicts

### SAFE_TO_ACCEPT_LOCALLY

Code passes the quality gate with no critical issues. Readiness score is typically 76-100.

**Recommended Action**: Accept locally, but still perform manual review for critical systems.

### NEEDS_PATCH

Code has issues that should be addressed before acceptance. Readiness score is typically 21-75.

**Recommended Action**: Apply the suggested fixes and re-run the quality gate.

### REJECT

Code has fundamental problems that make it unsafe. Readiness score is typically 0-20.

**Recommended Action**: Do not accept. Significant refactoring or redesign is required.

---

## Severity Levels

| Level | Weight | Examples |
|-------|--------|----------|
| **CRITICAL** | Must fix | Auth bypass, evidence corruption, secret exposure, production fail-open |
| **HIGH** | Must fix | WORM bypass, invalid migration, privileged RPC exposed, tenant leakage |
| **MEDIUM** | Should fix | Missing validation, race conditions, incomplete error handling |
| **LOW** | Nice to fix | Minor type issues, non-critical edge cases |
| **INFORMATIONAL** | Optional | Style suggestions, documentation improvements |

---

## Project Structure

```
forenx-pandora-os/
├── lib/
│   └── quality-gate/
│       ├── index.ts                  # Public API exports
│       ├── quality-gate-schema.ts    # Zod types and schemas
│       ├── quality-gate-system-prompt.ts  # FORENX-specific system prompt
│       ├── gemini-client.ts         # @google/genai client wrapper
│       ├── redaction.ts             # Secret redaction utilities
│       ├── repository-context.ts     # Git context collector
│       ├── quality-gate-runner.ts    # Main runner (entry point)
│       └── __tests__/
│           ├── quality-gate-schema.test.ts
│           └── redaction.test.ts
│
└── scripts/
    └── gemini-quality-gate.ts        # CLI entry point
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLI (scripts/gemini-quality-gate.ts)          │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    QualityGateRunner                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. Validate Request (Zod)                                     ││
│  │ 2. Collect Context (Git, FS)                                  ││
│  │ 3. Redact Secrets (Regex patterns)                            ││
│  │ 4. Build Prompt (System + Context)                            ││
│  │ 5. Call Gemini (via @google/genai)                            ││
│  │ 6. Validate Response (Zod)                                   ││
│  │ 7. Return Normalized Result                                  ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────┬───────────────────────────────────────┘
                          │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Schema         │ │ Repository      │ │ Gemini          │
│  (Zod validation)│ │ Context         │ │ Client          │
│                 │ │ (Git + FS read) │ │ (@google/genai) │
└─────────────────┘ └─────────────────┘ └─────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   Output          │
                    │   (JSON + Console)│
                    └───────────────────┘
```

---

## Readiness Score

The **Production Readiness Score** (0-100) indicates technical readiness:

| Score | Meaning |
|-------|---------|
| 0-20 | Fundamentally unsafe |
| 21-40 | Major architecture/security defects |
| 41-60 | Local functionality but significant production risk |
| 61-75 | Reasonable implementation but important validation missing |
| 76-90 | Strong implementation with limited unresolved validation |
| 91-99 | Strong production evidence with residual operational risk |
| 100 | Exceptionally proven behavior |

> **Note**: Unit tests passing does NOT inflate the score. The score is based on actual production evidence.

---

## Testing

Run the quality gate tests:

```bash
# Run only quality gate tests
npx vitest run lib/quality-gate/__tests__/

# Run all tests
npm test
```

Test coverage includes:

- Schema validation (Zod)
- Secret redaction patterns
- Environment validation
- Configuration parsing
- Result formatting

---

## CI Integration (Future)

> **NOT IMPLEMENTED YET**: This PR does NOT make the quality gate mandatory in CI.

Future CI integration will require:

1. **API Cost Management**: Rate limits and costs must be understood
2. **External Availability**: Google API availability in CI environment
3. **Secret Configuration**: Secure handling of API keys in CI
4. **Performance**: Quality gate must complete within CI timeout limits

For now, use the **LOCAL** command for manual code reviews.

---

## Troubleshooting

### "GEMINI_API_KEY is not set or is invalid"

Ensure your API key is set and has sufficient length (at least 16 characters):

```bash
# Check if set
echo $GEMINI_API_KEY

# Check length
 echo $GEMINI_API_KEY | wc -c
```

### "Model ... is not available or not supported"

Check that your `GEMINI_QUALITY_MODEL` value is valid:

```bash
echo $GEMINI_QUALITY_MODEL
```

Valid values include `gemini-3.7-flash`, `gemini-2.5-flash`, etc. See the [Google GenAI documentation](https://ai.google.dev/gemini-api/docs/models) for available models.

### "Context too large"

The context (code + diff) exceeds the configured limits. Either:

1. Reduce the number of changed files
2. Increase the limits:

```bash
export GEMINI_QUALITY_MAX_FILES=100
export GEMINI_QUALITY_MAX_FILE_BYTES=2097152
export GEMINI_QUALITY_MAX_TOTAL_CONTEXT=4194304
```

### "Dependency timeout"

The request to the **Gemini** API timed out. Either:

1. Check your network connection
2. Increase the timeout:

```bash
export GEMINI_QUALITY_TIMEOUT_MS=300000
```

### "Invalid model response"

The **Gemini** API returned a response that doesn't match the expected schema. This could be:

1. A transient API error
2. A change in the API response format
3. The model returning non-JSON output

---

## License

This quality gate is part of the **FORENX / PANDORA OS** project. All existing licenses and terms apply.

---

## Contributing

To extend or modify the **Gemini Quality Gate**:

1. **DO NOT** modify forensic evidence logic
2. **DO NOT** modify WORM ledger logic
3. **DO NOT** modify sourceRef/evidence binding
4. **DO NOT** modify Mistral forensic prompts
5. **DO NOT** create new project architecture

Add new tests for any modifications to ensure the quality gate remains reliable.

---

## Changelog

| Date | Version | Changes |
|------|---------|---------|
| 2026-09-28 | 1.0.0 | Initial implementation |
