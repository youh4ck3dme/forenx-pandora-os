-- P1-03: Retention, legal hold and controlled destruction.
--
-- 1. cases: lifecycle status (draft / closed / legal_hold / archived /
--    destroyed) with reason and change timestamp. Only 'draft' is mutable;
--    every other state is content-read-only.
-- 2. Status transitions are RPC-only (set_case_status). Raw UPDATEs of
--    cases.status are rejected. Releasing a legal hold requires an admin.
-- 3. Child tables (entities, transactions, relations, weapons, events,
--    imports) reject INSERT/UPDATE/DELETE unless the case is 'draft', so a
--    legal hold blocks every mutation and deletion path.
-- 4. destroy_case: admin-approved controlled destruction. It writes an
--    immutable audit entry first, then removes the case and its records.
--    The append-only audit chain survives the cascade (case_audit_log has
--    no FK to cases).

-- ============ 1. cases lifecycle ============

alter table public.cases
  add column if not exists status text not null default 'draft',
  add column if not exists status_reason text not null default '',
  add column if not exists status_changed_at timestamptz not null default now();

alter table public.cases drop constraint if exists cases_status_check;
alter table public.cases
  add constraint cases_status_check
  check (status in ('draft','closed','legal_hold','archived','destroyed'));

create index if not exists idx_cases_status on public.cases (user_id, status);

create or replace function public.case_status_transition_ok(_from text, _to text)
returns boolean
language sql
immutable
as $$
  select case _from
    when 'draft'      then _to in ('closed', 'legal_hold')
    when 'closed'     then _to in ('draft', 'legal_hold', 'archived')
    when 'legal_hold' then _to in ('closed', 'archived')
    when 'archived'   then _to in ('closed', 'legal_hold', 'destroyed')
    else false
  end;
$$;

-- ============ 2. set_case_status ============

create or replace function public.set_case_status(_case_id uuid, _status text, _reason text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _case public.cases;
  _is_admin boolean;
begin
  if _actor is null then
    raise exception 'Chýba overenie identity.' using errcode = '42501';
  end if;
  if _status = 'destroyed' then
    raise exception 'Zničenie prípadu je možné iba cez destroy_case so schválením administrátora.'
      using errcode = '42501';
  end if;

  select * into _case from public.cases where id = _case_id for update;
  if not found then
    raise exception 'Prípad nebol nájdený.' using errcode = 'P0002';
  end if;

  _is_admin := public.has_role(_actor, 'admin');
  if _case.user_id <> _actor and not _is_admin then
    raise exception 'Nemáte oprávnenie na túto operáciu.' using errcode = '42501';
  end if;

  if _case.status = _status then
    return _status;
  end if;
  if not public.case_status_transition_ok(_case.status, _status) then
    raise exception 'Zmena stavu „%“ → „%“ nie je povolená.', _case.status, _status;
  end if;
  if _case.status = 'legal_hold' and not _is_admin then
    raise exception 'Legal hold môže zrušiť iba administrátor.' using errcode = '42501';
  end if;

  perform set_config('forenx.lifecycle_rpc', 'on', true);
  update public.cases
     set status = _status,
         status_reason = coalesce(nullif(btrim(_reason), ''), status_reason),
         status_changed_at = now()
   where id = _case_id;

  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    _case.user_id, _case_id, 'case_status_changed', 'cases', _case_id,
    jsonb_build_object(
      'from', _case.status, 'to', _status, 'reason', _reason,
      'actor', _actor, 'by_admin', _is_admin)
  );

  return _status;
end;
$$;

revoke all on function public.set_case_status(uuid, text, text) from public;
grant execute on function public.set_case_status(uuid, text, text) to authenticated, service_role;

-- ============ 3. destroy_case (admin approval + immutable audit) ============

