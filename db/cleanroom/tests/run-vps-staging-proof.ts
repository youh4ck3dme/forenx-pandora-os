/**
 * PANDORA / FORENX — VPS STAGING REGRESSION CONTRACT RUNNER
 * 
 * Establishes SSH tunnel to VPS Staging (66.29.139.59) and executes the
 * complete cleanroom regression test suite against the live VPS Supabase stack.
 */
import { spawn, execSync, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Client } from "pg";

const configPath = path.resolve(__dirname, "../vps-staging-config.json");
if (!fs.existsSync(configPath)) {
  console.error("Missing vps-staging-config.json! Run deploy-and-verify-vps-staging.ts first.");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const { secrets, ports } = config;

async function checkPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require("node:net");
    const sock = new net.Socket();
    sock.setTimeout(1000);
    sock.on("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.on("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, "127.0.0.1");
  });
}

async function main() {
  console.log("================================================================================");
  console.log("  PANDORA / FORENX — VPS STAGING REGRESSION CONTRACT RUNNER");
  console.log("  Target: Live VPS Staging Stack at 66.29.139.59");
  console.log("================================================================================\n");

  console.log(">>> [1/4] ESTABLISHING SECURE SSH TUNNEL TO VPS STAGING...");
  
  // Forward local 54322 -> VPS 127.0.0.1:54322 and local 54321 -> VPS 127.0.0.1:54321
  const sshTunnel: ChildProcess = spawn(
    "ssh",
    [
      "-T",
      "-N",
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-L", "54322:127.0.0.1:54322",
      "-L", "54321:127.0.0.1:54321",
      "vps-staging",
    ],
    {
      stdio: "ignore",
      detached: false,
    }
  );

  let cleanedUp = false;
  const cleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      try {
        sshTunnel.kill("SIGTERM");
      } catch {}
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Wait for tunnel readiness
  console.log("Waiting for SSH tunnel to forward ports 54321 (Kong) and 54322 (Postgres)...");
  let ready = false;
  for (let i = 0; i < 15; i++) {
    const pgReady = await checkPortReady(54322);
    const kongReady = await checkPortReady(54321);
    if (pgReady && kongReady) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!ready) {
    console.error("[ERROR] Failed to establish SSH tunnel to VPS staging ports 54321/54322!");
    cleanup();
    process.exit(1);
  }
  console.log("[PASS] SSH tunnel is active and ports are forwarded.\n");

  console.log(">>> [2/4] VERIFYING DIRECT POSTGRESQL CONNECTIVITY...");
  const dbUrl = `postgresql://postgres:${secrets.postgresPassword}@127.0.0.1:54322/postgres`;
  const pgClient = new Client({ connectionString: dbUrl });
  await pgClient.connect();
  const testRes = await pgClient.query("SELECT current_user, version(), count(*)::int as table_count FROM information_schema.tables WHERE table_schema = 'public'");
  console.log(`Connected to VPS PostgreSQL as: ${testRes.rows[0].current_user}`);
  console.log(`Public table count on VPS:      ${testRes.rows[0].table_count}`);
  await pgClient.end();

  console.log("\n>>> [3/4] RUNNING COMPLETE DATABASE REGRESSION SUITE AGAINST VPS STAGING...");
  const envVars = {
    ...process.env,
    USE_DOCKER: "true",
    DATABASE_URL: dbUrl,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: secrets.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    SUPABASE_JWT_SECRET: secrets.jwtSecret,
  };

  try {
    const vitestOutput = execSync("npx vitest run db/cleanroom/tests/", {
      env: envVars,
      encoding: "utf8",
      stdio: "inherit",
      timeout: 300_000,
    });
    console.log("\n>>> [4/4] REGRESSION CONTRACT EXECUTION RESULT:");
    console.log("[PASS] ALL DATABASE REGRESSION SUITES PASSED AGAINST VPS STAGING!");
  } catch (err: any) {
    console.error("\n[FAIL] Some regression tests failed against VPS Staging!");
    cleanup();
    process.exit(1);
  }

  cleanup();
  console.log("\n================================================================================");
  console.log("  VPS STAGING REGRESSION CONTRACT VERIFICATION: COMPLETE (ALL PASS)");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
