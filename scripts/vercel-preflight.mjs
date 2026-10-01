/**
 * Vercel Production Environment Preflight Audit
 *
 * Scans environment variables required for full cloud functionality:
 * - Supabase PostgreSQL & Auth
 * - S3 Evidence Vault (Hetzner / AWS)
 * - Mistral AI Engine
 * - WebAuthn RP Configuration
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
  { name: "CRON_SECRET", desc: "Evidence Verification Cron Secret (min 32 chars)" },
];

console.log("\n=======================================================");
console.log("  🔍 PΛND0RΛ / FORENX - ENVIRONMENT AUDIT & PREFLIGHT");
console.log("=======================================================\n");

let missingCount = 0;

for (const item of coreConfig) {
  const val = process.env[item.name]?.trim();
  const status = val ? "✅ CONFIGURED" : "⚠️  MISSING";
  if (!val) missingCount++;
  console.log(` ${status.padEnd(16)} | ${item.name.padEnd(30)} | ${item.desc}`);
}

const mistralConfigured = Boolean(
  process.env.MISTRAL_API_KEY?.trim() ||
  (process.env.MISTRAL_API_KEY_CHAT?.trim() && process.env.MISTRAL_API_KEY_ANALYSIS?.trim())
);
const aiStatus = mistralConfigured ? "✅ CONFIGURED" : "⚠️  MISSING";
if (!mistralConfigured) missingCount++;
console.log(` ${aiStatus.padEnd(16)} | ${"MISTRAL_API_KEY".padEnd(30)} | Mistral Large AI Engine Key`);

// P1-05: Validácia HTTPS-only pre externé produkčné endpointy
const urlChecks = [
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "S3_ENDPOINT",
  "ICO_ATLAS_API_URL",
  "WHOISWHO_API_URL",
  "FORENZX_MCP_URL",
];

let insecureUrlCount = 0;
for (const envKey of urlChecks) {
  const val = process.env[envKey]?.trim();
  if (val && val.startsWith("http://")) {
    console.error(` ❌ INSECURE URL | ${envKey.padEnd(30)} | Nepovolené nešifrované http:// v produkcii!`);
    insecureUrlCount++;
  }
}

console.log("\n-------------------------------------------------------");

if (insecureUrlCount > 0 && isStrict) {
  console.error(`❌ STRICT MODE: Detegovaných ${insecureUrlCount} nešifrovaných http:// URL. Produkcia vyžaduje striktne https://.`);
  process.exit(1);
}

if (missingCount === 0 && insecureUrlCount === 0) {
  console.log("🎉 All production cloud environment variables are configured and secured!\n");
  process.exit(0);
} else {
  console.log(`ℹ️  ${missingCount} cloud variables are unconfigured.`);
  console.log("   The application will run with graceful local / in-memory fallbacks.");
  console.log("   Configure these in .env.production for 100% production functionality.\n");

  if (isStrict) {
    console.error("❌ STRICT MODE: Failing build due to unconfigured production variables.");
    process.exit(1);
  } else {
    process.exit(0);
  }
}
