-- Case-level legal hold must fail-close evidence deletion.
--
-- delete_evidence_item_audited() refused only evidence_items.legal_hold.
-- Clients cannot set that flag (insert guard forces false), and nothing
-- copies cases.status = 'legal_hold' onto the row. The lifecycle trigger
-- that freezes other child tables does not cover evidence_items, so the
-- owner could delete evidence while the case was on legal hold.
--
-- The check is in the audited function and again in the delete trigger,
-- which runs even for the table-owner GUC bypass.

create or replace function public.evidence_case_on_legal_hold(_case_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.cases
     where id = _case_id
       and status = 'legal_hold'
  );
$$;

revoke all on function public.evidence_case_on_legal_hold(uuid) from public;
grant execute on function public.evidence_case_on_legal_hold(uuid) to anon, authenticated, service_role;

create or replace function public.evidence_items_delete_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.legal_hold or public.evidence_case_on_legal_hold(old.case_id) then
    raise exception 'evidence item is under legal hold' using errcode = '42501';
  end if;

  if current_setting('forenx.evidence_delete', true) = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid) then
    return old;
  end if;
  raise exception 'evidence_items rows are deleted only via delete_evidence_item_audited()'
    using errcode = '42501';
end;
$$;

create or replace function public.delete_evidence_item_audited(
  _item uuid,
  _reason text,
  _correlation text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _row public.evidence_items;
  _event uuid;
  _reason_clean text := btrim(coalesce(_reason, ''));
  _case_status text;
begin
  if _actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if length(_reason_clean) < 10 or length(_reason_clean) > 1000 then
    raise exception 'deletion reason must have 10-1000 characters' using errcode = '22023';
  end if;

  select * into _row from public.evidence_items where id = _item for update;
  if _row.id is null
     or (_row.investigator_id <> _actor and not public.has_role(_actor, 'admin')) then
    raise exception 'evidence item not found or access denied' using errcode = '42501';
  end if;
  if _row.legal_hold then
    raise exception 'evidence item is under legal hold' using errcode = '42501';
  end if;
  if _row.case_id is not null then
    select status into _case_status from public.cases where id = _row.case_id for update;
    if _case_status = 'legal_hold' then
      raise exception 'evidence item is under legal hold' using errcode = '42501';
    end if;
  end if;

  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) values (
    _actor, _row.case_id, 'evidence_deleted', 'evidence_items', _row.id,
    jsonb_build_object(
      'case_id', _row.case_id,
      'reason', _reason_clean,
      'owner', _row.investigator_id,
      'snapshot', to_jsonb(_row)
    ),
    _correlation
  )
  returning event_id into _event;

  perform set_config('forenx.evidence_delete', 'on', true);
  delete from public.evidence_items where id = _row.id;
  perform set_config('forenx.evidence_delete', 'off', true);
  return _event;
end;
$$;
