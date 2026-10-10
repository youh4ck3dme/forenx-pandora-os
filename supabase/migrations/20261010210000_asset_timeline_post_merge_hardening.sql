-- Post-merge hardening for Asset Timeline Forensics.
-- Forward-only corrective migration: PR #61 was already merged, so migration
-- history is preserved even though the original migration is not deployed to production.

-- 1) Preserve append-only semantics while allowing the existing audited
-- destroy_case() lifecycle RPC to cascade-delete timeline rows.
create or replace function public.reject_asset_timeline_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE'
     and public.case_lifecycle_rpc_active('public.cases'::regclass) then
    return old;
  end if;
  raise exception 'forensic_asset_timeline_runs is append-only'
    using errcode = '42501';
end;
$$;

-- 2) Atomic execution claim. Exactly one caller owns a fresh/retried/stale run.
create or replace function public.claim_asset_timeline_workflow(
  _case_id uuid,
  _user_id uuid,
  _idempotency_key text,
  _lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.forensic_workflow_runs;
  _now timestamptz := now();
  _lease interval;
  _claimed boolean := false;
begin
  if _lease_seconds is null or _lease_seconds < 60 or _lease_seconds > 3600 then
    raise exception 'invalid asset timeline lease';
  end if;
  _lease := make_interval(secs => _lease_seconds);

  insert into public.forensic_workflow_runs (
    case_id, user_id, workflow_type, idempotency_key, status,
    attempt_count, started_at, completed_at, error_code, error_message
  )
  values (
    _case_id, _user_id, 'ASSET_TIMELINE_FORENSICS', _idempotency_key,
    'running', 1, _now, null, null, null
  )
  on conflict (case_id, workflow_type, idempotency_key) do nothing
  returning * into _row;

  if found then
    return jsonb_build_object(
      'claimed', true,
      'workflowId', _row.id,
      'status', _row.status,
      'attemptCount', _row.attempt_count,
      'startedAt', _row.started_at
    );
  end if;

  select *
    into _row
    from public.forensic_workflow_runs
   where case_id = _case_id
     and user_id = _user_id
     and workflow_type = 'ASSET_TIMELINE_FORENSICS'
     and idempotency_key = _idempotency_key
   for update;

  if not found then
    raise exception 'asset timeline workflow identity mismatch'
      using errcode = '42501';
  end if;

  if _row.status = 'completed' then
    return jsonb_build_object(
      'claimed', false,
      'workflowId', _row.id,
      'status', _row.status,
      'attemptCount', _row.attempt_count,
      'startedAt', _row.started_at
    );
  end if;

  if _row.status in ('queued', 'running')
     and _row.started_at is not null
     and _row.started_at >= (_now - _lease) then
    return jsonb_build_object(
      'claimed', false,
      'workflowId', _row.id,
      'status', _row.status,
      'attemptCount', _row.attempt_count,
      'startedAt', _row.started_at
    );
  end if;

  if _row.status in ('failed', 'cancelled', 'queued', 'running') then
    update public.forensic_workflow_runs
       set status = 'running',
           attempt_count = _row.attempt_count + 1,
           started_at = _now,
           completed_at = null,
           error_code = null,
           error_message = null
     where id = _row.id
       and case_id = _case_id
       and user_id = _user_id
       and workflow_type = 'ASSET_TIMELINE_FORENSICS'
       and idempotency_key = _idempotency_key
    returning * into _row;
    _claimed := true;
  end if;

  return jsonb_build_object(
    'claimed', _claimed,
    'workflowId', _row.id,
    'status', _row.status,
    'attemptCount', _row.attempt_count,
    'startedAt', _row.started_at
  );
end;
$$;

revoke all on function public.claim_asset_timeline_workflow(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_asset_timeline_workflow(uuid, uuid, text, integer)
  to service_role;

-- 3) Atomic terminal success: immutable result + workflow completion in one transaction.
create or replace function public.complete_asset_timeline_analysis(
  _workflow_id uuid,
  _case_id uuid,
  _user_id uuid,
  _idempotency_key text,
  _supersedes_run_id uuid,
  _input_sha256 text,
  _prompt_version text,
  _prompt_sha256 text,
  _provider text,
  _model text,
  _evidence_bindings jsonb,
  _result jsonb,
  _result_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _workflow public.forensic_workflow_runs;
  _run public.forensic_asset_timeline_runs;
begin
  select *
    into _workflow
    from public.forensic_workflow_runs
   where id = _workflow_id
     and case_id = _case_id
     and user_id = _user_id
     and workflow_type = 'ASSET_TIMELINE_FORENSICS'
     and idempotency_key = _idempotency_key
   for update;

  if not found then
    raise exception 'asset timeline workflow not found'
      using errcode = 'P0002';
  end if;

  if _workflow.status = 'completed' then
    select *
      into _run
      from public.forensic_asset_timeline_runs
     where case_id = _case_id
       and user_id = _user_id
       and idempotency_key = _idempotency_key;
    if not found then
      raise exception 'completed workflow has no immutable result';
    end if;
    return to_jsonb(_run);
  end if;

  if _workflow.status <> 'running' then
    raise exception 'asset timeline workflow is not execution-owned';
  end if;

  insert into public.forensic_asset_timeline_runs (
    case_id, user_id, workflow_metadata_id, status, idempotency_key,
    supersedes_run_id, input_sha256, prompt_version, prompt_sha256,
    provider, model, evidence_bindings, result, result_sha256
  )
  values (
    _case_id, _user_id, _workflow_id, 'COMPLETED', _idempotency_key,
    _supersedes_run_id, _input_sha256, _prompt_version, _prompt_sha256,
    _provider, _model, _evidence_bindings, _result, _result_sha256
  )
  on conflict (case_id, idempotency_key) do nothing
  returning * into _run;

  if not found then
    select *
      into _run
      from public.forensic_asset_timeline_runs
     where case_id = _case_id
       and user_id = _user_id
       and idempotency_key = _idempotency_key;
    if not found then
      raise exception 'asset timeline immutable result conflict could not be resolved';
    end if;
  end if;

  update public.forensic_workflow_runs
     set status = 'completed',
         completed_at = now(),
         error_code = null,
         error_message = null
   where id = _workflow_id
     and case_id = _case_id
     and user_id = _user_id
     and workflow_type = 'ASSET_TIMELINE_FORENSICS'
     and idempotency_key = _idempotency_key;

  if not found then
    raise exception 'asset timeline terminal workflow update failed';
  end if;

  return to_jsonb(_run);
end;
$$;

revoke all on function public.complete_asset_timeline_analysis(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.complete_asset_timeline_analysis(
  uuid, uuid, uuid, text, uuid, text, text, text, text, text, jsonb, jsonb, text
) to service_role;

-- 4) Checked terminal failure transition.
create or replace function public.fail_asset_timeline_workflow(
  _workflow_id uuid,
  _case_id uuid,
  _user_id uuid,
  _idempotency_key text,
  _error_code text,
  _error_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _workflow public.forensic_workflow_runs;
begin
  select *
    into _workflow
    from public.forensic_workflow_runs
   where id = _workflow_id
     and case_id = _case_id
     and user_id = _user_id
     and workflow_type = 'ASSET_TIMELINE_FORENSICS'
     and idempotency_key = _idempotency_key
   for update;

  if not found then
    raise exception 'asset timeline workflow not found'
      using errcode = 'P0002';
  end if;

  if _workflow.status = 'completed' then
    return false;
  end if;

  update public.forensic_workflow_runs
     set status = 'failed',
         completed_at = now(),
         error_code = left(coalesce(_error_code, 'ASSET_TIMELINE_FAILED'), 120),
         error_message = left(coalesce(_error_message, 'Asset timeline analysis failed'), 500)
   where id = _workflow_id
     and case_id = _case_id
     and user_id = _user_id
     and workflow_type = 'ASSET_TIMELINE_FORENSICS'
     and idempotency_key = _idempotency_key;

  return found;
end;
$$;

revoke all on function public.fail_asset_timeline_workflow(
  uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.fail_asset_timeline_workflow(
  uuid, uuid, uuid, text, text, text
) to service_role;
