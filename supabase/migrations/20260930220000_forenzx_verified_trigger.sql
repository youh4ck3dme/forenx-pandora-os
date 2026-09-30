-- Migration: 20260930220000_forenzx_verified_trigger
-- Purpose : Fires the forenzx-evidence-webhook Edge Function whenever
--           evidence_items.hash_verification_status transitions to 'verified'.
-- Requires: pg_net extension (available in all Supabase projects by default)
-- Security: function runs as SECURITY DEFINER; HTTP call is outbound-only
-- Idempotency: CREATE OR REPLACE + DROP TRIGGER IF EXISTS

-- 1. Enable pg_net
create extension if not exists pg_net with schema extensions;

-- 2. Helper trigger function (reads URL + secret from postgres app settings)
create or replace function private.notify_forenzx_on_evidence_verified()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
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

    perform extensions.http_post(
      url     := _edge_url,
      headers := jsonb_build_object(
        'Content-Type',     'application/json',
        'x-webhook-secret', coalesce(_secret, '')
      ),
      body    := _payload::text
    );
  end if;

  return new;
end;
$$;

revoke all on function private.notify_forenzx_on_evidence_verified() from public;

-- 3. Attach trigger (column-level: only fires on hash_verification_status UPDATE)
drop trigger if exists tr_evidence_verified_forenzx on public.evidence_items;

create trigger tr_evidence_verified_forenzx
  after update of hash_verification_status
  on public.evidence_items
  for each row
  execute function private.notify_forenzx_on_evidence_verified();

comment on trigger tr_evidence_verified_forenzx on public.evidence_items is
  'Fires forenzx-evidence-webhook Edge Function when hash_verification_status becomes verified.';
