-- Forward corrective migration: Database Source-of-Truth Reconciliation
-- Resolves remaining security vulnerabilities while normalizing RLS policies
-- and preventing duplicate application of Phase 2 catalog changes.

-- 1. has_role: Close arbitrary-user role oracle.
-- Ordinary authenticated users can only query their own role (auth.uid() = _user_id).
-- Administrators can query any user's role.
-- Internal/system callers (auth.uid() is null, e.g. triggers, service_role) can query any user.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id
      and role = _role
      and (
        (select auth.uid()) is null
        or (select auth.uid()) = _user_id
        or exists (
          select 1 from public.user_roles
          where user_id = (select auth.uid()) and role = 'admin'
        )
      )
  )
$$;

revoke all on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated, service_role;

-- 2. cross_border_analyses: Enforce case ownership.
-- Ensure authenticated users cannot insert, update, or read analyses for cases they do not own.
drop policy if exists "Users manage own cross border analyses" on public.cross_border_analyses;

create policy "Users manage own cross border analyses"
  on public.cross_border_analyses
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and case_id in (
      select id from public.cases where user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = user_id
    and case_id in (
      select id from public.cases where user_id = (select auth.uid())
    )
  );

-- 3. forensic_workflow_runs: Prevent initial state forgery.
-- Restrict direct authenticated inserts to genuine application initial state:
-- status must be 'queued', attempt_count must be 0, and server-managed fields must be null.
drop policy if exists "Users queue own forensic workflow runs" on public.forensic_workflow_runs;

create policy "Users queue own forensic workflow runs"
  on public.forensic_workflow_runs
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and case_id in (
      select id from public.cases where user_id = (select auth.uid())
    )
    and status = 'queued'
    and attempt_count = 0
    and workflow_run_id is null
    and started_at is null
    and completed_at is null
    and error_code is null
    and error_message is null
  );

drop policy if exists "Users read own forensic workflow runs" on public.forensic_workflow_runs;

create policy "Users read own forensic workflow runs"
  on public.forensic_workflow_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
  );

-- 4. Normalize redundant nested scalar subqueries (select (select auth.uid()))
-- Re-declare policies with canonical (select auth.uid()) and narrow evidence_items to authenticated.

-- user_roles
drop policy if exists "Users can read own roles" on public.user_roles;
create policy "Users can read own roles"
  on public.user_roles
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
  );

-- evidence_items
drop policy if exists "Investigators can view own evidence" on public.evidence_items;
create policy "Investigators can view own evidence"
  on public.evidence_items
  for select
  to authenticated
  using (
    (select auth.uid()) = investigator_id
  );

drop policy if exists "Investigators can insert evidence" on public.evidence_items;
create policy "Investigators can insert evidence"
  on public.evidence_items
  for insert
  to authenticated
  with check (
    (select auth.uid()) = investigator_id
  );

drop policy if exists "Allow update if no legal hold" on public.evidence_items;
create policy "Allow update if no legal hold"
  on public.evidence_items
  for update
  to authenticated
  using (
    (select auth.uid()) = investigator_id and legal_hold = false
  )
  with check (
    (select auth.uid()) = investigator_id and legal_hold = false
  );

drop policy if exists "Allow delete if no legal hold" on public.evidence_items;
create policy "Allow delete if no legal hold"
  on public.evidence_items
  for delete
  to authenticated
  using (
    (select auth.uid()) = investigator_id and legal_hold = false
  );

-- 5. billing_events: Re-affirm backend-only isolation.
-- Explicitly revoke privileges from public, anon, and authenticated so only service_role has access.
revoke all on public.billing_events from public, anon, authenticated;
grant all on public.billing_events to service_role;

