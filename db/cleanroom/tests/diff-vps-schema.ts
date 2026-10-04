import { execSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import * as fs from "node:fs";
import * as path from "node:path";

async function diff() {
  const query = fs.readFileSync("tmp_staging_bundle/hash_query.sql", "utf8");
  
  // 1. Local PGlite / baseline
  const db = new PGlite();
  const harnessCode = fs.readFileSync("db/cleanroom/tests/cleanroom-harness.ts", "utf8");
  const match = harnessCode.match(/export const SUPABASE_RUNTIME_STUBS = `([\s\S]*?)`;/);
  if (!match) throw new Error("Could not find stubs");
  await db.exec(match[1]);
  
  const files = [
    "001_base.sql",
    "002_cases.sql",
    "003_forensic_evidence.sql",
    "004_audit.sql",
    "005_ai_graph.sql",
    "006_rate_limits.sql",
    "007_storage_contract.sql",
    "008_security_hardening.sql",
  ];
  for (const f of files) {
    await db.exec(fs.readFileSync(`db/cleanroom/${f}`, "utf8"));
  }
  const localRes = await db.query(query);
  const localRows = (localRes.rows[0] as any).schema_def;
  const localSignatures: string[] = localRows.map((r: any) => (typeof r === 'string' ? r : r.signature));

  // 2. VPS
  const vpsRaw = execSync(
    'ssh -T -o BatchMode=yes vps-staging "cat /opt/pandora-staging/hash_query.sql | docker exec -i pandora_staging_db psql -U postgres -d postgres -t -A"',
    { encoding: "utf8" }
  ).trim();
  const vpsRows = JSON.parse(vpsRaw);
  const vpsSignatures: string[] = vpsRows.map((r: any) => (typeof r === 'string' ? r : r.signature));

  const localSet = new Set(localSignatures);
  const vpsSet = new Set(vpsSignatures);

  const onlyLocal = localSignatures.filter((x) => !vpsSet.has(x));
  const onlyVps = vpsSignatures.filter((x) => !localSet.has(x));

  console.log(`Local signature count: ${localSignatures.length}`);
  console.log(`VPS signature count:   ${vpsSignatures.length}`);
  console.log("\nOnly in Local:", onlyLocal);
  console.log("\nOnly in VPS:", onlyVps);
}

diff().catch(console.error);
