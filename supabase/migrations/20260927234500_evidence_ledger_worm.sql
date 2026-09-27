-- Evidence ledger: write-once identity, audited deletion, server-side hash verification.
--
-- Scope: ONLY public.evidence_items and new functions prefixed `evidence_`.
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS, DROP TRIGGER IF EXISTS +
-- CREATE TRIGGER, CREATE OR REPLACE FUNCTION). No table/column is dropped and no
-- object used by another application in a shared database is modified.
--
-- 1. Identity/forensic columns are write-once for EVERY role (incl. service_role).
-- 2. Verification columns and legal_hold change only from trusted server roles.
-- 3. Direct DELETE is impossible (privilege revoked + trigger); the only path is
--    delete_evidence_item_audited(), which refuses legal hold and writes a
--    hash-chained audit entry with a full snapshot in the same transaction.
-- 4. Registration and verification results are hash-chained audit events too.
-- 5. Bypass switches (GUC) are honoured only when the statement runs as the
--    table owner, i.e. inside the audited SECURITY DEFINER function. A client or
--    service_role session can set the GUC, but that no longer bypasses anything.
--    The same hardening is applied to case_audit_log (forensic_integrity).

-- ============ verification columns ============
alter table public.evidence_items
  add column if not exists hash_verification_status text not null default 'pending',
  add column if not exists hash_verified_at timestamptz,
  add column if not exists verified_sha256 text,
  add column if not exists verified_size bigint,
  add column if not exists verification_error text;

alter table public.evidence_items drop constraint if exists evidence_items_verification_status_check;
alter table public.evidence_items
  add constraint evidence_items_verification_status_check
  check (hash_verification_status in ('pending', 'verified', 'mismatch', 'object_missing', 'error'));

-- Legacy rows: canonical lowercase hashes BEFORE the WORM trigger exists. The
-- sha256_hash format is enforced on INSERT (trigger), not by a CHECK that would
-- also fire on verification UPDATEs of a legacy row and abort the worker queue.
update public.evidence_items
   set sha256_hash = lower(btrim(sha256_hash))
 where sha256_hash <> lower(btrim(sha256_hash));

alter table public.evidence_items drop constraint if exists evidence_items_sha256_format;
alter table public.evidence_items drop constraint if exists evidence_items_verified_sha256_format;
alter table public.evidence_items
  add constraint evidence_items_verified_sha256_format
  check (verified_sha256 is null or verified_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists evidence_items_verification_idx
  on public.evidence_items (hash_verification_status, created_at);

-- Trusted server roles (verification state, legal hold) are checked inline in the
-- triggers: trigger functions run with the caller's privileges, so a helper
-- function would need EXECUTE granted to every client role.

-- ============ insert guard ============
create or replace function public.evidence_items_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sha256_hash := lower(btrim(new.sha256_hash));
  if new.sha256_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sha256_hash must be 64 hex characters' using errcode = '23514';
  end if;
  new.created_at := now();
  if not (current_user in ('postgres', 'service_role', 'supabase_admin')) then
    -- A client can never register evidence as already verified or on hold.
    new.legal_hold := false;
    new.hash_verification_status := 'pending';
    new.hash_verified_at := null;
    new.verified_sha256 := null;
    new.verified_size := null;
    new.verification_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists evidence_items_insert_guard on public.evidence_items;
create trigger evidence_items_insert_guard
before insert on public.evidence_items
for each row execute function public.evidence_items_insert_guard();

-- ============ WORM update guard ============
create or replace function public.evidence_items_worm_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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

  if not (current_user in ('postgres', 'service_role', 'supabase_admin')) and (
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

-- ============ no direct DELETE ============
revoke delete on public.evidence_items from anon, authenticated, service_role;

create or replace function public.evidence_items_delete_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- The GUC is settable by any session; it only counts when this statement runs
  -- as the table owner (inside delete_evidence_item_audited, SECURITY DEFINER).
  if current_setting('forenx.evidence_delete', true) = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid) then
    return old;
  end if;
  raise exception 'evidence_items rows are deleted only via delete_evidence_item_audited()'
    using errcode = '42501';
end;
$$;

drop trigger if exists evidence_items_delete_guard on public.evidence_items;
create trigger evidence_items_delete_guard
before delete on public.evidence_items
for each row execute function public.evidence_items_delete_guard();

-- ============ registration audit ============
create or replace function public.evidence_items_audit_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    new.investigator_id, null, 'evidence_registered', 'evidence_items', new.id,
    jsonb_build_object(
      'case_name', new.case_name,
      'file_name', new.file_name,
      'file_size', new.file_size,
      'mime_type', new.mime_type,
      's3_object_key', new.s3_object_key,
      'sha256_hash', new.sha256_hash
    )
  );
  return new;
