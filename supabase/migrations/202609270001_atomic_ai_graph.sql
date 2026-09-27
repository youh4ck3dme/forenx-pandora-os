alter table public.case_entities
  add column if not exists identity_key text;

create unique index if not exists case_entities_identity_key_unique
  on public.case_entities (case_id, identity_key)
  where identity_key is not null;

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
begin
  select user_id into _owner
  from public.cases
  where id = _case
  for update;

  if _owner is null or _owner <> _actor then
    raise exception 'Case not found or access denied';
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

  insert into public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes
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
    )
  );

  return jsonb_build_object(
    'entities', jsonb_array_length(_entities),
    'events', jsonb_array_length(_events),
    'relations', jsonb_array_length(_relations)
  );
end;
$$;

revoke all on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.commit_ai_case_graph(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
