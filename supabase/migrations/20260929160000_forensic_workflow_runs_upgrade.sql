-- Forward upgrade for forensic_workflow_runs.
-- Handles the case where the table was created by an earlier version of
-- 20260929150000 that lacked user_id and used 'pending' instead of 'queued'.
-- Safe to run on both the old schema and the current schema (all ops are idempotent).

-- 1. Add user_id if the column is missing (old migration omitted it).
alter table public.forensic_workflow_runs
  add column if not exists user_id uuid;

-- Backfill user_id from the owning case where possible.
update public.forensic_workflow_runs fwr
set user_id = c.user_id
from public.cases c
where fwr.case_id = c.id
  and fwr.user_id is null;

-- 2. Drop the old status check constraint (which may use 'pending' not 'queued')
--    and replace it with the correct set.
alter table public.forensic_workflow_runs
  drop constraint if exists forensic_workflow_runs_status_check;

alter table public.forensic_workflow_runs
  add constraint forensic_workflow_runs_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'));

-- 3. Rename any rows that used the old 'pending' status to 'queued'.
update public.forensic_workflow_runs
set status = 'queued'
where status = 'pending';

-- 4. Fix INSERT RLS policy to enforce case ownership in addition to user identity.
--    A user must not be able to queue a workflow run for a case they do not own.
drop policy if exists "Users queue own forensic workflow runs" on public.forensic_workflow_runs;

create policy "Users queue own forensic workflow runs"
  on public.forensic_workflow_runs
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and case_id in (
      select id from public.cases where user_id = auth.uid()
    )
  );

-- 5. Add case_id index if not already present (idempotent).
create index if not exists forensic_workflow_runs_case_created_idx
  on public.forensic_workflow_runs (case_id, created_at desc);
