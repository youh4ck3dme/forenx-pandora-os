-- Migration: 20260930230000_forenzx_trigger_header_fix
-- Fix: SQL trigger sends 'x-forenzx-webhook-secret' matching Edge Function auth check.
-- Safe execution: conditionally checks function existence before dispatch.

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
  -- Only fire when hash_verification_status transitions TO 'verified'
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

-- Restrict access: only trigger context can execute
revoke all on function public._forenzx_notify_on_evidence_verified() from public, anon, authenticated;

comment on function public._forenzx_notify_on_evidence_verified() is
  'v2: Fixed header name from x-webhook-secret → x-forenzx-webhook-secret to match Edge Function auth check.';
