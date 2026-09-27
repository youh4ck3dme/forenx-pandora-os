// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, migrationFiles } from "./harness";
import { generatePreflightSql, loadMigrations, parseMigration } from "../../scripts/deploy/db-preflight.mjs";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const readMigration = (prefix: string) => {
  const file = migrationFiles().find((f) => f.startsWith(prefix));
  if (!file) throw new Error(`migration ${prefix} not found`);
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
};
const ISOLATION = () => readMigration("20260928230000");
const ADMIN_EMAIL = () => readMigration("20260925143000");

async function authTriggers(db: PGlite): Promise<string[]> {
  const res = await db.query<{ t: string }>(
    `select t.tgname || ' -> ' || p.proname as t
       from pg_trigger t join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
      order by t.tgname`,
  );
  return res.rows.map((r) => r.t);
}

async function signup(db: PGlite, email: string): Promise<{ profiles: number; roles: string[] }> {
  const u = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = u.rows[0]?.id;
  const profiles = await db.query<{ n: number }>("select count(*)::int as n from public.profiles where id = $1", [id]);
  const roles = await db.query<{ role: string }>("select role::text from public.user_roles where user_id = $1 order by role", [id]);
  return { profiles: profiles.rows[0]?.n ?? -1, roles: roles.rows.map((r) => r.role) };
}

/** Another application in the same database, using the Supabase-template names. */
async function installForeignApp(db: PGlite) {
  await db.exec(`
    create table public.whoiswho_accounts (id uuid primary key, email text);
    create or replace function public.handle_new_user() returns trigger
      language plpgsql security definer set search_path = public as $$
    begin
      insert into public.whoiswho_accounts (id, email) values (new.id, new.email);
      return new;
    end $$;
    drop trigger if exists on_auth_user_created on auth.users;
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  `);
}

describe("Pandora signup hook isolation", () => {
  it("fresh Pandora database: only Pandora's own trigger remains and signup works once", async () => {
    const db = await freshDatabase();
    expect(await authTriggers(db)).toEqual(["pandora_on_auth_user_created -> pandora_handle_new_user"]);
    expect(await signup(db, "user@test.local")).toEqual({ profiles: 1, roles: ["user"] });
    expect(await signup(db, "INFO@bizagent.sk")).toEqual({ profiles: 1, roles: ["admin"] });
  }, 120_000);

  it("shared database: a foreign handle_new_user and trigger are never overwritten or dropped", async () => {
    const db = await freshDatabase();
    await installForeignApp(db);
    // Re-applying Pandora's migrations (as `db push` would) must leave the foreign app intact.
    await db.exec(ADMIN_EMAIL());
    await db.exec(ISOLATION());

    const src = await db.query<{ src: string }>("select prosrc as src from pg_proc where oid = to_regprocedure('public.handle_new_user()')");
    expect(src.rows[0]?.src).toContain("whoiswho_accounts");
    expect(src.rows[0]?.src).not.toContain("user_roles");
    expect(await authTriggers(db)).toEqual([
      "on_auth_user_created -> handle_new_user",
      "pandora_on_auth_user_created -> pandora_handle_new_user",
    ]);

    // One signup: the foreign app gets its row, Pandora its profile — each exactly once.
    const res = await signup(db, "shared@test.local");
    expect(res).toEqual({ profiles: 1, roles: ["user"] });
    const foreign = await db.query<{ n: number }>("select count(*)::int as n from public.whoiswho_accounts where email = 'shared@test.local'");
    expect(foreign.rows[0]?.n).toBe(1);
  }, 120_000);

  it("existing Pandora install: the legacy Pandora trigger is retired, behaviour unchanged", async () => {
    const db = await freshDatabase();
    // State before this migration: Pandora's trigger on the template name.
    await db.exec(`
      drop trigger if exists pandora_on_auth_user_created on auth.users;
      create trigger on_auth_user_created after insert on auth.users
        for each row execute function public.handle_new_user();
    `);
    expect(await authTriggers(db)).toEqual(["on_auth_user_created -> handle_new_user"]);
    await db.exec(ISOLATION());
    expect(await authTriggers(db)).toEqual(["pandora_on_auth_user_created -> pandora_handle_new_user"]);
    expect(await signup(db, "legacy@test.local")).toEqual({ profiles: 1, roles: ["user"] });
  }, 120_000);

  it("is idempotent", async () => {
    const db = await freshDatabase();
    await db.exec(ISOLATION());
    await db.exec(ISOLATION());
    expect(await authTriggers(db)).toEqual(["pandora_on_auth_user_created -> pandora_handle_new_user"]);
    expect(await signup(db, "twice@test.local")).toEqual({ profiles: 1, roles: ["user"] });
  }, 120_000);
});

