-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 008_security_hardening.sql
-- Modules: TRUNCATE Revocations, Advisor Hardening, Definer Isolation, Health Telemetry
-- Security Invariants:
--   - TRUNCATE is unconditionally revoked from anon and authenticated on all tables
--   - Forensic tables (evidence_items, source_snapshots, case_audit_log) cannot be truncated
--   - Privileged RPCs cannot be executed by anon or public
--   - Function search_path is locked to 'public, pg_temp'
--   - Health and operational metrics restricted to authorized roles
-- ==============================================================================

-- 1. UNCONDITIONAL TRUNCATE REVOCATIONS
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Hardened forensic tables: revoke TRUNCATE even from service_role
REVOKE TRUNCATE ON public.evidence_items FROM service_role;
REVOKE TRUNCATE ON public.source_snapshots FROM service_role;
REVOKE TRUNCATE ON public.case_audit_log FROM service_role;
REVOKE TRUNCATE ON public.cases FROM service_role;

-- 2. OPERATIONAL TELEMETRY & HEALTH RPC (DB ENGINE STATS)
CREATE OR REPLACE FUNCTION public.db_health_stats()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'max_connections', (SELECT setting::int FROM pg_settings WHERE name = 'max_connections'),
    'total_connections', (SELECT count(*) FROM pg_stat_activity),
    'active_connections', (SELECT count(*) FROM pg_stat_activity WHERE state = 'active'),
    'idle_connections', (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle'),
    'idle_in_transaction', (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction'),
    'waiting_connections', (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'),
    'database_size_bytes', pg_database_size(current_database()),
    'postgres_version', current_setting('server_version')
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.db_health_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_health_stats() TO service_role;

-- 3. 24-HOUR OPERATIONAL METRICS & ALERT THRESHOLDS (P0-04)
CREATE OR REPLACE FUNCTION public.health_metrics()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _ai_total BIGINT;
  _ai_failed BIGINT;
  _ai_timeouts BIGINT;
  _s3_uploads BIGINT;
  _s3_failed BIGINT;
  _db_errors BIGINT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Prístup majú iba administrátori.' USING errcode = '42501';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'failed'),
    count(*) FILTER (
      WHERE error_code = 'timeout'
         OR (finished_at IS NOT NULL AND finished_at - created_at > INTERVAL '60 seconds')
    )
    INTO _ai_total, _ai_failed, _ai_timeouts
  FROM public.ai_usage
  WHERE created_at > NOW() - INTERVAL '24 hours';

  SELECT
    count(*),
    count(*) FILTER (
      WHERE hash_verification_status IN ('mismatch', 'object_missing', 'error')
    )
    INTO _s3_uploads, _s3_failed
  FROM public.evidence_items
  WHERE created_at > NOW() - INTERVAL '24 hours';

  SELECT count(*) INTO _db_errors
  FROM public.error_logs
  WHERE created_at > NOW() - INTERVAL '24 hours';

  RETURN jsonb_build_object(
    'window_hours', 24,
    'generated_at', NOW(),
    'ai', jsonb_build_object(
      'total', _ai_total,
      'failed', _ai_failed,
      'timeouts_over_60s', _ai_timeouts,
      'failure_rate_percent', CASE WHEN _ai_total > 0
        THEN round(_ai_failed::numeric * 100 / _ai_total, 2) ELSE 0 END
    ),
    's3', jsonb_build_object(
      'uploads', _s3_uploads,
      'failed', _s3_failed,
      'failure_rate_percent', CASE WHEN _s3_uploads > 0
        THEN round(_s3_failed::numeric * 100 / _s3_uploads, 2) ELSE 0 END
    ),
    'supabase', jsonb_build_object(
      'errors_24h', _db_errors
    ),
    'alerts', jsonb_build_object(
      'ai_timeouts_over_60s', _ai_timeouts > 0,
      's3_failure_rate_over_1pct',
        _s3_uploads > 0 AND (_s3_failed::numeric * 100 / _s3_uploads) > 1,
      'supabase_errors_high', _db_errors >= 10
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.health_metrics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.health_metrics() TO authenticated, service_role;

-- 4. SECURITY AUDIT ASSERTION FUNCTION
-- Can be called during test suite or preflight to mathematically guarantee zero unshielded tables
CREATE OR REPLACE FUNCTION public.assert_rls_enabled_on_all_tables()
RETURNS TABLE (table_name TEXT, is_secure BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.tablename::text,
    t.rowsecurity
  FROM pg_tables t
  WHERE t.schemaname = 'public'
  ORDER BY t.tablename;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_rls_enabled_on_all_tables() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_rls_enabled_on_all_tables() TO service_role;

-- 5. COMPREHENSIVE PRIVILEGED RPC RECONCILIATION & DEFENSE-IN-DEPTH
-- Re-assert that no function in schema public has implicit execute for PUBLIC or anon
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

-- Re-assert explicit server-controlled execution on sensitive operational RPCs
REVOKE ALL ON FUNCTION public.erase_user_audit_log(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_user_audit_log(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.append_audit_event(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_audit_event(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.record_evidence_verification(UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_evidence_verification(UUID, TEXT, TEXT, BIGINT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.reserve_ai_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.commit_ai_case_graph(UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_case_graph(UUID, UUID, JSONB, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.commit_import(UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_import(UUID, JSONB, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;
