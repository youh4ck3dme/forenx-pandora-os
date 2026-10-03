/**
 * PANDORA / FORENX — Cleanroom Database Test Harness
 * 
 * Uses in-process PostgreSQL 17 (PGlite) to execute and test the cleanroom SQL files
 * (frozen Baseline V1 001..008 plus forward migrations 009+) against Supabase stubs.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export const CLEANROOM_DIR = path.resolve(__dirname, "..");

export const CLEANROOM_FILES = [
  "001_base.sql",
  "002_cases.sql",
  "003_forensic_evidence.sql",
  "004_audit.sql",
  "005_ai_graph.sql",
  "006_rate_limits.sql",
  "007_storage_contract.sql",
  "008_security_hardening.sql",
  "009_evidence_case_id_ownership.sql",
  "010_evidence_worm_case_id.sql",
] as const;

export const SUPABASE_RUNTIME_STUBS = `
-- Supabase roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN SUPERUSER; END IF;
END $$;

-- Supabase default privileges for schema public
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Auth schema stand-in
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  raw_user_meta_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

-- Storage schema stand-in
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public BOOLEAN DEFAULT false,
  file_size_limit BIGINT,
  allowed_mime_types TEXT[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT REFERENCES storage.buckets(id),
  name TEXT,
  owner UUID
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT (string_to_array(name, '/'))[1:GREATEST(array_length(string_to_array(name, '/'), 1) - 1, 1)]
$$;
`;

import { Client as PgClient } from "pg";

export interface DbSession {
  query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }>;
  exec?(sql: string): Promise<void>;
  transaction<T>(fn: (tx: DbSession) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class DockerSession implements DbSession {
  constructor(private client: PgClient) {}

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[] }> {
    const res = await this.client.query<any>(sql, params);
    return { rows: res.rows };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(fn: (tx: DbSession) => Promise<T>): Promise<T> {
    await this.client.query("BEGIN");
    try {
      const res = await fn(this);
      await this.client.query("COMMIT");
      return res;
    } catch (err) {
      await this.client.query("ROLLBACK");
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/**
 * Boots a clean database instance. Uses Docker PostgreSQL 17 when USE_DOCKER=true,
 * otherwise boots an in-process PGlite instance.
 */
const openSessions = new Set<DbSession>();

async function closeAllOpenSessions(): Promise<void> {
  await Promise.all(
    Array.from(openSessions).map(async (session) => {
      try {
        await session.close();
      } finally {
        openSessions.delete(session);
      }
    }),
  );
}

const vitestAfterAll = (globalThis as { afterAll?: (fn: () => Promise<void>) => void }).afterAll;
if (typeof vitestAfterAll === "function") {
  vitestAfterAll(closeAllOpenSessions);
}

export async function createCleanroomDatabase(): Promise<DbSession> {
  if (process.env.USE_DOCKER === "true") {
    const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
    const client = new PgClient({ connectionString: dbUrl });
    await client.connect();
    const session = new DockerSession(client);
    openSessions.add(session);
    return session;
  }

  const db = new PGlite();
  
  // 1. Boot Supabase runtime stubs
  await db.exec(SUPABASE_RUNTIME_STUBS);

  // 2. Apply each cleanroom SQL file in sequence
  for (const filename of CLEANROOM_FILES) {
    const filePath = path.join(CLEANROOM_DIR, filename);
    const sql = fs.readFileSync(filePath, "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Cleanroom migration failed at ${filename}: ${msg}`);
    }
  }

  const session = {
    query: (sql: string, params?: any[]) => db.query(sql, params),
    exec: (sql: string) => db.exec(sql),
    transaction: (fn: (tx: DbSession) => Promise<any>) => db.transaction(fn as any),
    close: () => db.close(),
  } as unknown as DbSession;
  openSessions.add(session);
  return session;
}

/**
 * Runs a callback inside a transaction configured for a specific role and JWT claims.
 */
export async function asRole<T>(
  db: DbSession,
  role: "anon" | "authenticated" | "service_role" | "postgres",
  jwtSub: string | null,
  fn: (tx: DbSession) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    if (role !== "postgres") {
      if (tx.exec) {
        await tx.exec(`SET LOCAL ROLE ${role}`);
      } else {
        await tx.query(`SET LOCAL ROLE ${role}`);
      }
    }
    if (jwtSub) {
      await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [jwtSub]);
      await tx.query("SELECT set_config('request.jwt.claim.role', $1, true)", [role]);
    } else {
      await tx.query("SELECT set_config('request.jwt.claim.sub', '', true)");
      await tx.query("SELECT set_config('request.jwt.claim.role', 'anon', true)");
    }
    return fn(tx);
  });
}

export function asAuthenticated<T>(
  db: DbSession,
  userId: string,
  fn: (tx: DbSession) => Promise<T>
): Promise<T> {
  return asRole(db, "authenticated", userId, fn);
}

export function asAnon<T>(
  db: DbSession,
  fn: (tx: DbSession) => Promise<T>
): Promise<T> {
  return asRole(db, "anon", null, fn);
}

export function asServiceRole<T>(
  db: DbSession,
  fn: (tx: DbSession) => Promise<T>
): Promise<T> {
  return asRole(db, "service_role", null, fn);
}

/**
 * Creates an authenticated user in auth.users and optionally grants them admin role.
 */
export async function createTestUser(
  db: DbSession,
  email: string,
  isAdmin: boolean = false
): Promise<string> {
  const userRes = await db.query<{ id: string }>(
    `INSERT INTO auth.users (email, raw_user_meta_data)
     VALUES ($1, jsonb_build_object('full_name', $2::text))
     RETURNING id`,
    [email, `User ${email}`]
  );
  const userId = userRes.rows[0]?.id;
  if (!userId) throw new Error("Failed to insert auth user");

  if (isAdmin) {
    await db.query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, 'admin')
       ON CONFLICT (user_id, role) DO NOTHING`,
      [userId]
    );
  }

  return userId;
}

/**
 * Creates a case owned by the given user.
 */
export async function createTestCase(
  db: DbSession,
  userId: string,
  name: string = "Forensic Dossier Alpha",
  status: "draft" | "closed" | "legal_hold" | "archived" | "destroyed" = "draft"
): Promise<string> {
  const caseRes = await db.query<{ id: string }>(
    `INSERT INTO public.cases (user_id, name, status)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, name, status]
  );
  const caseId = caseRes.rows[0]?.id;
  if (!caseId) throw new Error("Failed to insert case");
  return caseId;
}

/**
 * Creates an evidence item.
 */
export async function createTestEvidence(
  db: DbSession,
  investigatorId: string,
  caseId: string,
  options: {
    fileName?: string;
    sha256?: string;
    legalHold?: boolean;
    verificationStatus?: string;
  } = {}
): Promise<string> {
  const sha256 = options.sha256 || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const s3Key = `evidence/${caseId}/${Date.now()}-${options.fileName || "doc.pdf"}`;

  const res = await db.query<{ id: string }>(
    `INSERT INTO public.evidence_items (
       investigator_id, case_id, case_name, file_name, file_size, mime_type,
       s3_object_key, sha256_hash, legal_hold, hash_verification_status
     ) VALUES (
       $1, $2, 'Case Ref', $3, 1024, 'application/pdf',
       $4, $5, $6, $7
     ) RETURNING id`,
    [
      investigatorId,
      caseId,
      options.fileName || "doc.pdf",
      s3Key,
      sha256,
      options.legalHold ?? false,
      options.verificationStatus || "pending",
    ]
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to insert evidence item");
  return id;
}
