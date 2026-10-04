-- ForenZX MCP job projection.
-- The Edge Function writes these rows after the Hub accepts an analysis job.
-- Browser clients can only read their own rows; the Hub API key never leaves
-- the Edge Function/Next.js server.
create table if not exists public.forenzx_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  evidence_id uuid not null references public.evidence_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hub_job_id text unique,
  pack_id text not null,
  input_type text not null,
  idempotency_key text not null,
  status text not null check (status in ('starting', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evidence_id, pack_id, idempotency_key)
);

create index if not exists forenzx_analysis_jobs_case_created_idx
  on public.forenzx_analysis_jobs (case_id, created_at desc);

alter table public.forenzx_analysis_jobs enable row level security;

drop policy if exists "Users read own ForenZX jobs" on public.forenzx_analysis_jobs;
create policy "Users read own ForenZX jobs"
  on public.forenzx_analysis_jobs
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.forenzx_analysis_jobs from anon, authenticated;
grant select on public.forenzx_analysis_jobs to authenticated;
grant all on public.forenzx_analysis_jobs to service_role;

create or replace function public.touch_forenzx_analysis_jobs_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists forenzx_analysis_jobs_updated_at on public.forenzx_analysis_jobs;
create trigger forenzx_analysis_jobs_updated_at
before update on public.forenzx_analysis_jobs
for each row execute function public.touch_forenzx_analysis_jobs_updated_at();
