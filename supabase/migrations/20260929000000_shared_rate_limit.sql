-- P0-09 (N-04): shared rate limiting for serverless API routes.
--
-- The in-process Map limiters only counted requests that happened to hit the
-- same warm instance, so spreading requests across instances bypassed them.
-- This counter lives in Postgres and is shared by every instance.
--
-- * Fixed window per (bucket, key_hash, window_start); one atomic upsert per hit.
-- * key_hash is a SHA-256 computed by the app, so raw IP addresses and user
--   ids are not stored (GDPR data minimisation).
-- * Only service_role may call rate_limit_hit(); the table has RLS enabled and
--   no policies, so anon/authenticated cannot read or write it.

create table if not exists public.rate_limit_counters (
  bucket text not null check (length(bucket) between 1 and 64),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (bucket, key_hash, window_start)
);

alter table public.rate_limit_counters enable row level security;
revoke all on table public.rate_limit_counters from anon, authenticated;

create index if not exists rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

create or replace function public.rate_limit_hit(
  _bucket text,
  _key_hash text,
  _limit integer,
  _window_seconds integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _window timestamptz;
  _hits integer;
begin
  if _bucket is null or length(_bucket) not between 1 and 64
     or _key_hash is null or _key_hash !~ '^[a-f0-9]{64}$'
     or _limit is null or _limit < 1
     or _window_seconds is null or _window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  _window := to_timestamp(
    floor(extract(epoch from now()) / _window_seconds) * _window_seconds
  );

  insert into public.rate_limit_counters as c (bucket, key_hash, window_start, hits)
  values (_bucket, _key_hash, _window, 1)
  on conflict (bucket, key_hash, window_start)
  do update set hits = c.hits + 1
  returning c.hits into _hits;

  -- Opportunistic cleanup of expired windows (bounded, ~1 % of calls).
  if random() < 0.01 then
    delete from public.rate_limit_counters
     where window_start < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'allowed', _hits <= _limit,
    'remaining', greatest(_limit - _hits, 0),
    'reset_at', _window + make_interval(secs => _window_seconds)
  );
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, integer) from public;
revoke all on function public.rate_limit_hit(text, text, integer, integer) from anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;
