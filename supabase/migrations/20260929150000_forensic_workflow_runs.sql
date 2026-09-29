-- forensic_workflow_runs: durable run records for long-running AI forensic workflows
-- Supports idempotency, retry tracking, and per-case audit trail

create table if not exists public.forensic_workflow_runs (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references public.cases(id) on delete cascade,
  workflow_type     text not null,
  workflow_run_id   text,
  idempotency_key   text not null,
  status            text not null default 'pending'
                      check (status in ('pending','running','completed','failed','cancelled')),
  attempt_count     integer not null default 0,
  started_at        timestamptz,
  completed_at      timestamptz,
  error_code        text,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- computed duration in ms (null until completed/failed)
  duration_ms       integer generated always as (
    case when completed_at is not null and started_at is not null
      then extract(epoch from (completed_at - started_at))::integer * 1000
    end
  ) stored
);

-- prevent duplicate workflow runs for the same case+type+idempotency key
create unique index if not exists forensic_workflow_runs_idempotency
  on public.forensic_workflow_runs (case_id, workflow_type, idempotency_key);

create index if not exists forensic_workflow_runs_case_id_idx
  on public.forensic_workflow_runs (case_id);

create index if not exists forensic_workflow_runs_status_idx
  on public.forensic_workflow_runs (status);

-- updated_at trigger
create or replace function public.set_forensic_workflow_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forensic_workflow_runs_updated_at on public.forensic_workflow_runs;
create trigger forensic_workflow_runs_updated_at
  before update on public.forensic_workflow_runs
  for each row execute function public.set_forensic_workflow_updated_at();

-- RLS
alter table public.forensic_workflow_runs enable row level security;

-- authenticated users can read and insert their own case workflow runs
create policy "users_read_own_forensic_runs" on public.forensic_workflow_runs
  for select to authenticated
  using (
    case_id in (
      select id from public.cases where user_id = auth.uid()
    )
  );

create policy "users_insert_own_forensic_runs" on public.forensic_workflow_runs
  for insert to authenticated
  with check (
    case_id in (
      select id from public.cases where user_id = auth.uid()
    )
  );

create policy "users_update_own_forensic_runs" on public.forensic_workflow_runs
  for update to authenticated
  using (
    case_id in (
      select id from public.cases where user_id = auth.uid()
    )
  );

-- service_role bypass for background workers
create policy "service_role_full_access" on public.forensic_workflow_runs
  to service_role using (true) with check (true);
