-- Additive forensic immutability hardening.
--
-- This migration intentionally does not rewrite the earlier migrations. It
-- re-declares the guards so a later deployment cannot accidentally weaken the
-- identity WORM boundary or the source snapshot erasure boundary.

-- ============ evidence_items identity WORM ============
create or replace function public.evidence_items_worm_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Identity and provenance are immutable for every database role, including
  -- service_role and supabase_admin. Verification is a separate trust
  -- boundary below and must never make identity mutable.
  if new.id is distinct from old.id
     or new.investigator_id is distinct from old.investigator_id
     or new.case_name is distinct from old.case_name
     or new.file_name is distinct from old.file_name
     or new.file_size is distinct from old.file_size
     or new.mime_type is distinct from old.mime_type
     or new.s3_object_key is distinct from old.s3_object_key
     or new.sha256_hash is distinct from old.sha256_hash
     or new.created_at is distinct from old.created_at then
    raise exception 'evidence_items identity columns are write-once (WORM)'
      using errcode = '42501';
  end if;

  -- Only the existing trusted server verification workflow may update these
  -- fields. No generic repair path is introduced by this migration.
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and (
       new.legal_hold is distinct from old.legal_hold
       or new.hash_verification_status is distinct from old.hash_verification_status
       or new.hash_verified_at is distinct from old.hash_verified_at
       or new.verified_sha256 is distinct from old.verified_sha256
       or new.verified_size is distinct from old.verified_size
       or new.verification_error is distinct from old.verification_error
     ) then
    raise exception 'legal hold and hash verification are set by the server only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists evidence_items_worm_guard on public.evidence_items;
create trigger evidence_items_worm_guard
before update on public.evidence_items
for each row execute function public.evidence_items_worm_guard();
-- ============ source_snapshots immutable deletion ============
create or replace function public.source_snapshots_delete_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The GUC is meaningful only while this table-owner SECURITY DEFINER
  -- function is executing the complete account erasure transaction.
  if current_setting('forenx.source_snapshots_erasure', true) = 'on'
     and current_user = (
       select pg_get_userbyid(c.relowner)
       from pg_class c
       where c.oid = tg_relid
     ) then
    return old;
  end if;

  raise exception 'source_snapshots rows are deleted only by complete user erasure'
    using errcode = '42501';
end;
$$;
drop trigger if exists source_snapshots_delete_guard on public.source_snapshots;
create trigger source_snapshots_delete_guard
before delete on public.source_snapshots
for each row execute function public.source_snapshots_delete_guard();
revoke delete on public.source_snapshots from public, anon, authenticated, service_role;
-- A case-level delete must never silently cascade into provenance history.
-- Account erasure removes snapshots first through the controlled function;
-- ordinary case deletion is therefore blocked while a snapshot references it.
alter table public.source_snapshots
  drop constraint if exists source_snapshots_case_id_fkey;
alter table public.source_snapshots
  add constraint source_snapshots_case_id_fkey
  foreign key (case_id) references public.cases(id) on delete restrict;
create or replace function public.erase_user_source_snapshots(_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _row record;
  _deleted integer := 0;
begin
  if _user is null then
    raise exception 'user is required' using errcode = '22004';
  end if;

  -- The function is granted only to the trusted account-erasure backend. The
  -- existence check prevents arbitrary UUIDs from becoming a deletion path.
  if not exists (select 1 from auth.users where id = _user) then
    raise exception 'user does not exist' using errcode = 'P0002';
  end if;

  -- Record every deleted snapshot before deleting it. The audit row contains
  -- only provenance metadata, never raw source content.
  for _row in
    select id, case_id, source, raw_sha256, byte_size, storage_ref
    from public.source_snapshots
    where user_id = _user
    order by id
    for update
  loop
    insert into public.case_audit_log (
      user_id, case_id, action, table_name, record_id, changes
    ) values (
      _user,
      _row.case_id,
      'source_snapshots_erased',
      'source_snapshots',
      _row.id,
      jsonb_build_object(
        'source', _row.source,
        'raw_sha256', _row.raw_sha256,
        'byte_size', _row.byte_size,
        'storage_ref', _row.storage_ref
      )
    );
  end loop;

  perform set_config('forenx.source_snapshots_erasure', 'on', true);
  delete from public.source_snapshots where user_id = _user;
  get diagnostics _deleted = row_count;
  perform set_config('forenx.source_snapshots_erasure', 'off', true);
  return _deleted;
exception
  when others then
    perform set_config('forenx.source_snapshots_erasure', 'off', true);
    raise;
end;
$$;
revoke all on function public.source_snapshots_delete_guard() from public, anon, authenticated;
revoke all on function public.erase_user_source_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.erase_user_source_snapshots(uuid) to service_role;
