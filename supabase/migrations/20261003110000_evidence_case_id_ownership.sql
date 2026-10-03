-- Security fix: enforce case_id ownership on evidence_items INSERT.
--
-- Problem: FK on case_id only validates that the case EXISTS. A malicious client
-- using PostgREST can supply a foreign investigator's case_id — RLS only checks
-- auth.uid() = investigator_id, not that the case belongs to the same user.
--
-- Fix: extend evidence_items_insert_guard to reject any non-NULL case_id that does
-- not belong to the inserting user (cases.user_id <> auth.uid()).
-- Service roles bypass this check (they set case_id server-side after ownership
-- is already verified in application logic).
-- Legacy NULL case_id rows are unaffected.
--
-- Additive, idempotent (CREATE OR REPLACE + DROP/CREATE TRIGGER). No DROP TABLE.

create or replace function public.evidence_items_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Normalize and validate SHA-256 hash.
  new.sha256_hash := lower(btrim(new.sha256_hash));
  if new.sha256_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sha256_hash must be 64 hex characters' using errcode = '23514';
  end if;

  new.created_at := now();

  -- Clients cannot self-certify verification or self-impose legal hold.
  if not (current_user in ('postgres', 'service_role', 'supabase_admin')) then
    new.legal_hold := false;
    new.hash_verification_status := 'pending';
    new.hash_verified_at := null;
    new.verified_sha256 := null;
    new.verified_size := null;
    new.verification_error := null;

    -- Cross-tenant ownership check: when case_id is supplied, the case must
    -- belong to the authenticated user. Prevents PostgREST cross-tenant spoof
    -- where FK existence (case exists) differs from FK ownership (case is mine).
    -- Uses current_setting directly (same as auth.uid()) to avoid schema permission
    -- issues when the trigger runs as the caller role.
    if new.case_id is not null then
      if not exists (
        select 1 from public.cases
         where id = new.case_id
           and user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      ) then
        raise exception 'case_id does not belong to the authenticated user'
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists evidence_items_insert_guard on public.evidence_items;
create trigger evidence_items_insert_guard
before insert on public.evidence_items
for each row execute function public.evidence_items_insert_guard();
