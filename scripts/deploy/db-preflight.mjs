#!/usr/bin/env node
/**
 * Preflight pred `supabase db push` na (možno zdieľanú) databázu.
 *
 *   node scripts/deploy/db-preflight.mjs > preflight.sql
 *   → vložiť do Supabase SQL Editora, alebo: psql "$DATABASE_URL" -f preflight.sql
 *
 * Z migrácií v repe zistí, čo ktorá vytvára, a vygeneruje READ-ONLY SQL (iba
 * dočasné tabuľky tejto session), ktoré na cieľovej DB overí:
 *   - aplikované vs. čakajúce migrácie (supabase_migrations.schema_migrations),
 *   - tabuľky z čakajúcich migrácií, ktoré už existujú: bez IF NOT EXISTS → push zlyhá;
 *     s IF NOT EXISTS → overia sa stĺpce (cudzia tabuľka = NO-GO, inak varovanie,
 *     lebo migrácia na nej vytvorí indexy/politiky/triggery),
 *   - triggery z čakajúcich migrácií (bez DROP IF EXISTS), ktoré už existujú → push zlyhá,
 *   - nepodmienený CREATE OR REPLACE public.handle_new_user() na cudziu funkciu → NO-GO,
 *   - ďalšie funkcie, ktoré push prepíše,
 *   - triggery na auth.users a public.handle_new_user(): Pandora iba ak telo funkcie je
 *     PRESNE jedna zo známych verzií (md5 tela bez rozdielov v bielych znakoch),
 *   - cudzie tabuľky v public (= zdieľaná DB), používateľov bez Pandora profilu.
 * Výsledok: check | status | detail + VERDIKT (GO / GO S VAROVANÍM / NO-GO).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const SIGNUP_FUNCTIONS = ["handle_new_user", "pandora_handle_new_user"];

/** md5 tela funkcie po zjednotení bielych znakov — zhodné s SQL výrazom SQL_BODY_HASH. */
export function bodyHash(body) {
  return createHash("md5").update(body.replace(/\s+/g, " ").trim()).digest("hex");
}
const SQL_BODY_HASH = (col) => `md5(btrim(regexp_replace(${col}, '[[:space:]]+', ' ', 'g')))`;

/** Odstráni komentáre a DO bloky (ich obsah je podmienený, nevykoná sa nepodmienene). */
function topLevelSql(sql) {
  return sql.replace(/--[^\n]*/g, "").replace(/\bdo\s+\$(\w*)\$[\s\S]*?\$\1\$\s*;/gi, " ");
}

/** Názvy stĺpcov z tela CREATE TABLE (bez obmedzení na úrovni tabuľky). */
function columnsOf(body) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts
    .map((p) => p.trim())
    .filter((p) => p && !/^(constraint|primary|unique|foreign|check|exclude|like)\b/i.test(p))
    .map((p) => p.match(/^"?([a-z_][a-z0-9_]*)"?/i)?.[1]?.toLowerCase())
    .filter(Boolean);
}

/** Obsah zátvorky začínajúcej na indexe `open` (vyvážené zátvorky). */
function parenBody(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") { depth--; if (depth === 0) return sql.slice(open + 1, i); }
  }
  return "";
}

