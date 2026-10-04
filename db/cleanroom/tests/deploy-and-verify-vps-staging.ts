import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import crypto from "node:crypto";
import { generateStagingSecrets, generateKongConfig, generateComposeFile } from "./generate-vps-staging-bundle";

const FROZEN_SCHEMA_HASH = "6ba5375159b8e6284a6fdc9087572a105df46147633366d1e517814279399b99";

function sshExec(cmd: string): string {
  const cleanCmd = cmd.replace(/"/g, '\\"');
  return execSync(`ssh -T -o BatchMode=yes vps-staging "${cleanCmd}"`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 300_000,
  });
}

async function main() {
  console.log("================================================================================");
  console.log("  PANDORA / FORENX — VPS STAGING DEPLOYMENT & MIGRATION REHEARSAL");
  console.log("  Target Host: 66.29.139.59 (server1.h4ck3d.me)");
  console.log("================================================================================\n");

  // 1. Prepare Staging Secrets & Config
  console.log(">>> [1/6] GENERATING PRODUCTION-GRADE STAGING SECRETS...");
  const secrets = generateStagingSecrets();
  const composeContent = generateComposeFile();
  const kongContent = generateKongConfig(secrets.anonKey, secrets.serviceRoleKey);

  const stagingDir = path.resolve(__dirname, "../../../tmp_staging_bundle");
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.mkdirSync(path.join(stagingDir, "sql"), { recursive: true });
  fs.mkdirSync(path.join(stagingDir, "api"), { recursive: true });

  fs.writeFileSync(path.join(stagingDir, "docker-compose.yml"), composeContent, "utf8");
  fs.writeFileSync(path.join(stagingDir, "api/kong.yml"), kongContent, "utf8");
  fs.writeFileSync(
    path.join(stagingDir, ".env"),
    `POSTGRES_PASSWORD=${secrets.postgresPassword}\nJWT_SECRET=${secrets.jwtSecret}\nANON_KEY=${secrets.anonKey}\nSERVICE_ROLE_KEY=${secrets.serviceRoleKey}\n`,
    "utf8"
  );

  const initSql = `
ALTER USER postgres WITH PASSWORD '${secrets.postgresPassword}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD '${secrets.postgresPassword}';
    GRANT anon TO authenticator;
    GRANT authenticated TO authenticator;
    GRANT service_role TO authenticator;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN PASSWORD '${secrets.postgresPassword}';
    GRANT ALL PRIVILEGES ON DATABASE postgres TO supabase_auth_admin;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOINHERIT CREATEROLE LOGIN PASSWORD '${secrets.postgresPassword}';
    GRANT ALL PRIVILEGES ON DATABASE postgres TO supabase_storage_admin;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin NOINHERIT CREATEDB CREATEROLE LOGIN PASSWORD '${secrets.postgresPassword}';
    GRANT ALL PRIVILEGES ON DATABASE postgres TO supabase_admin;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin, postgres;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin, postgres;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text NOT NULL PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  owner_id text
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone DEFAULT now(),
  metadata jsonb,
  path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED,
  version text,
  owner_id text,
  user_metadata jsonb
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
_parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[1:(array_length(_parts, 1) - 1)];
END
$$;

CREATE OR REPLACE FUNCTION storage.filename(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
_parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO _parts;
  RETURN _parts[array_length(_parts, 1)];
END
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
_parts text[];
_filename text;
BEGIN
  SELECT storage.filename(name) INTO _filename;
  SELECT string_to_array(_filename, '.') INTO _parts;
  IF array_length(_parts, 1) = 1 THEN
    RETURN '';
  END IF;
  RETURN _parts[array_length(_parts, 1)];
END
$$;

GRANT ALL ON ALL TABLES IN SCHEMA storage TO supabase_storage_admin, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA storage TO supabase_storage_admin, postgres;
GRANT ALL ON ALL ROUTINES IN SCHEMA storage TO supabase_storage_admin, postgres;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid,
  id uuid NOT NULL PRIMARY KEY,
  aud character varying(255),
  role character varying(255),
  email character varying(255) UNIQUE,
  encrypted_password character varying(255),
  email_confirmed_at timestamp with time zone,
  invited_at timestamp with time zone,
  confirmation_token character varying(255),
  confirmation_sent_at timestamp with time zone,
  recovery_token character varying(255),
  recovery_sent_at timestamp with time zone,
  email_change_token_new character varying(255),
  email_change character varying(255),
  email_change_sent_at timestamp with time zone,
  last_sign_in_at timestamp with time zone,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  phone text DEFAULT NULL::character varying UNIQUE,
  phone_confirmed_at timestamp with time zone,
  phone_change text DEFAULT ''::character varying,
  phone_change_token character varying(255) DEFAULT ''::character varying,
  phone_change_sent_at timestamp with time zone,
  confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
  email_change_token_current character varying(255) DEFAULT ''::character varying,
  email_change_confirm_status smallint DEFAULT 0,
  banned_until timestamp with time zone,
  reauthentication_token character varying(255) DEFAULT ''::character varying,
  reauthentication_sent_at timestamp with time zone,
  is_sso_user boolean DEFAULT false NOT NULL,
  deleted_at timestamp with time zone,
  is_anonymous boolean DEFAULT false NOT NULL
);
ALTER TABLE IF EXISTS auth.users OWNER TO supabase_auth_admin;
ALTER TABLE IF EXISTS storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE IF EXISTS storage.objects OWNER TO supabase_storage_admin;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  )
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;
ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

ALTER FUNCTION storage.foldername(text) OWNER TO supabase_storage_admin;
ALTER FUNCTION storage.filename(text) OWNER TO supabase_storage_admin;
ALTER FUNCTION storage.extension(text) OWNER TO supabase_storage_admin;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
`;

  fs.writeFileSync(path.join(stagingDir, "init.sql"), initSql, "utf8");

  const query = `
    SELECT json_agg(t ORDER BY t.signature) as schema_def FROM (
      SELECT 'col:' || c.table_name || '.' || c.column_name || ':' || c.data_type || ':' || COALESCE(c.column_default, '') || ':' || c.is_nullable as signature
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
      
      UNION ALL
      
      SELECT 'tc:' || tc.table_name || '.' || tc.constraint_name || ':' || tc.constraint_type as signature
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public' AND tc.constraint_name NOT LIKE '%_not_null'
      
      UNION ALL
      
      SELECT 'proc:' || p.proname || ':' || pg_get_function_identity_arguments(p.oid) as signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
      
      UNION ALL
      
      SELECT 'policy:' || pol.polname || ':' || c.relname || ':' || pol.polcmd::text || ':' || pol.polpermissive::text as signature
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      
      UNION ALL
      
      SELECT 'trigger:' || trg.tgname || ':' || c.relname as signature
      FROM pg_trigger trg
      JOIN pg_class c ON c.oid = trg.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT trg.tgisinternal
    ) t;
  `;
  fs.writeFileSync(path.join(stagingDir, "hash_query.sql"), query, "utf8");

  // Copy 8 cleanroom SQL files
  const sqlFiles = [
    "001_base.sql",
    "002_cases.sql",
    "003_forensic_evidence.sql",
    "004_audit.sql",
    "005_ai_graph.sql",
    "006_rate_limits.sql",
    "007_storage_contract.sql",
    "008_security_hardening.sql",
  ];

  for (const f of sqlFiles) {
    fs.copyFileSync(
      path.resolve(__dirname, `../${f}`),
      path.join(stagingDir, `sql/${f}`)
    );
  }

  // 2. Setup remote directory
  console.log("\n>>> [2/6] PREPARING REMOTE VPS DIRECTORY (/opt/pandora-staging)...");
  sshExec("cd /opt/pandora-staging && docker compose down -v || true");
  sshExec("rm -rf /opt/pandora-staging/volumes/db/* /opt/pandora-staging/volumes/storage/*");
  sshExec("mkdir -p /opt/pandora-staging/volumes/db /opt/pandora-staging/volumes/storage /opt/pandora-staging/volumes/api /opt/pandora-staging/sql");

  // 3. Upload files via tar stream
  console.log(">>> [3/6] STREAMING STAGING BUNDLE TO VPS...");
  execSync(`tar -czf - -C "${stagingDir}" . | ssh -T -o BatchMode=yes vps-staging "tar -xzf - -C /opt/pandora-staging"`, {
    stdio: "inherit",
    timeout: 60_000,
  });
  sshExec("cp /opt/pandora-staging/api/kong.yml /opt/pandora-staging/volumes/api/kong.yml");
  console.log("[PASS] Bundle uploaded successfully.");

  // 4. Start Stack on VPS
  console.log("\n>>> [4/6] STARTING POSTGRESQL ON VPS...");
  sshExec("cd /opt/pandora-staging && docker compose up -d db");

  // Wait for PostgreSQL container
  console.log("Waiting for PostgreSQL to become healthy on VPS...");
  let dbHealthy = false;
  for (let i = 0; i < 30; i++) {
    try {
      const status = sshExec("docker inspect --format='{{.State.Health.Status}}' pandora_staging_db").trim();
      if (status === "healthy") {
        dbHealthy = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!dbHealthy) {
    console.error("PostgreSQL container on VPS failed healthcheck!");
    process.exit(1);
  }
  console.log("[PASS] VPS PostgreSQL container is healthy.");

  // 5. Apply Init & Frozen Baseline SQL (001 -> 008)
  console.log("\n>>> [5/6] INITIALIZING SUPABASE ROLES & APPLYING FROZEN BASELINE (001..008)...");
  sshExec("docker exec -i pandora_staging_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /opt/pandora-staging/init.sql");

  for (const f of sqlFiles) {
    console.log(`Applying /opt/pandora-staging/sql/${f}...`);
    sshExec(`docker exec -i pandora_staging_db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /opt/pandora-staging/sql/${f}`);
  }
  console.log("[PASS] All 8 baseline SQL files applied successfully.");

  // Start rest, auth, storage, kong now that database schema is ready
  console.log("Starting full Supabase runtime services...");
  sshExec("cd /opt/pandora-staging && docker compose up -d rest auth storage kong");
  await new Promise((r) => setTimeout(r, 5000));

  // Restart rest & auth to attach to fresh public schema
  sshExec("cd /opt/pandora-staging && docker compose restart rest auth storage kong");
  await new Promise((r) => setTimeout(r, 4000));

  const psOutput = sshExec("cd /opt/pandora-staging && docker compose ps");
  console.log(psOutput);

  // 6. Compute Schema Hash on VPS PostgreSQL
  console.log("\n>>> [6/6] COMPUTING SCHEMA HASH ON VPS STAGING DATABASE...");

  const jsonResult = sshExec("docker exec -i pandora_staging_db psql -U postgres -d postgres -t -A < /opt/pandora-staging/hash_query.sql").trim();
  const rows = JSON.parse(jsonResult || "[]");
  const canonicalString = JSON.stringify(rows);
  const vpsHash = crypto.createHash("sha256").update(canonicalString).digest("hex");

  console.log(`VPS_SCHEMA_HASH:       ${vpsHash}`);
  console.log(`FROZEN_BASELINE_HASH:  ${FROZEN_SCHEMA_HASH}`);
  console.log(`MATCHES:               ${vpsHash === FROZEN_SCHEMA_HASH}`);

  if (vpsHash !== FROZEN_SCHEMA_HASH) {
    console.error("\n[BLOCKED] VPS schema hash mismatch!");
    process.exit(1);
  }
  console.log("[PASS] VPS_SCHEMA_HASH == FROZEN_BASELINE_HASH (Exact 100% Match!)");

  // Save staging credentials locally for running regression tests
  fs.writeFileSync(
    path.resolve(__dirname, "../vps-staging-config.json"),
    JSON.stringify(
      {
        host: "66.29.139.59",
        ports: {
          kong: 54321,
          postgres: 54322,
        },
        secrets,
        vpsHash,
      },
      null,
      2
    ),
    "utf8"
  );

  console.log("\n================================================================================");
  console.log("  VPS STAGING DEPLOYMENT & SCHEMA FINGERPRINT VERIFICATION: SUCCESS");
  console.log("================================================================================");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
