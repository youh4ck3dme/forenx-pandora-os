-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM MIGRATION 010
-- File: 010_evidence_worm_case_id.sql
-- Purpose: Extend evidence_items WORM guard to protect case_id as a write-once
--          identity column, mirroring live migration 20261003100000.
--
-- Invariants added:
--   - evidence_items.case_id is immutable once set (write-once, WORM)
--   - Attempting UPDATE of case_id raises errcode 42501
--   - NULL → NULL is not a change (IS DISTINCT FROM handles this correctly)
--   - 001–009 are frozen; this is purely additive (CREATE OR REPLACE + trigger)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.evidence_items_worm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.investigator_id IS DISTINCT FROM OLD.investigator_id
     OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NEW.case_name IS DISTINCT FROM OLD.case_name
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.file_size IS DISTINCT FROM OLD.file_size
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.s3_object_key IS DISTINCT FROM OLD.s3_object_key
     OR NEW.sha256_hash IS DISTINCT FROM OLD.sha256_hash
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'evidence_items identity and forensic columns are write-once (WORM violation)'
      USING errcode = '42501';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_worm_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_worm_guard
  BEFORE UPDATE ON public.evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evidence_items_worm_guard();
