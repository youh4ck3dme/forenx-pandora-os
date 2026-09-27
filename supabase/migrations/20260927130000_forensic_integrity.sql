-- Forensic integrity hardening.
--
-- 1. case_audit_log: the action CHECK only allowed INSERT/UPDATE/DELETE, so
--    commit_ai_case_graph ('ai_graph_committed') failed on every call and the
--    whole graph commit rolled back. The log also gains a per-user SHA-256
--    hash chain and is append-only (UPDATE/TRUNCATE rejected; DELETE only via
--    erase_user_audit_log for GDPR erasure of the whole chain).
-- 2. source_snapshots: immutable provenance record per upstream response.
-- 3. case_relations: temporal/evidence columns so re-ingest never overwrites a
--    historical interval.
-- 4. commit_ai_case_graph: writes temporal relations with an evidence hash,
--    rejects relations that point outside the case, records a correlation id.
-- 5. case_transactions: amounts limited to 2 decimal places (NOT VALID, so
--    legacy rows are untouched) and exposed as exact integer minor units.

-- ============ 1. audit log ============
alter table public.case_audit_log drop constraint if exists case_audit_log_action_check;
alter table public.case_audit_log
  add constraint case_audit_log_action_check
  check (action ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$');

alter table public.case_audit_log
  add column if not exists event_id uuid not null default gen_random_uuid(),
  add column if not exists correlation_id text,
  add column if not exists chain_seq bigint,
  add column if not exists previous_event_hash text,
  add column if not exists event_hash text;

create unique index if not exists case_audit_log_event_id_key
  on public.case_audit_log (event_id);

create or replace function public.audit_event_hash(
  _event_id uuid,
  _user_id uuid,
  _case_id uuid,
  _action text,
  _table_name text,
  _record_id uuid,
  _changes jsonb,
  _correlation_id text,
  _created_at timestamptz,
  _chain_seq bigint,
  _previous_hash text
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(concat_ws(
    E'\x1f',
    'forenx-audit-v1',
    _event_id::text,
    _user_id::text,
    coalesce(_case_id::text, ''),
    _action,
    _table_name,
    coalesce(_record_id::text, ''),
    coalesce(_changes::text, 'null'),
    coalesce(_correlation_id, ''),
    to_char(_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    _chain_seq::text,
    _previous_hash
  ), 'UTF8')), 'hex')
$$;

-- Backfill existing rows into per-user chains (oldest first).
do $$
declare
  r record;
  prev_user uuid := null;
  prev_hash text;
  seq bigint;
begin
  for r in
    select * from public.case_audit_log order by user_id, created_at, id
  loop
    if prev_user is distinct from r.user_id then
      prev_user := r.user_id;
      prev_hash := repeat('0', 64);
      seq := 0;
    end if;
    seq := seq + 1;
    update public.case_audit_log
       set chain_seq = seq,
           previous_event_hash = prev_hash,
           event_hash = public.audit_event_hash(
             r.event_id, r.user_id, r.case_id, r.action, r.table_name,
             r.record_id, r.changes, r.correlation_id, r.created_at, seq, prev_hash)
     where id = r.id
     returning event_hash into prev_hash;
  end loop;
end $$;

alter table public.case_audit_log
  alter column chain_seq set not null,
  alter column previous_event_hash set not null,
  alter column event_hash set not null;

create unique index if not exists case_audit_log_user_chain_seq_key
  on public.case_audit_log (user_id, chain_seq);

create or replace function public.case_audit_log_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _prev_hash text;
  _prev_seq bigint;
begin
  -- Serialise appends per user so two concurrent writers cannot fork the chain.
  perform pg_advisory_xact_lock(hashtextextended('case_audit_log:' || new.user_id::text, 0));

  select event_hash, chain_seq into _prev_hash, _prev_seq
    from public.case_audit_log
   where user_id = new.user_id
   order by chain_seq desc
   limit 1;

  new.event_id := coalesce(new.event_id, gen_random_uuid());
  -- Server clock only: a caller cannot back-date an audit entry.
  new.created_at := now();
  new.chain_seq := coalesce(_prev_seq, 0) + 1;
  new.previous_event_hash := coalesce(_prev_hash, repeat('0', 64));
  new.event_hash := public.audit_event_hash(
    new.event_id, new.user_id, new.case_id, new.action, new.table_name,
    new.record_id, new.changes, new.correlation_id, new.created_at,
    new.chain_seq, new.previous_event_hash);
  return new;
end;
$$;

drop trigger if exists case_audit_log_chain on public.case_audit_log;
create trigger case_audit_log_chain
before insert on public.case_audit_log
for each row execute function public.case_audit_log_chain();

create or replace function public.case_audit_log_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and current_setting('forenx.audit_erasure', true) = 'on' then
    return old;
  end if;
  raise exception 'case_audit_log is append-only (% rejected)', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists case_audit_log_no_update on public.case_audit_log;
create trigger case_audit_log_no_update
before update or delete on public.case_audit_log
for each row execute function public.case_audit_log_append_only();

drop trigger if exists case_audit_log_no_truncate on public.case_audit_log;
create trigger case_audit_log_no_truncate
before truncate on public.case_audit_log
for each statement execute function public.case_audit_log_append_only();

-- GDPR erasure removes a user's complete chain (never a subset of it).
create or replace function public.erase_user_audit_log(_user uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  perform set_config('forenx.audit_erasure', 'on', true);
  delete from public.case_audit_log where user_id = _user;
  get diagnostics _deleted = row_count;
  perform set_config('forenx.audit_erasure', 'off', true);
  return _deleted;
end;
$$;

-- Returns the first broken link of a user's chain, or no rows when intact.
create or replace function public.verify_audit_chain(_user uuid)
returns table (chain_seq bigint, event_id uuid, problem text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  _expected_prev text := repeat('0', 64);
  _expected_seq bigint := 0;
begin
  for r in
    select * from public.case_audit_log l where l.user_id = _user order by l.chain_seq
  loop
    _expected_seq := _expected_seq + 1;
    if r.chain_seq <> _expected_seq then
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'sequence_gap';
      return next; return;
    end if;
    if r.previous_event_hash <> _expected_prev then
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'previous_hash_mismatch';
      return next; return;
    end if;
    if r.event_hash <> public.audit_event_hash(
         r.event_id, r.user_id, r.case_id, r.action, r.table_name, r.record_id,
         r.changes, r.correlation_id, r.created_at, r.chain_seq, r.previous_event_hash) then
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'event_hash_mismatch';
      return next; return;
    end if;
    _expected_prev := r.event_hash;
  end loop;
end;
$$;

-- Server-side audit entry point for events that are not written by an RPC.
create or replace function public.append_audit_event(
  _actor uuid,
  _case uuid,
  _action text,
  _target_table text,
  _record uuid,
  _changes jsonb,
  _correlation text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _event uuid;
begin
  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) values (
    _actor, _case, _action, _target_table, _record, _changes, _correlation
  )
  returning event_id into _event;
  return _event;
end;
$$;

revoke all on function public.audit_event_hash(uuid, uuid, uuid, text, text, uuid, jsonb, text, timestamptz, bigint, text) from public, anon, authenticated;
revoke all on function public.case_audit_log_chain() from public, anon, authenticated;
revoke all on function public.case_audit_log_append_only() from public, anon, authenticated;
revoke all on function public.erase_user_audit_log(uuid) from public, anon, authenticated;
revoke all on function public.verify_audit_chain(uuid) from public, anon, authenticated;
revoke all on function public.append_audit_event(uuid, uuid, text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.erase_user_audit_log(uuid) to service_role;
grant execute on function public.verify_audit_chain(uuid) to service_role;
grant execute on function public.append_audit_event(uuid, uuid, text, text, uuid, jsonb, text) to service_role;

-- ============ 2. source snapshots ============
create table if not exists public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.cases(id) on delete cascade,
  user_id uuid not null,
  source text not null check (length(source) between 1 and 80),
  source_url text not null check (length(source_url) between 1 and 2048),
  http_status integer not null check (http_status between 100 and 599),
  retrieved_at timestamptz not null,
  content_type text,
  parser_version text not null check (length(parser_version) between 1 and 40),
  raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  storage_ref text,
  etag text,
  last_modified text,
  created_at timestamptz not null default now()
);

create index if not exists source_snapshots_case_idx
  on public.source_snapshots (case_id, retrieved_at desc);

grant select on public.source_snapshots to authenticated;
grant all on public.source_snapshots to service_role;
alter table public.source_snapshots enable row level security;
drop policy if exists "Users read own source snapshots" on public.source_snapshots;
create policy "Users read own source snapshots"
on public.source_snapshots for select to authenticated
using (auth.uid() = user_id);

create or replace function public.source_snapshots_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'source_snapshots rows are immutable' using errcode = '42501';
end;
$$;

drop trigger if exists source_snapshots_immutable on public.source_snapshots;
create trigger source_snapshots_immutable
before update on public.source_snapshots
for each row execute function public.source_snapshots_immutable();

-- ============ 3. temporal relations ============
alter table public.case_relations
  add column if not exists valid_from date,
  add column if not exists valid_to date,
  add column if not exists source_snapshot_id uuid references public.source_snapshots(id),
  add column if not exists evidence_hash text;

alter table public.case_relations drop constraint if exists case_relations_valid_interval;
alter table public.case_relations
  add constraint case_relations_valid_interval
  check (valid_from is null or valid_to is null or valid_to >= valid_from);

alter table public.case_relations drop constraint if exists case_relations_evidence_hash_format;
alter table public.case_relations
  add constraint case_relations_evidence_hash_format
  check (evidence_hash is null or evidence_hash ~ '^[0-9a-f]{64}$');

create index if not exists case_relations_temporal_idx
  on public.case_relations (case_id, from_id, to_id, valid_from);

-- An evidence-backed interval is history: correct it by inserting a new row.
create or replace function public.case_relations_history_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.evidence_hash is not null and (
       new.from_id is distinct from old.from_id
    or new.to_id is distinct from old.to_id
    or new.label is distinct from old.label
    or new.valid_from is distinct from old.valid_from
    or new.valid_to is distinct from old.valid_to
    or new.source_snapshot_id is distinct from old.source_snapshot_id
    or new.evidence_hash is distinct from old.evidence_hash
  ) then
    raise exception 'evidence-backed relation interval is immutable; insert a new relation instead'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists case_relations_history_guard on public.case_relations;
create trigger case_relations_history_guard
before update on public.case_relations
for each row execute function public.case_relations_history_guard();

create or replace function public.relation_evidence_hash(
  _from uuid,
  _to uuid,
  _label text,
  _valid_from date,
  _valid_to date,
  _source_snapshot uuid
)
returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(concat_ws(
    E'\x1f',
    'forenx-relation-v1',
    _from::text,
    _to::text,
    _label,
    coalesce(_valid_from::text, ''),
    coalesce(_valid_to::text, ''),
    coalesce(_source_snapshot::text, '')
  ), 'UTF8')), 'hex')
$$;

-- ============ 4. atomic graph commit v2 ============
drop function if exists public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb);