type Row = { check_name: string; status: string; detail: string };

async function runPreflight(db: PGlite, appliedVersions: string[] | null): Promise<Row[]> {
  if (appliedVersions) {
    await db.exec("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key);");
    await db.exec("truncate supabase_migrations.schema_migrations");
    for (const v of appliedVersions) {
      await db.query("insert into supabase_migrations.schema_migrations (version) values ($1)", [v]);
    }
  }
  const results = await db.exec(generatePreflightSql());
  return (results.at(-1)?.rows ?? []) as Row[];
}

const verdict = (rows: Row[]) => rows.find((r) => r.check_name === "VERDIKT")?.status;
const allVersions = (): string[] => loadMigrations().map((m: { version: string }) => m.version);

describe("db-preflight.mjs", () => {
  it("parses only unconditional objects; guarded blocks do not count as overwrites", () => {
    const guarded = parseMigration(ADMIN_EMAIL());
    expect(guarded.functions.map((f: { name: string }) => f.name)).not.toContain("handle_new_user");
    expect(guarded.allFunctions).toContain("handle_new_user");
    const evidence = parseMigration(readMigration("20260927120000"));
    expect(evidence.tables).toEqual([{ name: "evidence_items", ifNotExists: false }]);
  });

  it("GO on an up-to-date Pandora-only database", async () => {
    const db = await freshDatabase();
    const rows = await runPreflight(db, allVersions());
    expect(rows.filter((r) => r.status === "FAIL" || r.status === "WARN")).toEqual([]);
    expect(verdict(rows)).toBe("GO");
  }, 120_000);

  it("NO-GO when a pending migration would CREATE TABLE an existing table", async () => {
    const db = await freshDatabase();
    const rows = await runPreflight(db, allVersions().filter((v) => v !== "20260927120000"));
    expect(rows).toContainEqual(expect.objectContaining({ check_name: "Kolízia tabuľky evidence_items", status: "FAIL" }));
    expect(verdict(rows)).toBe("NO-GO");
  }, 120_000);

  it("warns about functions a pending migration would overwrite", async () => {
    const db = await freshDatabase();
    const rows = await runPreflight(db, allVersions().filter((v) => v !== "20260927130000"));
    const row = rows.find((r) => r.check_name === "Existujúce funkcie, ktoré push prepíše");
    expect(row?.status).toBe("WARN");
    expect(row?.detail).toContain("commit_ai_case_graph");
    expect(verdict(rows)).toBe("GO S VAROVANÍM");
  }, 120_000);

  it("detects a shared database: foreign tables, foreign handle_new_user and trigger, users without profile", async () => {
    const db = await freshDatabase();
    await installForeignApp(db);
    await db.exec("alter table auth.users disable trigger pandora_on_auth_user_created");
    await db.query("insert into auth.users (email) values ('only-whoiswho@test.local')");
    await db.exec("alter table auth.users enable trigger pandora_on_auth_user_created");

    const rows = await runPreflight(db, allVersions());
    const by = (name: string) => rows.find((r) => r.check_name === name);
    expect(by("Zdieľaná databáza")).toMatchObject({ status: "WARN" });
    expect(by("Zdieľaná databáza")?.detail).toContain("whoiswho_accounts");
    expect(by("public.handle_new_user()")).toMatchObject({ status: "WARN" });
    expect(by("auth.users trigger on_auth_user_created")).toMatchObject({ status: "WARN" });
    expect(by("auth.users trigger pandora_on_auth_user_created")).toMatchObject({ status: "PASS" });
    expect(by("auth.users bez Pandora profilu")).toMatchObject({ status: "INFO", detail: "1 používateľov" });
    expect(verdict(rows)).toBe("GO S VAROVANÍM");
  }, 120_000);

  it("without migration history every migration is pending → table collisions → NO-GO", async () => {
    const db = await freshDatabase();
    const rows = await runPreflight(db, null);
    expect(rows[0]).toMatchObject({ check_name: "História migrácií", status: "WARN" });
    expect(verdict(rows)).toBe("NO-GO");
  }, 120_000);

  it("is read-only: only session temp objects are created", async () => {
    const db = await freshDatabase();
    const persistent = async () =>
      (
        await db.query<{ o: string }>(
          `select n.nspname || '.' || c.relname as o
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast%'
            order by 1`,
        )
      ).rows.map((r) => r.o);
    const before = await persistent();
    await runPreflight(db, null);
    expect(await persistent()).toEqual(before);
  }, 120_000);
});
