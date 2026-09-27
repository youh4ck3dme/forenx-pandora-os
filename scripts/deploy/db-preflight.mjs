#!/usr/bin/env node
/**
 * Preflight pred `supabase db push` na (možno zdieľanú) databázu.
 *
 *   node scripts/deploy/db-preflight.mjs > preflight.sql
 *   → vložiť do Supabase SQL Editora, alebo: psql "$DATABASE_URL" -f preflight.sql
 *
 * Z migrácií v repe zistí, čo ktorá vytvára, a vygeneruje READ-ONLY SQL (iba
 * dočasná tabuľka s výsledkami), ktoré na cieľovej DB overí:
 *   - aplikované vs. čakajúce migrácie (supabase_migrations.schema_migrations),
 *   - tabuľky, ktoré čakajúce migrácie zakladajú bez IF NOT EXISTS, no už existujú (push zlyhá),
 *   - funkcie, ktoré čakajúce migrácie nepodmienene prepíšu (CREATE OR REPLACE),
 *   - public.handle_new_user() a triggery na auth.users, ktoré nepatria Pandore,
 *   - cudzie tabuľky v schéme public (= zdieľaná DB),
 *   - používateľov v auth.users bez Pandora profilu.
 * Výsledok: tabuľka check | status | detail a riadok VERDIKT (GO / GO S VAROVANÍM / NO-GO).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** Odstráni komentáre a obsah dollar-quoted blokov vnorených v DO/EXECUTE (nevykonajú sa nepodmienene). */
function topLevelSql(sql) {
  const noComments = sql.replace(/--[^\n]*/g, "");
  const lines = noComments.split("\n");
  // Bloky za „-- preflight: guarded“ sú podmienené — vynechajú sa celé DO bloky s EXECUTE.
  return lines.join("\n").replace(/\bdo\s+\$(\w*)\$[\s\S]*?\$\1\$\s*;/gi, " ");
}