create or replace function public.commit_ai_case_graph(
  _case uuid,
  _actor uuid,
  _entities jsonb,
  _events jsonb,
  _relations jsonb,
  _correlation text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _owner uuid;
  _foreign integer;
begin
  select user_id into _owner
  from public.cases
  where id = _case
  for update;

  if _owner is null or _owner <> _actor then
    raise exception 'Case not found or access denied' using errcode = '42501';
  end if;

  insert into public.case_entities (
    id, case_id, user_id, name, kind, role, identity_key, x, y
  )
  select
    (entry->>'id')::uuid,
    _case,
    _actor,
    entry->>'name',
    entry->>'kind',
    entry->>'role',
    nullif(entry->>'identity_key', ''),
    (entry->>'x')::numeric,
    (entry->>'y')::numeric
  from jsonb_array_elements(_entities) as entry;

  insert into public.case_events (
    id, case_id, user_id, date, title, detail, severity
  )
  select
    (entry->>'id')::uuid,
    _case,
    _actor,
    (entry->>'date')::date,
    entry->>'title',
    entry->>'detail',
    entry->>'severity'
  from jsonb_array_elements(_events) as entry;

  -- Every relation endpoint must be an entity of this very case.
  select count(*) into _foreign
  from jsonb_array_elements(_relations) as entry
  where not exists (
          select 1 from public.case_entities e
          where e.id = (entry->>'from_id')::uuid and e.case_id = _case)
     or not exists (
          select 1 from public.case_entities e
          where e.id = (entry->>'to_id')::uuid and e.case_id = _case);
  if _foreign > 0 then
    raise exception 'relation endpoint outside case %', _case using errcode = '23503';
  end if;

  insert into public.case_relations (
    id, case_id, user_id, from_id, to_id, label,
    valid_from, valid_to, source_snapshot_id, evidence_hash
  )
  select
    (entry->>'id')::uuid,
    _case,
    _actor,
    (entry->>'from_id')::uuid,
    (entry->>'to_id')::uuid,
    entry->>'label',
    nullif(entry->>'valid_from', '')::date,
    nullif(entry->>'valid_to', '')::date,
    nullif(entry->>'source_snapshot_id', '')::uuid,
    public.relation_evidence_hash(
      (entry->>'from_id')::uuid,
      (entry->>'to_id')::uuid,
      entry->>'label',
      nullif(entry->>'valid_from', '')::date,
      nullif(entry->>'valid_to', '')::date,
      nullif(entry->>'source_snapshot_id', '')::uuid)
  from jsonb_array_elements(_relations) as entry;

  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) values (
    _actor,
    _case,
    'ai_graph_committed',
    'case_graph',
    _case,
    jsonb_build_object(
      'entities', jsonb_array_length(_entities),
      'events', jsonb_array_length(_events),
      'relations', jsonb_array_length(_relations)
    ),
    _correlation
  );

  return jsonb_build_object(
    'entities', jsonb_array_length(_entities),
    'events', jsonb_array_length(_events),
    'relations', jsonb_array_length(_relations)
  );
