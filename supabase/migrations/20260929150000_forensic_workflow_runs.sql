-- Durable, case-bound metadata for Workflow SDK runs. The workflow runtime is
-- authoritative for execution; this table is the forensic/audit projection.
create table if not exists public.forensic_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null,
  workflow_type text not null check (workflow_type in (
    'FORENSIC_CASE_ANALYSIS',
    'DOCUMENT_ANALYSIS',
    'BULK_IMPORT',
    'EVIDENCE_VALIDATION',
    'DOSSIER_GENERATION',
    'REPORT_EXPORT'
  )),
  workflow_run_id text unique,
  idempotency_key text not null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint generated always as (
    case when completed_at is not null then greatest(0, floor(extract(epoch from (completed_at - created_at)) * 1000))::bigint end
  ) stored,
  unique (case_id, workflow_type, idempotency_key)
);
create index if not exists forensic_workflow_runs_case_created_idx on public.forensic_workflow_runs (case_id, created_at desc);
alter table public.forensic_workflow_runs enable row level security;
create policy "Users read own forensic workflow runs" on public.forensic_workflow_runs for select to authenticated using (auth.uid() = user_id);
create policy "Users queue own forensic workflow runs" on public.forensic_workflow_runs for insert to authenticated with check (auth.uid() = user_id);
revoke all on public.forensic_workflow_runs from anon, authenticated;
grant select on public.forensic_workflow_runs to authenticated;
grant insert on public.forensic_workflow_runs to authenticated;
grant all on public.forensic_workflow_runs to service_role;

create or replace function public.audit_forensic_workflow_run()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    new.user_id, new.case_id,
    case when tg_op = 'INSERT' then 'forensic_workflow_run.created' else 'forensic_workflow_run.status_changed' end,
    'forensic_workflow_runs', new.id,
    jsonb_build_object('workflow_type', new.workflow_type, 'workflow_run_id', new.workflow_run_id, 'status', new.status, 'attempt_count', new.attempt_count, 'error_code', new.error_code)
  );
  return new;
end;
$$;
drop trigger if exists forensic_workflow_runs_audit on public.forensic_workflow_runs;
create trigger forensic_workflow_runs_audit after insert or update on public.forensic_workflow_runs
for each row execute function public.audit_forensic_workflow_run();