/** Objekty, ktoré migrácia vytvára nepodmienene (na najvyššej úrovni). */
export function parseMigration(sql) {
  const top = topLevelSql(sql);
  const tables = [];
  const functions = [];
  const tableRe = /\bcreate\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  const fnRe = /\bcreate\s+(or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = tableRe.exec(top))) tables.push({ name: m[2].toLowerCase(), ifNotExists: Boolean(m[1]) });
  while ((m = fnRe.exec(top))) functions.push({ name: m[2].toLowerCase(), orReplace: Boolean(m[1]) });
  // Názvy aj z podmienených blokov — aby sa Pandorine objekty nehlásili ako „cudzie“.
  const allTables = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map((x) => x[1].toLowerCase());
  const allFunctions = [...sql.matchAll(/\bfunction\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map((x) => x[1].toLowerCase());
  return { tables, functions, allTables, allFunctions };
}

export function loadMigrations(dir = MIGRATIONS) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const version = file.split("_")[0];
      return { version, file, ...parseMigration(fs.readFileSync(path.join(dir, file), "utf8")) };
    });
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function generatePreflightSql(migrations = loadMigrations()) {
  const migRows = migrations.map((m) => `(${q(m.version)}, ${q(m.file)})`).join(",\n  ");
  const objRows = [];
  for (const m of migrations) {
    for (const t of m.tables) objRows.push(`(${q(m.version)}, 'table', ${q(t.name)}, ${t.ifNotExists ? "true" : "false"})`);
    for (const f of m.functions) objRows.push(`(${q(m.version)}, 'function', ${q(f.name)}, ${f.orReplace ? "false" : "true"})`);
  }
  const known = new Set(migrations.flatMap((m) => m.allTables));
  const knownFns = new Set(migrations.flatMap((m) => m.allFunctions));
  const knownRows = [...known].sort().map((t) => `(${q(t)})`).join(", ");
  const knownFnRows = [...knownFns].sort().map((f) => `(${q(f)})`).join(", ");

  return `-- Pandora DB preflight (READ-ONLY; vygenerované ${new Date().toISOString()} z ${migrations.length} migrácií)
-- Mení iba dočasné tabuľky tejto session. Spustenie: SQL Editor alebo psql -f.

create temp table if not exists _pf_local (version text primary key, file text) on commit preserve rows;
create temp table if not exists _pf_obj (version text, kind text, name text, safe boolean) on commit preserve rows;
create temp table if not exists _pf_known (name text primary key) on commit preserve rows;
create temp table if not exists _pf_known_fn (name text primary key) on commit preserve rows;
create temp table if not exists _pf_result (n serial, check_name text, status text, detail text) on commit preserve rows;
truncate _pf_local, _pf_obj, _pf_known, _pf_known_fn, _pf_result;

insert into _pf_local (version, file) values
  ${migRows};
${objRows.length ? `insert into _pf_obj (version, kind, name, safe) values\n  ${objRows.join(",\n  ")};` : ""}
insert into _pf_known (name) values ${knownRows};
insert into _pf_known_fn (name) values ${knownFnRows};

do $pf$
declare
  _has_history boolean := to_regclass('supabase_migrations.schema_migrations') is not null;
  _pending text[] := '{}';
  _n int;
  _list text;
  _src text;
  r record;
begin
  -- 1. História migrácií
  if _has_history then
    execute 'select coalesce(array_agg(l.version order by l.version), ''{}'') from _pf_local l
             where l.version not in (select version from supabase_migrations.schema_migrations)'
      into _pending;
    insert into _pf_result (check_name, status, detail) values
      ('História migrácií', 'PASS', 'supabase_migrations.schema_migrations nájdená'),
      ('Čakajúce migrácie', case when cardinality(_pending) = 0 then 'PASS' else 'INFO' end,
       case when cardinality(_pending) = 0 then 'žiadne' else cardinality(_pending) || ': ' || array_to_string(_pending, ', ') end);
    execute 'select string_agg(version, '', '' order by version) from supabase_migrations.schema_migrations
             where version not in (select version from _pf_local)' into _list;
    if _list is not null then
      insert into _pf_result (check_name, status, detail) values
        ('Migrácie na DB, ktoré repo nepozná', 'WARN', _list || ' (iná appka alebo ručné zmeny — db push ich nahlási)');
    end if;
  else
    select array_agg(version order by version) into _pending from _pf_local;
    insert into _pf_result (check_name, status, detail) values
      ('História migrácií', 'WARN', 'supabase_migrations.schema_migrations neexistuje — všetky migrácie sa považujú za čakajúce');
  end if;

  -- 2. Tabuľky zakladané bez IF NOT EXISTS, ktoré už existujú → push zlyhá
  for r in
    select o.version, o.name from _pf_obj o
     where o.kind = 'table' and not o.safe and o.version = any (_pending)
       and to_regclass('public.' || quote_ident(o.name)) is not null
  loop
    insert into _pf_result (check_name, status, detail) values
      ('Kolízia tabuľky ' || r.name, 'FAIL', r.version || ': CREATE TABLE bez IF NOT EXISTS, tabuľka už existuje → db push zlyhá');
  end loop;

  -- 3. Funkcie, ktoré čakajúce migrácie nepodmienene prepíšu
  select string_agg(distinct o.name, ', ') into _list from _pf_obj o
   where o.kind = 'function' and not o.safe and o.version = any (_pending)
     and exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = o.name);
  if _list is not null then
    insert into _pf_result (check_name, status, detail) values
      ('Existujúce funkcie, ktoré push prepíše', 'WARN', _list || ' — over, že patria Pandore');
  end if;

  -- 4. public.handle_new_user() — bežný názov zo Supabase šablóny
  if to_regprocedure('public.handle_new_user()') is not null then
    select prosrc into _src from pg_proc where oid = to_regprocedure('public.handle_new_user()');
    if _src like '%public.profiles%' and _src like '%public.user_roles%' then
      insert into _pf_result (check_name, status, detail) values
        ('public.handle_new_user()', 'PASS', 'Pandorina verzia (profiles + user_roles)');
    else
      insert into _pf_result (check_name, status, detail) values
        ('public.handle_new_user()', 'WARN', 'patrí inej appke — Pandora ju neprepíše (guard) a použije pandora_handle_new_user()');
    end if;
  end if;

  -- 5. Triggery na auth.users
  for r in
    select t.tgname, p.proname, n.nspname, p.prosrc
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     order by t.tgname
  loop
    if r.tgname = 'pandora_on_auth_user_created'
       or (r.nspname = 'public' and r.prosrc like '%public.profiles%' and r.prosrc like '%public.user_roles%') then
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'PASS', 'Pandora → ' || r.nspname || '.' || r.proname);
    else
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'WARN', 'cudzí → ' || r.nspname || '.' || r.proname || ' (zdieľaná DB; Pandora ho nemení)');
    end if;
  end loop;

  -- 6. Cudzie tabuľky v public → zdieľaná databáza
  select count(*), string_agg(c.relname, ', ' order by c.relname) into _n, _list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in (select name from _pf_known);
  insert into _pf_result (check_name, status, detail) values
    ('Zdieľaná databáza', case when _n = 0 then 'PASS' else 'WARN' end,
     case when _n = 0 then 'v public sú iba Pandorine tabuľky'
          else _n || ' cudzích tabuliek: ' || left(_list, 400) end);

  -- 7. Používatelia bez Pandora profilu (registrácie z inej appky / pred hookom)
  if to_regclass('public.profiles') is not null then
    execute 'select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)' into _n;
    insert into _pf_result (check_name, status, detail) values
      ('auth.users bez Pandora profilu', case when _n = 0 then 'PASS' else 'INFO' end, _n || ' používateľov');
  end if;

  -- Verdikt
  select case
           when exists (select 1 from _pf_result where status = 'FAIL') then 'NO-GO'
           when exists (select 1 from _pf_result where status = 'WARN') then 'GO S VAROVANÍM'
           else 'GO' end
    into _list;
  insert into _pf_result (check_name, status, detail) values
    ('VERDIKT', _list, case _list
       when 'NO-GO' then 'db push by zlyhal alebo poškodil cudzie objekty — vyrieš FAIL riadky'
       when 'GO S VAROVANÍM' then 'push je technicky možný; posúď každé WARN (zdieľaná DB)'
       else 'push je bezpečný' end);
end
$pf$;

select n, check_name, status, detail from _pf_result order by n;
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(generatePreflightSql());
}