end;
$$;

revoke all on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb, text) to service_role;
revoke all on function public.relation_evidence_hash(uuid, uuid, text, date, date, uuid) from public, anon;

-- Import commit now leaves an audit entry in the same transaction.
create or replace function public.commit_import(_import uuid, _rows jsonb, _actor uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  imp public.case_imports;
  inserted integer := 0;
begin
  select * into imp from public.case_imports where id = _import for update;
  if imp.id is null then raise exception 'import_not_found'; end if;
  if imp.user_id <> _actor then raise exception 'forbidden'; end if;
  if imp.status <> 'pending' then raise exception 'import_already_processed'; end if;

  insert into public.case_transactions
    (case_id, user_id, date, amount, currency, method, from_id, to_id, payer_id,
     origin_country, destination_country, description)
  select imp.case_id, imp.user_id,
         (r->>'date')::date,
         (r->>'amount')::numeric,
         upper(r->>'currency'),
         r->>'method',
         (r->>'from_id')::uuid,
         (r->>'to_id')::uuid,
         nullif(r->>'payer_id','')::uuid,
         upper(coalesce(r->>'origin_country','SK')),
         upper(coalesce(r->>'destination_country','SK')),
         coalesce(r->>'description','')
    from jsonb_array_elements(_rows) as r;
  get diagnostics inserted = row_count;

  update public.case_imports set status = 'committed', updated_at = now() where id = _import;

  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (_actor, imp.case_id, 'import_committed', 'case_imports', _import,
          jsonb_build_object('rows', inserted));
  return inserted;
end;
$$;
revoke all on function public.commit_import(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.commit_import(uuid, jsonb, uuid) to service_role;

-- ============ 5. money ============
alter table public.case_transactions drop constraint if exists case_transactions_amount_scale;
alter table public.case_transactions
  add constraint case_transactions_amount_scale
  check (amount = round(amount, 2) and abs(amount) < 1000000000000000)
  not valid;

alter table public.case_transactions
  add column if not exists amount_minor bigint
  generated always as ((round(amount, 2) * 100)::bigint) stored;
