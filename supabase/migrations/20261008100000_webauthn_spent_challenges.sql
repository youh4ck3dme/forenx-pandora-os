-- ==============================================================================
-- WebAuthn single-use challenges
-- Each passkey challenge is recorded once, keyed by a SHA-256 of its kind and
-- value, and kept until the challenge itself expires (issuedAt + TTL). A
-- fixed-window counter (rate_limit_hit) cannot do this: a challenge first used
-- just before a window boundary could be replayed just after it while its
-- cookie is still valid.
--
-- Only service_role may call webauthn_consume_challenge(); the table has RLS
-- enabled and no policies, so anon/authenticated cannot read or write it.
-- ==============================================================================

create table if not exists public.webauthn_spent_challenges (
  challenge_key text primary key check (challenge_key ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null
);

alter table public.webauthn_spent_challenges enable row level security;
revoke all on table public.webauthn_spent_challenges from anon, authenticated;

create index if not exists webauthn_spent_challenges_expires_idx
  on public.webauthn_spent_challenges (expires_at);

create or replace function public.webauthn_consume_challenge(
  _challenge_key text,
  _expires_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _inserted integer;
begin
  if _challenge_key is null or _challenge_key !~ '^[a-f0-9]{64}$' or _expires_at is null then
    raise exception 'invalid challenge parameters' using errcode = '22023';
  end if;

  -- Opportunistic cleanup: an expired challenge can no longer be presented.
  if random() < 0.05 then
    delete from public.webauthn_spent_challenges where expires_at < now();
  end if;

  insert into public.webauthn_spent_challenges (challenge_key, expires_at)
  values (_challenge_key, _expires_at)
  on conflict (challenge_key) do nothing;

  get diagnostics _inserted = row_count;
  return _inserted = 1;
end;
$$;

revoke all on function public.webauthn_consume_challenge(text, timestamptz) from public;
revoke all on function public.webauthn_consume_challenge(text, timestamptz) from anon, authenticated;
grant execute on function public.webauthn_consume_challenge(text, timestamptz) to service_role;
