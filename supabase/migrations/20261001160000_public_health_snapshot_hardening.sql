-- Additive hardening for the anonymous public health snapshot.
-- Keep the contract aggregate-only: no secrets, user IDs, prompt content,
-- raw errors or stack traces are ever returned by this function.
create or replace function public.public_health_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  started_at timestamptz := clock_timestamp();
  case_count_value integer;
  latency_ms_value integer;
begin
  select count(*)::int into case_count_value from public.cases;
  latency_ms_value := greatest(
    0,
    round(extract(epoch from (clock_timestamp() - started_at)) * 1000)::int
  );

  select jsonb_build_object(
    'case_count', case_count_value,
    'latency_ms', latency_ms_value,
    'total_connections', (select count(*)::int from pg_stat_activity),
    'max_connections', (select setting::int from pg_settings where name = 'max_connections'),
    'idle_in_transaction', (select count(*)::int from pg_stat_activity where state = 'idle in transaction'),
    'waiting_connections', (select count(*)::int from pg_stat_activity where wait_event_type = 'Lock'),
    'database_size_bytes', pg_database_size(current_database()),
    -- The full build string may contain deployment detail; expose only the
    -- version token needed by the existing status card.
    'postgres_version', split_part(current_setting('server_version'), ' ', 1),
    'ai_total', (select count(*)::int from public.ai_feature_logs where created_at >= now() - interval '24 hours'),
    'ai_failures', (select count(*)::int from public.ai_feature_logs where created_at >= now() - interval '24 hours' and success = false),
    'error_count', (select count(*)::int from public.error_logs where created_at >= now() - interval '24 hours')
  ) into result;

  return result;
end;
$$;
revoke all on function public.public_health_snapshot() from public;
grant execute on function public.public_health_snapshot() to anon;
grant execute on function public.public_health_snapshot() to authenticated;
grant execute on function public.public_health_snapshot() to service_role;
