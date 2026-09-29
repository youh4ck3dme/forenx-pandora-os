import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

export const CLEANROOM_FILES = [
  "001_base.sql",
  "002_cases.sql",
  "003_forensic_evidence.sql",
  "004_audit.sql",
  "005_ai_graph.sql",
  "006_rate_limits.sql",
  "007_storage_contract.sql",
  "008_security_hardening.sql",
] as const;

export const DB_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function computeSchemaHash(client: Client): Promise<string> {
  const query = `
    SELECT json_agg(t ORDER BY t.signature) as schema_def FROM (
      -- 1. Tables and columns with exact types, defaults, and nullability
      SELECT 'col:' || c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || COALESCE(c.column_default, '') || ':' || c.is_nullable as signature
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
      
      UNION ALL
      
      -- 2. Foreign keys, primary keys, unique constraints, and named check constraints
      SELECT 'tc:' || tc.table_name || '.' || tc.constraint_name || ':' || tc.constraint_type as signature
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public' AND tc.constraint_name NOT LIKE '%_not_null'
      
      UNION ALL
      
      -- 3. Stored procedures and functions
      SELECT 'proc:' || p.proname || ':' || pg_get_function_identity_arguments(p.oid) as signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      
      UNION ALL
      
      -- 4. Row Level Security policies
      SELECT 'policy:' || pol.polname || ':' || c.relname || ':' || pol.polcmd::text || ':' || pol.polpermissive::text as signature
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      
      UNION ALL
      
      -- 5. Triggers
      SELECT 'trigger:' || trg.tgname || ':' || c.relname as signature
      FROM pg_trigger trg
      JOIN pg_class c ON c.oid = trg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT trg.tgisinternal
    ) t;
  `;
  const res = await client.query<{ schema_def: any[] }>(query);
  const rows = res.rows[0]?.schema_def || [];
  const canonicalString = JSON.stringify(rows);
  return crypto.createHash("sha256").update(canonicalString).digest("hex");
}

export async function applyCleanroomToDocker(connectionString: string = DB_URL): Promise<{ schemaHash: string; tableCount: number; functionCount: number }> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // 1. Wipe schema public completely
    await client.query("DROP SCHEMA IF EXISTS public CASCADE;");
    await client.query("CREATE SCHEMA public;");
    await client.query("GRANT ALL ON SCHEMA public TO postgres, service_role;");
    await client.query("GRANT USAGE ON SCHEMA public TO anon, authenticated;");
    await client.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;");

    // 2. Apply all cleanroom files in strict sequence
    const cleanroomDir = path.resolve(__dirname, "..");
    for (const file of CLEANROOM_FILES) {
      const filePath = path.join(cleanroomDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      await client.query(sql);
    }

    // 3. Notify PostgREST to reload schema
    await client.query("NOTIFY pgrst, 'reload schema';");

    // 4. Verify counts
    const tablesRes = await client.query<{ count: string }>(
      "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'"
    );
    const procsRes = await client.query<{ count: string }>(
      "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'"
    );
    const tableCount = parseInt(tablesRes.rows[0]?.count || "0", 10);
    const functionCount = parseInt(procsRes.rows[0]?.count || "0", 10);

    const schemaHash = await computeSchemaHash(client);

    return { schemaHash, tableCount, functionCount };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  applyCleanroomToDocker()
    .then(({ schemaHash, tableCount, functionCount }) => {
      console.log(`CLEANROOM_APPLIED: tables=${tableCount}, functions=${functionCount}, hash=${schemaHash}`);
    })
    .catch((err) => {
      console.error("APPLY_FAILED:", err);
      process.exit(1);
    });
}
