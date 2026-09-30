-- Migration: 20260930220000_forenzx_verified_trigger (v3 - resilient schema & header)
-- Purpose : Fires the forenzx-evidence-webhook Edge Function whenever
--           evidence_items.hash_verification_status transitions to 'verified'.
-- Safe execution: conditionally enables pg_net; checks function existence;
--                 sends x-forenzx-webhook-secret.

-- 1. Enable pg_net if available in the PostgreSQL environment
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
exception when others then
  null;
end;
$$;

-- 2. Helper function in public schema
create or replace function public._forenzx_notify_on_evidence_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
  _edge_url  text;
  _secret    text;
  _payload   jsonb;
begin
  -- Only fire when hash_verification_status changes TO 'verified'
  if (
    (old.hash_verification_status is distinct from new.hash_verification_status)
    and new.hash_verification_status = 'verified'
  ) then
    _edge_url := current_setting('app.forenzx_webhook_url', true);
    _secret   := current_setting('app.forenzx_webhook_secret', true);

    if _edge_url is null or _edge_url = '' then
      _edge_url := format(
        'https://%s.supabase.co/functions/v1/forenzx-evidence-webhook',
        current_setting('app.supabase_project_ref', true)
      );
    end if;

    _payload := jsonb_build_object(
      'type',       'UPDATE',
      'table',      'evidence_items',
      'schema',     'public',
      'record',     row_to_json(new)::jsonb,
      'old_record', row_to_json(old)::jsonb
    );

    -- Outbound HTTP dispatch via pg_net (supports extensions or net schema)
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on p.pronamespace = n.oid
      where n.nspname in ('extensions', 'net') and p.proname = 'http_post'
    ) then
      begin
        perform extensions.http_post(
          url     := _edge_url,
          headers := jsonb_build_object(
            'Content-Type',              'application/json',
            'x-forenzx-webhook-secret',  coalesce(_secret, '')
          ),
          body    := _payload::text
        );
      exception when undefined_function then
        begin
          perform net.http_post(
            url     := _edge_url,
            headers := jsonb_build_object(
              'Content-Type',              'application/json',
              'x-forenzx-webhook-secret',  coalesce(_secret, '')
            ),
            body    := _payload
          );
        exception when others then
          null;
        end;
      when others then
        null;
      end;
    end if;
  end if;

  return new;
end;
$$;

-- Restrict access: only trigger context can execute (not anon/authenticated roles)
revoke all on function public._forenzx_notify_on_evidence_verified() from public, anon, authenticated;

-- 3. Attach trigger
drop trigger if exists tr_evidence_verified_forenzx on public.evidence_items;

create trigger tr_evidence_verified_forenzx
  after update of hash_verification_status
  on public.evidence_items
  for each row
  execute function public._forenzx_notify_on_evidence_verified();

comment on trigger tr_evidence_verified_forenzx on public.evidence_items is
  'Fires forenzx-evidence-webhook Edge Function when hash_verification_status transitions to verified.';
