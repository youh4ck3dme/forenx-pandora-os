/**
 * In-process PostgreSQL 17 (PGlite) harness for migration tests.
 *
 * Applies every file in supabase/migrations in filename order on top of a
 * minimal stub of the Supabase-managed schemas (auth, storage, roles). The
 * stubs contain only what the migrations reference — they are not a Supabase
 * emulator.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

const SUPABASE_STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
`;

/** Stand-in for the function hosted Supabase provides before migrations run. */
export const HOSTED_RLS_AUTO_ENABLE = `
create function public.rls_auto_enable() returns event_trigger language plpgsql as $$
begin
  -- hosted implementation marker
end $$;
`;

export function migrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export async function freshDatabase(
  options: { hostedFunctions?: boolean } = {},
): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  if (options.hostedFunctions) await db.exec(HOSTED_RLS_AUTO_ENABLE);
  for (const file of migrationFiles()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${file} failed: ${message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  const row = result.rows[0];
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

export async function createCase(db: PGlite, userId: string): Promise<string> {
  const result = await db.query<{ id: string }>(
    "insert into public.cases (user_id, name) values ($1, 'Test') returning id",
    [userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("case insert returned no row");
  return row.id;
}