/** Objekty, ktoré migrácia vytvára nepodmienene (na najvyššej úrovni). */
export function parseMigration(sql) {
  const top = topLevelSql(sql);
  const tables = [];
  const functions = [];
  const triggers = [];
  const tableRe = /\bcreate\s+table\s+(if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let m;
  while ((m = tableRe.exec(top))) {
    tables.push({
      name: m[2].toLowerCase(),
      ifNotExists: Boolean(m[1]),
      columns: columnsOf(parenBody(top, m.index + m[0].length - 1)),
    });
  }
  const fnRe = /\bcreate\s+(or\s+replace\s+)?function\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  while ((m = fnRe.exec(top))) functions.push({ name: m[2].toLowerCase(), orReplace: Boolean(m[1]) });
  const trgRe = /\bcreate\s+trigger\s+"?([a-z_][a-z0-9_]*)"?[\s\S]*?\bon\s+(?:(auth|public)\.)?"?([a-z_][a-z0-9_]*)"?/gi;
  while ((m = trgRe.exec(top))) {
    const name = m[1].toLowerCase();
    const table = `${(m[2] || "public").toLowerCase()}.${m[3].toLowerCase()}`;
    const dropped = new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+"?${name}"?\\s+on\\s`, "i").test(top.slice(0, m.index));
    if (!dropped) triggers.push({ name, table });
  }
  const allTables = [...sql.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map((x) => x[1].toLowerCase());
  const allFunctions = [...sql.matchAll(/\bfunction\s+(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map((x) => x[1].toLowerCase());
  return { tables, functions, triggers, allTables, allFunctions };
}

/** Hashe všetkých verzií Pandorinho registračného hooku, ktoré repo kedy definovalo. */
export function knownSignupHookHashes(dir = MIGRATIONS) {
  const hashes = new Set();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    for (const fn of SIGNUP_FUNCTIONS) {
      const re = new RegExp(`function\\s+public\\.${fn}\\s*\\(\\s*\\)[\\s\\S]*?\\bas\\s+\\$(\\w*)\\$([\\s\\S]*?)\\$\\1\\$`, "gi");
      for (const m of sql.matchAll(re)) hashes.add(bodyHash(m[2]));
    }
  }
  return [...hashes].sort();
}

export function loadMigrations(dir = MIGRATIONS) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ version: file.split("_")[0], file, ...parseMigration(fs.readFileSync(path.join(dir, file), "utf8")) }));
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arr = (xs) => `array[${xs.map(q).join(", ")}]::text[]`;

export function generatePreflightSql(migrations = loadMigrations(), hookHashes = knownSignupHookHashes()) {
  const migRows = migrations.map((m) => `(${q(m.version)}, ${q(m.file)})`).join(",\n  ");
  const objRows = [];
  for (const m of migrations) {
    for (const t of m.tables) objRows.push(`(${q(m.version)}, 'table', ${q(t.name)}, ${t.ifNotExists}, ${arr(t.columns)}, null)`);
    for (const f of m.functions) objRows.push(`(${q(m.version)}, 'function', ${q(f.name)}, ${!f.orReplace}, null, null)`);
    for (const t of m.triggers) objRows.push(`(${q(m.version)}, 'trigger', ${q(t.name)}, false, null, ${q(t.table)})`);
  }
  const knownRows = [...new Set(migrations.flatMap((m) => m.allTables))].sort().map((t) => `(${q(t)})`).join(", ");
  const hashArr = `array[${hookHashes.map(q).join(", ")}]::text[]`;

  return `-- Pandora DB preflight (READ-ONLY; vygenerované ${new Date().toISOString()} z ${migrations.length} migrácií)
-- Mení iba dočasné tabuľky tejto session. Spustenie: SQL Editor alebo psql -f.

create temp table if not exists _pf_local (version text primary key, file text) on commit preserve rows;
create temp table if not exists _pf_obj (version text, kind text, name text, safe boolean, columns text[], target text) on commit preserve rows;
create temp table if not exists _pf_known (name text primary key) on commit preserve rows;
create temp table if not exists _pf_result (n serial, check_name text, status text, detail text) on commit preserve rows;
truncate _pf_local, _pf_obj, _pf_known, _pf_result;

insert into _pf_local (version, file) values
  ${migRows};
${objRows.length ? `insert into _pf_obj (version, kind, name, safe, columns, target) values\n  ${objRows.join(",\n  ")};` : ""}
insert into _pf_known (name) values ${knownRows};

do $pf$
declare
  _has_history boolean := to_regclass('supabase_migrations.schema_migrations') is not null;
  _hook_hashes text[] := ${hashArr};
  _pending text[] := '{}';
  _n int;
  _list text;
  _src text;
  _missing text[];
  _hnu_foreign boolean := false;
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

  -- 2. Existujúce tabuľky, ktoré čakajúce migrácie zakladajú
  for r in
    select o.version, o.name, o.safe, o.columns from _pf_obj o
     where o.kind = 'table' and o.version = any (_pending)
       and to_regclass('public.' || quote_ident(o.name)) is not null
  loop
    select coalesce(array_agg(c), '{}') into _missing
      from unnest(r.columns) c
     where not exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public' and ic.table_name = r.name and ic.column_name = c);
    if not r.safe then
      insert into _pf_result (check_name, status, detail) values
        ('Kolízia tabuľky ' || r.name, 'FAIL', r.version || ': CREATE TABLE bez IF NOT EXISTS, tabuľka už existuje → db push zlyhá');
    elsif cardinality(_missing) > 0 then
      insert into _pf_result (check_name, status, detail) values
        ('Cudzia tabuľka ' || r.name, 'FAIL', r.version || ': tabuľka existuje s inou schémou (chýba ' || array_to_string(_missing, ', ')
         || ') — IF NOT EXISTS ju preskočí, no migrácia na nej vytvorí indexy/politiky/triggery');
    else
      insert into _pf_result (check_name, status, detail) values
        ('Existujúca tabuľka ' || r.name, 'WARN', r.version || ': už existuje so zhodnými stĺpcami; migrácia na nej vytvorí indexy/politiky/triggery — over, že je Pandorina');
    end if;
  end loop;

  -- 3. Triggery z čakajúcich migrácií (bez DROP IF EXISTS), ktoré už existujú → push zlyhá
  for r in
    select o.version, o.name, o.target from _pf_obj o
     where o.kind = 'trigger' and o.version = any (_pending)
       and to_regclass(o.target) is not null
       and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(o.target) and t.tgname = o.name and not t.tgisinternal)
  loop
    insert into _pf_result (check_name, status, detail) values
      ('Kolízia triggera ' || r.name, 'FAIL', r.version || ': CREATE TRIGGER na ' || r.target || ', trigger už existuje → db push zlyhá');
  end loop;

  -- 4. public.handle_new_user(): Pandorina iba pri presnej zhode tela so známou verziou
  if to_regprocedure('public.handle_new_user()') is not null then
    select prosrc into _src from pg_proc where oid = to_regprocedure('public.handle_new_user()');
    if ${SQL_BODY_HASH("_src")} = any (_hook_hashes) then
      insert into _pf_result (check_name, status, detail) values
        ('public.handle_new_user()', 'PASS', 'známa Pandorina verzia');
    else
      _hnu_foreign := true;
      if exists (select 1 from _pf_obj o where o.kind = 'function' and o.name = 'handle_new_user'
                  and not o.safe and o.version = any (_pending)) then
        select string_agg(o.version, ', ') into _list from _pf_obj o
         where o.kind = 'function' and o.name = 'handle_new_user' and not o.safe and o.version = any (_pending);
        insert into _pf_result (check_name, status, detail) values
          ('public.handle_new_user()', 'FAIL', 'patrí inej appke a čakajúca migrácia ' || _list || ' ju nepodmienene prepíše');
      else
        insert into _pf_result (check_name, status, detail) values
          ('public.handle_new_user()', 'WARN', 'patrí inej appke — žiadna čakajúca migrácia ju nepodmienene neprepíše; Pandora používa pandora_handle_new_user()');
      end if;
    end if;
  end if;

  -- 5. Ďalšie funkcie, ktoré čakajúce migrácie nepodmienene prepíšu
  select string_agg(distinct o.name, ', ') into _list from _pf_obj o
   where o.kind = 'function' and not o.safe and o.version = any (_pending)
     and not (o.name = 'handle_new_user' and _hnu_foreign)
     and exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = o.name);
  if _list is not null then
    insert into _pf_result (check_name, status, detail) values
      ('Existujúce funkcie, ktoré push prepíše', 'WARN', _list || ' — over, že patria Pandore');
  end if;

  -- 6. Triggery na auth.users
  for r in
    select t.tgname, p.proname, n.nspname, p.prosrc
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     order by t.tgname
  loop
    if n_is_pandora(r.nspname, r.prosrc, _hook_hashes) then
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'PASS', 'Pandora → ' || r.nspname || '.' || r.proname);
    else
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'WARN', 'cudzí → ' || r.nspname || '.' || r.proname || ' (zdieľaná DB; Pandora ho nemení)');
    end if;
  end loop;

  -- 7. Cudzie tabuľky v public → zdieľaná databáza
  select count(*), string_agg(c.relname, ', ' order by c.relname) into _n, _list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in (select name from _pf_known);
  insert into _pf_result (check_name, status, detail) values
    ('Zdieľaná databáza', case when _n = 0 then 'PASS' else 'WARN' end,
     case when _n = 0 then 'v public sú iba tabuľky známe z migrácií Pandory'
          else _n || ' cudzích tabuliek: ' || left(_list, 400) end);

  -- 8. Používatelia bez Pandora profilu
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
`.replace(
    "if n_is_pandora(r.nspname, r.prosrc, _hook_hashes) then",
    `if r.nspname = 'public' and ${SQL_BODY_HASH("r.prosrc")} = any (_hook_hashes) then`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(generatePreflightSql());
}