end;
$$;

drop trigger if exists evidence_items_audit_insert on public.evidence_items;
create trigger evidence_items_audit_insert
after insert on public.evidence_items
for each row execute function public.evidence_items_audit_insert();

-- ============ audited deletion (the only delete path) ============
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
begin
  if _actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if length(_reason_clean) < 10 or length(_reason_clean) > 1000 then
    raise exception 'deletion reason must have 10-1000 characters' using errcode = '22023';
  end if;

  select * into _row from public.evidence_items where id = _item for update;
  -- Same answer for "missing" and "not yours": do not leak existence.
  if _row.id is null
     or (_row.investigator_id <> _actor and not public.has_role(_actor, 'admin')) then
    raise exception 'evidence item not found or access denied' using errcode = '42501';
  end if;
  if _row.legal_hold then
    raise exception 'evidence item is under legal hold' using errcode = '42501';
  end if;

  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) values (
    _actor, null, 'evidence_deleted', 'evidence_items', _row.id,
    jsonb_build_object(
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

-- ============ server-side verification result (service_role only) ============
create or replace function public.record_evidence_verification(
  _item uuid,
  _status text,
  _verified_sha256 text,
  _verified_size bigint,
  _error text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.evidence_items;
begin
  if _status not in ('verified', 'mismatch', 'object_missing', 'error') then
    raise exception 'invalid verification status %', _status using errcode = '22023';
  end if;
  select * into _row from public.evidence_items where id = _item for update;
  if _row.id is null then
    raise exception 'evidence item not found' using errcode = 'P0002';
  end if;
  -- "verified" is only accepted when the stored hash and size really match.
  if _status = 'verified' and (
       lower(coalesce(_verified_sha256, '')) <> _row.sha256_hash
    or _verified_size is distinct from _row.file_size) then
    raise exception 'verified status requires matching sha256 and size' using errcode = '22023';
  end if;

  update public.evidence_items
     set hash_verification_status = _status,
         hash_verified_at = now(),
         verified_sha256 = lower(_verified_sha256),
         verified_size = _verified_size,
         verification_error = left(_error, 500)
   where id = _row.id;

  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    _row.investigator_id, null, 'evidence_hash_' || _status, 'evidence_items', _row.id,
    jsonb_build_object(
      'expected_sha256', _row.sha256_hash,
      'verified_sha256', lower(_verified_sha256),
      'expected_size', _row.file_size,
      'verified_size', _verified_size
    )
  );
  return _status;
end;
$$;

-- ============ case_audit_log: owner-bound erasure bypass ============
-- forensic_integrity allowed DELETE whenever forenx.audit_erasure = 'on'; any
-- session (incl. service_role, which holds ALL on the table) could set it.
create or replace function public.case_audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
     and current_setting('forenx.audit_erasure', true) = 'on'
     and current_user = (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = tg_relid) then
    return old;
  end if;
  raise exception 'case_audit_log is append-only (% rejected)', tg_op
    using errcode = '42501';
end;
$$;

revoke update, delete, truncate on public.case_audit_log from anon, authenticated, service_role;

revoke all on function public.evidence_items_insert_guard() from public, anon, authenticated;
revoke all on function public.evidence_items_worm_guard() from public, anon, authenticated;
revoke all on function public.evidence_items_delete_guard() from public, anon, authenticated;
revoke all on function public.evidence_items_audit_insert() from public, anon, authenticated;
revoke all on function public.delete_evidence_item_audited(uuid, text, text) from public, anon;
revoke all on function public.record_evidence_verification(uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.delete_evidence_item_audited(uuid, text, text) to authenticated, service_role;
grant execute on function public.record_evidence_verification(uuid, text, text, bigint, text) to service_role;
