-- Asset timeline forensic reports are immutable, server-authored projections.
alter table public.forensic_workflow_runs drop constraint if exists forensic_workflow_runs_workflow_type_check;
alter table public.forensic_workflow_runs add constraint forensic_workflow_runs_workflow_type_check check (workflow_type in (
  'FORENSIC_CASE_ANALYSIS','DOCUMENT_ANALYSIS','BULK_IMPORT','EVIDENCE_VALIDATION','DOSSIER_GENERATION','REPORT_EXPORT','ASSET_TIMELINE_FORENSICS'
));

create table public.forensic_asset_timeline_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  user_id uuid not null,
  workflow_metadata_id uuid references public.forensic_workflow_runs(id),
  analysis_type text not null default 'ASSET_TIMELINE_FORENSICS' check (analysis_type = 'ASSET_TIMELINE_FORENSICS'),
  status text not null check (status in ('COMPLETED','FAILED')),
  idempotency_key text not null,
  supersedes_run_id uuid references public.forensic_asset_timeline_runs(id),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  prompt_version text not null,
  prompt_sha256 text not null check (prompt_sha256 ~ '^[0-9a-f]{64}$'),
  provider text not null,
  model text not null,
  evidence_bindings jsonb not null,
  result jsonb not null,
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (case_id, idempotency_key)
);
alter table public.forensic_asset_timeline_runs enable row level security;
create policy "Users read own asset timeline runs" on public.forensic_asset_timeline_runs for select to authenticated using (auth.uid() = user_id and exists (select 1 from public.cases c where c.id = case_id and c.user_id = auth.uid()));
revoke all on public.forensic_asset_timeline_runs from anon, authenticated;
grant select on public.forensic_asset_timeline_runs to authenticated;
grant all on public.forensic_asset_timeline_runs to service_role;
create or replace function public.reject_asset_timeline_mutation() returns trigger language plpgsql as $$ begin raise exception 'forensic_asset_timeline_runs is append-only'; end; $$;
create trigger forensic_asset_timeline_no_update before update on public.forensic_asset_timeline_runs for each row execute function public.reject_asset_timeline_mutation();
create trigger forensic_asset_timeline_no_delete before delete on public.forensic_asset_timeline_runs for each row execute function public.reject_asset_timeline_mutation();
create or replace function public.audit_asset_timeline_run() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes) values (new.user_id, new.case_id, 'forensic_asset_timeline_run.created', 'forensic_asset_timeline_runs', new.id, jsonb_build_object('workflow_metadata_id', new.workflow_metadata_id, 'analysis_type', new.analysis_type, 'result_sha256', new.result_sha256, 'prompt_version', new.prompt_version, 'provider', new.provider, 'model', new.model, 'supersedes_run_id', new.supersedes_run_id)); return new; end; $$;
create trigger forensic_asset_timeline_audit after insert on public.forensic_asset_timeline_runs for each row execute function public.audit_asset_timeline_run();
