/**
 * Vercel Production Environment Preflight Audit
 *
 * Scans environment variables required for full cloud functionality:
 * - Supabase PostgreSQL & Auth
 * - S3 Evidence Vault (Hetzner / AWS)
 * - Mistral AI Engine
 * - WebAuthn RP Configuration
 * - Live SumUp subscriptions and renewal cron
 */

const isStrict = process.argv.includes("--strict") || process.env.STRICT_ENV_CHECK === "true";

const coreConfig = [
  { name: "NEXT_PUBLIC_BASE_URL", desc: "Production URL (e.g. https://pandora.vercel.app)" },
  { name: "NEXT_PUBLIC_RP_ID", desc: "WebAuthn RP Hostname (e.g. pandora.vercel.app)" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", desc: "Supabase Project URL" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", desc: "Supabase Public Anon Key" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", desc: "Supabase Admin Service Role Key" },
  { name: "S3_ENDPOINT", desc: "S3 Vault Endpoint (e.g. https://hel1.your-objectstorage.com)" },
  { name: "S3_REGION", desc: "S3 Vault Region (e.g. hel1)" },
  { name: "S3_BUCKET", desc: "S3 Bucket Name (default: forenx-vault-sk)" },
  { name: "S3_ACCESS_KEY_ID", desc: "S3 Vault Access Key ID" },
  { name: "S3_SECRET_ACCESS_KEY", desc: "S3 Vault Secret Access Key" },
  { name: "FORENZX_S3_REGION", desc: "ForenZX evidence S3 region" },
  { name: "FORENZX_S3_BUCKET", desc: "ForenZX evidence S3 bucket" },
  { name: "FORENZX_S3_ACCESS_KEY_ID", desc: "ForenZX evidence S3 access key" },
  { name: "FORENZX_S3_SECRET_ACCESS_KEY", desc: "ForenZX evidence S3 secret key" },
  { name: "FORENZX_M2M_SECRET", desc: "At least 32 characters; signs evidence capabilities" },
  { name: "FORENZX_EVIDENCE_WEBHOOK_URL", desc: "HTTPS URL for the ForenZX evidence webhook" },
  { name: "FORENZX_WEBHOOK_SECRET", desc: "Server-only secret for authenticated evidence dispatch" },
  { name: "SUMUP_API_KEY", desc: "Server-only SumUp live API key" },
  { name: "SUMUP_MERCHANT_CODE", desc: "Live SumUp merchant code" },
  { name: "SUMUP_ENVIRONMENT", desc: "Must be live for production subscriptions" },
  { name: "CRON_SECRET", desc: "At least 32 characters; protects recurring billing cron" },
];

console.log("\n=======================================================");
console.log("  🔍 PΛND0RΛ / FORENX - VERCEL ENVIRONMENT AUDIT");
console.log("=======================================================\n");

let missingCount = 0;

for (const item of coreConfig) {
  const val = process.env[item.name]?.trim();
  const status = val ? "✅ CONFIGURED" : "⚠️  MISSING";
  if (!val) missingCount++;
  console.log(` ${status.padEnd(16)} | ${item.name.padEnd(30)} | ${item.desc}`);
}

if (process.env.SUMUP_ENVIRONMENT?.trim() && process.env.SUMUP_ENVIRONMENT.trim() !== "live") {
  missingCount++;
  console.log(` ${"⚠️  TEST MODE".padEnd(16)} | ${"SUMUP_ENVIRONMENT".padEnd(30)} | Production billing requires live mode`);
}
const cronSecret = process.env.CRON_SECRET?.trim();
if (cronSecret && cronSecret.length < 32) {
  missingCount++;
  console.log(` ${"⚠️  TOO SHORT".padEnd(16)} | ${"CRON_SECRET".padEnd(30)} | Must be at least 32 characters`);
}
const m2mSecret = process.env.FORENZX_M2M_SECRET?.trim();
if (m2mSecret && m2mSecret.length < 32) {
  missingCount++;
  console.log(` ${"⚠️  TOO SHORT".padEnd(16)} | ${"FORENZX_M2M_SECRET".padEnd(30)} | Must be at least 32 characters`);
}
const forenzxS3Endpoint = process.env.FORENZX_S3_ENDPOINT?.trim();
if (forenzxS3Endpoint && !forenzxS3Endpoint.startsWith("https://")) {
  missingCount++;
  console.log(` ${"⚠️  INVALID URL".padEnd(16)} | ${"FORENZX_S3_ENDPOINT".padEnd(30)} | Must use HTTPS in production`);
}
const evidenceWebhookUrl = process.env.FORENZX_EVIDENCE_WEBHOOK_URL?.trim();
if (evidenceWebhookUrl && !evidenceWebhookUrl.startsWith("https://")) {
  missingCount++;
  console.log(` ${"⚠️  INVALID URL".padEnd(16)} | ${"FORENZX_EVIDENCE_WEBHOOK_URL".padEnd(30)} | Must use HTTPS in production`);
}

const mistralConfigured = Boolean(
  process.env.MISTRAL_API_KEY?.trim() ||
  (process.env.MISTRAL_API_KEY_CHAT?.trim() && process.env.MISTRAL_API_KEY_ANALYSIS?.trim())
);
const aiStatus = mistralConfigured ? "✅ CONFIGURED" : "⚠️  MISSING";
if (!mistralConfigured) missingCount++;
console.log(` ${aiStatus.padEnd(16)} | ${"MISTRAL_API_KEY".padEnd(30)} | Mistral Large AI Engine Key`);

console.log("\n-------------------------------------------------------");

if (missingCount === 0) {
  console.log("🎉 All production cloud environment variables are configured!\n");
  process.exit(0);
} else {
  console.log(`ℹ️  ${missingCount} cloud variables are unconfigured.`);
  console.log("   The application will run with graceful local / in-memory fallbacks.");
  console.log("   Configure these in Vercel Dashboard -> Settings -> Environment Variables for 100% production functionality.\n");

  if (isStrict) {
    console.error("❌ STRICT MODE: Failing build due to unconfigured production variables.");
    process.exit(1);
  } else {
    process.exit(0);
  }
}
