-- ==============================================================================
-- Migration: 20260927113000_case_graph_hardening.sql
-- Module: PΛND0RΛ AI Graph Commit Hardening & Concurrency Protection
--
-- Ensures atomic, transactional commitment of AI-generated case graphs:
-- 1. Exclusively locks the case row (FOR UPDATE) to prevent concurrent writes.
-- 2. Validates ownership (_owner = _actor) and lifecycle status.
-- 3. Atomically commits entities, events, and relations with foreign key integrity.
-- 4. Records an immutable audit log entry in public.case_audit_log.
-- ==============================================================================

create or replace function public.commit_ai_case_graph(
  _case uuid,
  _actor uuid,
  _entities jsonb,
  _events jsonb,
  _relations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _owner uuid;
  _status text;
  _entity_count integer := 0;
  _event_count integer := 0;
  _relation_count integer := 0;
begin
  -- 1. Strict row-level lock on target case to prevent concurrent modifications
  select user_id, coalesce(status, 'draft')
    into _owner, _status
  from public.cases
  where id = _case
  for update;

  if _owner is null or _owner <> _actor then
    raise exception 'Case not found or access denied';
  end if;

  -- 2. Reject mutation if case is locked in legal hold, archived or closed
  if _status in ('closed', 'legal_hold', 'archived', 'destroyed') then
    raise exception 'Cannot commit graph: case % is in locked status %', _case, _status;
  end if;

  -- 3. Atomic insertion of entities
  if _entities is not null and jsonb_array_length(_entities) > 0 then
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

    _entity_count := jsonb_array_length(_entities);
  end if;

  -- 4. Atomic insertion of events
  if _events is not null and jsonb_array_length(_events) > 0 then
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

    _event_count := jsonb_array_length(_events);
  end if;

  -- 5. Atomic insertion of relations (foreign keys guarantee rollback if invalid)
  if _relations is not null and jsonb_array_length(_relations) > 0 then
    insert into public.case_relations (
      id, case_id, user_id, from_id, to_id, label
    )
    select
      (entry->>'id')::uuid,
      _case,
      _actor,
      (entry->>'from_id')::uuid,
      (entry->>'to_id')::uuid,
      entry->>'label'
    from jsonb_array_elements(_relations) as entry;

    _relation_count := jsonb_array_length(_relations);
  end if;

  -- 6. Immutable audit log entry
  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes
  ) values (
    _actor,
    _case,
    'ai_graph_committed',
    'case_graph',
    _case,
    jsonb_build_object(
      'entities', _entity_count,
      'events', _event_count,
      'relations', _relation_count
    )
  );

  return jsonb_build_object(
    'entities', _entity_count,
    'events', _event_count,
    'relations', _relation_count
  );
end;
$$;

revoke all on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
