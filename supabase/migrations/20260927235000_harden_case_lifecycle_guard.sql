-- Hardening of the P1-03 case lifecycle guards (20260927140000_case_lifecycle_legal_hold).
--
-- Bug: the guards bypassed on `current_setting('forenx.lifecycle_rpc', true) <> 'on'`.
-- In a session where the GUC was never set, current_setting(..., true) returns NULL,
-- `NULL <> 'on'` is NULL (not true), and the guard did NOT fire. Every new API
-- request is such a session, so the case owner (RLS permits UPDATE/DELETE of own
-- cases) could:
--   * change cases.status directly, incl. releasing a legal hold (no admin, no audit),
--   * delete a case under legal hold / closed / archived directly.
-- The existing tests passed only because an earlier test in the same session had
-- called an RPC, leaving the GUC at '' instead of NULL.
--
-- Fix:
-- 1. Fail closed: the bypass is `coalesce(current_setting(...), '') = 'on'`.
-- 2. Owner-bound: the bypass counts only when the statement runs as the table
--    owner, i.e. inside the SECURITY DEFINER lifecycle RPCs. Any session can set a
--    GUC with set_config(); that alone no longer bypasses anything.
-- 3. New cases can be created only as 'draft' by client roles (no self-created
--    legal hold / archived / destroyed rows).
--
-- Scope: CREATE OR REPLACE of the two P1-03 trigger functions + one new insert
-- trigger on public.cases. Additive; no data is changed.

create or replace function public.case_lifecycle_rpc_active(_table regclass)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(current_setting('forenx.lifecycle_rpc', true), '') = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = _table)
$$;

-- Trigger functions run with the caller's privileges; the helper must stay callable.
revoke all on function public.case_lifecycle_rpc_active(regclass) from public;
grant execute on function public.case_lifecycle_rpc_active(regclass) to anon, authenticated, service_role;

create or replace function public.enforce_case_lifecycle_case_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _new jsonb := to_jsonb(new) - 'status' - 'status_reason' - 'status_changed_at'
                              - 'updated_at' - 'revision';
  _old jsonb := to_jsonb(old) - 'status' - 'status_reason' - 'status_changed_at'
                              - 'updated_at' - 'revision';
  _rpc boolean := public.case_lifecycle_rpc_active(tg_relid::regclass);
begin
  if (new.status is distinct from old.status
      or new.status_reason is distinct from old.status_reason
      or new.status_changed_at is distinct from old.status_changed_at)
     and not _rpc then
    raise exception 'Stav prípadu sa smie meniť iba cez set_case_status / destroy_case.'
      using errcode = '42501';
  end if;

  if old.status <> 'draft' and _new is distinct from _old then
    raise exception 'Prípad je v stave „%“ — obsahové zmeny nie sú povolené.', old.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_case_lifecycle_case_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status not in ('draft', 'destroyed')
     and not public.case_lifecycle_rpc_active(tg_relid::regclass) then
    raise exception 'Prípad v stave „%“ možno odstrániť iba kontrolovaným zničením (destroy_case).',
      old.status using errcode = '42501';
  end if;
  return old;
end;
$$;

create or replace function public.enforce_case_lifecycle_case_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and new.status is distinct from 'draft' then
    raise exception 'Nový prípad musí začínať v stave „draft“ (aktuálne: „%“).', new.status
      using errcode = '42501';
  end if;
  new.status_changed_at := now();
  return new;
end;
$$;

drop trigger if exists case_lifecycle_case_insert on public.cases;
create trigger case_lifecycle_case_insert before insert on public.cases
  for each row execute function public.enforce_case_lifecycle_case_insert();
