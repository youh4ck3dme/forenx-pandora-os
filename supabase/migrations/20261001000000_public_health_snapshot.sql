-- Verejný read-only health snapshot.
-- Vracia iba agregované prevádzkové metriky; nikdy nie secrets, log messages,
-- prompt content, user IDs alebo stack traces.
CREATE OR REPLACE FUNCTION public.public_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  started_at timestamptz := clock_timestamp();
  case_count_value integer;
  latency_ms_value integer;
BEGIN
  SELECT count(*)::int INTO case_count_value FROM public.cases;
  latency_ms_value := GREATEST(
    0,
    ROUND(EXTRACT(EPOCH FROM (clock_timestamp() - started_at)) * 1000)::int
  );

  SELECT jsonb_build_object(
    'case_count', case_count_value,
    'latency_ms', latency_ms_value,
    'total_connections', (SELECT count(*)::int FROM pg_stat_activity),
    'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'idle_in_transaction', (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction'),
    'waiting_connections', (SELECT count(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock'),
    'database_size_bytes', pg_database_size(current_database()),
    'postgres_version', current_setting('server_version'),
    'ai_total', (SELECT count(*)::int FROM public.ai_feature_logs WHERE created_at >= now() - interval '24 hours'),
    'ai_failures', (SELECT count(*)::int FROM public.ai_feature_logs WHERE created_at >= now() - interval '24 hours' AND success = false),
    'error_count', (SELECT count(*)::int FROM public.error_logs WHERE created_at >= now() - interval '24 hours')
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.public_health_snapshot() FROM public;
GRANT EXECUTE ON FUNCTION public.public_health_snapshot() TO anon;
GRANT EXECUTE ON FUNCTION public.public_health_snapshot() TO authenticated;
GRANT EXECUTE ON FUNCTION public.public_health_snapshot() TO service_role;
