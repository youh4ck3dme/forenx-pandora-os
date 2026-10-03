-- Migration: 20261003120000_forenzx_dispatch_outbox
-- Purpose: Replace the pg_net verified-trigger dispatch, which swallowed dispatch failures, with a durable outbox.
--          The trigger only INSERTs a row in the same transaction as the
--          evidence update. A worker posts the webhook and records failures.
--          A failed HTTP call must leave the row and last_error behind.

create table if not exists public.forenzx_dispatch_outbox (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null,
  case_id uuid,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forenzx_dispatch_outbox_due_idx
  on public.forenzx_dispatch_outbox (next_attempt_at, created_at)
  where status = 'pending';

create unique index if not exists forenzx_dispatch_outbox_one_pending_idx
  on public.forenzx_dispatch_outbox (evidence_id)
  where status = 'pending';

alter table public.forenzx_dispatch_outbox enable row level security;

revoke all on public.forenzx_dispatch_outbox from public, anon, authenticated;
grant all on public.forenzx_dispatch_outbox to service_role;

create or replace function public.touch_forenzx_dispatch_outbox_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forenzx_dispatch_outbox_updated_at on public.forenzx_dispatch_outbox;
create trigger forenzx_dispatch_outbox_updated_at
before update on public.forenzx_dispatch_outbox
for each row execute function public.touch_forenzx_dispatch_outbox_updated_at();

revoke all on function public.touch_forenzx_dispatch_outbox_updated_at() from public, anon, authenticated;

-- Verified transition enqueues work. No pg_net call and no swallowed exception.
-- ON CONFLICT DO NOTHING keeps a second verify from aborting while one row is pending.
create or replace function public._forenzx_notify_on_evidence_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _payload jsonb;
begin
  if (
    (old.hash_verification_status is distinct from new.hash_verification_status)
    and new.hash_verification_status = 'verified'
  ) then
    _payload := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'evidence_items',
      'schema', 'public',
      'evidenceId', new.id,
      'record', row_to_json(new)::jsonb,
      'old_record', row_to_json(old)::jsonb
    );

    insert into public.forenzx_dispatch_outbox (evidence_id, case_id, payload, status)
    values (new.id, new.case_id, _payload, 'pending')
    on conflict (evidence_id) where status = 'pending' do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public._forenzx_notify_on_evidence_verified() from public, anon, authenticated;

comment on function public._forenzx_notify_on_evidence_verified() is
  'Enqueues forenzx_dispatch_outbox when hash_verification_status transitions to verified. Does not call pg_net and does not swallow errors.';

comment on table public.forenzx_dispatch_outbox is
  'Durable ForenZX webhook dispatch queue. Worker: POST /api/forenzx/dispatch-outbox.';