create or replace function public.destroy_case(_case_id uuid, _reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _case public.cases;
  _counts jsonb;
begin
  if _actor is null then
    raise exception 'Chýba overenie identity.' using errcode = '42501';
  end if;
  if not public.has_role(_actor, 'admin') then
    raise exception 'Zničenie prípadu vyžaduje schválenie administrátora.'
      using errcode = '42501';
  end if;
  if coalesce(btrim(_reason), '') = '' then
    raise exception 'Zničenie prípadu vyžaduje odôvodnenie.';
  end if;

  select * into _case from public.cases where id = _case_id for update;
  if not found then
    raise exception 'Prípad nebol nájdený.' using errcode = 'P0002';
  end if;
  if _case.status <> 'archived' then
    raise exception 'Zničiť možno iba archivovaný prípad (aktuálny stav: „%“).', _case.status;
  end if;

  select jsonb_build_object(
    'entities',     (select count(*) from public.case_entities     where case_id = _case_id),
    'transactions', (select count(*) from public.case_transactions where case_id = _case_id),
    'relations',    (select count(*) from public.case_relations    where case_id = _case_id),
    'weapons',      (select count(*) from public.case_weapons      where case_id = _case_id),
    'events',       (select count(*) from public.case_events       where case_id = _case_id),
    'imports',      (select count(*) from public.case_imports      where case_id = _case_id)
  ) into _counts;

  -- Immutable record of the destruction, written before the cascade runs.
  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    _case.user_id, _case_id, 'case_destroyed', 'cases', _case_id,
    jsonb_build_object(
      'reason', _reason, 'actor', _actor, 'approved_by_admin', true,
      'records', _counts)
  );

  perform set_config('forenx.lifecycle_rpc', 'on', true);
  update public.cases
     set status = 'destroyed', status_reason = _reason, status_changed_at = now()
   where id = _case_id;
  delete from public.cases where id = _case_id;

  return jsonb_build_object('case_id', _case_id, 'destroyed', true, 'records', _counts);
end;
$$;

revoke all on function public.destroy_case(uuid, text) from public;
grant execute on function public.destroy_case(uuid, text) to authenticated, service_role;

-- ============ 4. enforcement triggers ============

-- Child records: any mutation requires the parent case to be 'draft'.
create or replace function public.enforce_case_lifecycle_child()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _case_id uuid := coalesce(new.case_id, old.case_id);
  _status text;
begin
  select status into _status from public.cases where id = _case_id;
  if _status is not null and _status <> 'draft' then
    raise exception 'Prípad je v stave „%“ — zmeny dát prípadu nie sú povolené.', _status
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'case_entities','case_transactions','case_relations',
    'case_weapons','case_events','case_imports'] loop
    execute format('drop trigger if exists case_lifecycle_%1$s on public.%1$I', t);
    execute format(
      'create trigger case_lifecycle_%1$s before insert or update or delete on public.%1$I ' ||
      'for each row execute function public.enforce_case_lifecycle_child()', t);
  end loop;
end $$;

-- Case row: status moves only through the lifecycle RPCs; every non-draft
-- state freezes the content columns (lifecycle bookkeeping is exempt).
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
begin
  if new.status is distinct from old.status
     and current_setting('forenx.lifecycle_rpc', true) <> 'on' then
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

drop trigger if exists case_lifecycle_case_update on public.cases;
create trigger case_lifecycle_case_update before update on public.cases
  for each row execute function public.enforce_case_lifecycle_case_update();

-- Case deletion: drafts may be deleted by the owner; every other state only
-- through destroy_case (which marks the row 'destroyed' first).
create or replace function public.enforce_case_lifecycle_case_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status not in ('draft','destroyed')
     and current_setting('forenx.lifecycle_rpc', true) <> 'on' then
    raise exception 'Prípad v stave „%“ možno odstrániť iba kontrolovaným zničením (destroy_case).',
      old.status using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists case_lifecycle_case_delete on public.cases;
create trigger case_lifecycle_case_delete before delete on public.cases
  for each row execute function public.enforce_case_lifecycle_case_delete();
