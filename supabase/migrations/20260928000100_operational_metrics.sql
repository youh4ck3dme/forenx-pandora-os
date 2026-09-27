-- P0-04: operational metrics and alert thresholds (admin-only).
--
-- health_metrics() aggregates the last 24 hours from existing tables
-- (ai_usage, evidence_items, error_logs) and evaluates the alert thresholds
-- from the backlog:
--   * AI timeout over 60 seconds (any occurrence in the window),
--   * S3 upload/verification failure above 1 %,
--   * Supabase failures (10+ error_logs entries in the window).

create or replace function public.health_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _ai_total bigint;
  _ai_failed bigint;
  _ai_timeouts bigint;
  _s3_uploads bigint;
  _s3_failed bigint;
  _db_errors bigint;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Prístup majú iba administrátori.' using errcode = '42501';
  end if;

  select
    count(*),
    count(*) filter (where status = 'failed'),
    count(*) filter (
      where error_code = 'timeout'
         or (finished_at is not null and finished_at - created_at > interval '60 seconds')
    )
    into _ai_total, _ai_failed, _ai_timeouts
  from public.ai_usage
  where created_at > now() - interval '24 hours';

  select
    count(*),
    count(*) filter (
      where hash_verification_status in ('mismatch', 'object_missing', 'error')
    )
    into _s3_uploads, _s3_failed
  from public.evidence_items
  where created_at > now() - interval '24 hours';

  select count(*) into _db_errors
  from public.error_logs
  where created_at > now() - interval '24 hours';

  return jsonb_build_object(
    'window_hours', 24,
    'generated_at', now(),
    'ai', jsonb_build_object(
      'total', _ai_total,
      'failed', _ai_failed,
      'timeouts_over_60s', _ai_timeouts,
      'failure_rate_percent', case when _ai_total > 0
        then round(_ai_failed::numeric * 100 / _ai_total, 2) else 0 end
    ),
    's3', jsonb_build_object(
      'uploads', _s3_uploads,
      'failed', _s3_failed,
      'failure_rate_percent', case when _s3_uploads > 0
        then round(_s3_failed::numeric * 100 / _s3_uploads, 2) else 0 end
    ),
    'supabase', jsonb_build_object(
      'errors_24h', _db_errors
    ),
    'alerts', jsonb_build_object(
      'ai_timeouts_over_60s', _ai_timeouts > 0,
      's3_failure_rate_over_1pct',
        _s3_uploads > 0 and (_s3_failed::numeric * 100 / _s3_uploads) > 1,
      'supabase_errors_high', _db_errors >= 10
    )
  );
end;
$$;

revoke all on function public.health_metrics() from public;
grant execute on function public.health_metrics() to authenticated, service_role;
