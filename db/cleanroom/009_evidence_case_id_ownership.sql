-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE FORWARD MIGRATION
-- File: 009_evidence_case_id_ownership.sql
-- Modules: evidence_items INSERT ownership guard
-- Security Invariants:
--   - A non-NULL evidence_items.case_id inserted by an untrusted role must
--     reference a case owned by the caller (cases.user_id = JWT sub)
--   - NULL case_id (legacy rows) remains allowed
--   - Trusted server roles (postgres, service_role, supabase_admin) are exempt;
--     they set case_id after ownership is verified in application logic
-- Mirrors live migration supabase/migrations/20261003110000_evidence_case_id_ownership.sql
-- so the cleanroom baseline and the live schema share the same ownership invariant.
-- Forward-only: Baseline V1 (001..008) stays frozen; this replaces the insert
-- guard function from 003_forensic_evidence.sql with a superset of its logic.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.evidence_items_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.sha256_hash := LOWER(BTRIM(NEW.sha256_hash));
  IF NEW.sha256_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sha256_hash must be exactly 64 hexadecimal characters' USING errcode = '23514';
  END IF;

  NEW.created_at := NOW();
  NEW.updated_at := NOW();

  -- Clients cannot self-certify verification or self-impose legal hold
  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin')) THEN
    NEW.legal_hold := false;
    NEW.hash_verification_status := 'pending';
    NEW.hash_verified_at := NULL;
    NEW.verified_sha256 := NULL;
    NEW.verified_size := NULL;
    NEW.verification_error := NULL;

    -- Cross-tenant ownership check: FK only proves the case exists, not that it
    -- belongs to the caller. Uses current_setting directly (same as auth.uid())
    -- so the check does not depend on auth schema privileges of the caller role.
    IF NEW.case_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.cases
         WHERE id = NEW.case_id
           AND user_id = NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
      ) THEN
        RAISE EXCEPTION 'case_id does not belong to the authenticated user'
          USING errcode = '42501';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_insert_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_insert_guard
  BEFORE INSERT ON public.evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evidence_items_insert_guard();
