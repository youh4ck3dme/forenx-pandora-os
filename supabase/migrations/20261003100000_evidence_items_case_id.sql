-- Migration: 20261003100000_evidence_items_case_id.sql
-- Purpose: Reconcile live evidence_items schema with cleanroom baseline by adding
--          case_id FK to public.cases, backfilling existing rows from s3_object_key,
--          indexing case_id, and extending WORM and audit triggers.

-- 1. Add case_id column referencing public.cases(id) with ON DELETE RESTRICT
ALTER TABLE public.evidence_items
  ADD COLUMN IF NOT EXISTS case_id UUID REFERENCES public.cases(id) ON DELETE RESTRICT;

-- 2. Backfill case_id for existing rows where s3_object_key contains a valid case UUID
--    and the case actually exists in public.cases
UPDATE public.evidence_items
   SET case_id = (substring(s3_object_key from '^cases/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/evidence/'))::uuid
 WHERE case_id IS NULL
   AND s3_object_key ~ '^cases/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/evidence/'
   AND EXISTS (
     SELECT 1 FROM public.cases c
      WHERE c.id = (substring(s3_object_key from '^cases/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/evidence/'))::uuid
   );

-- 3. Create index on case_id for fast relational queries
CREATE INDEX IF NOT EXISTS idx_evidence_items_case
  ON public.evidence_items (case_id);

-- 4. Extend WORM update guard to make case_id write-once immutable
CREATE OR REPLACE FUNCTION public.evidence_items_worm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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
    RAISE EXCEPTION 'evidence_items identity columns are write-once (WORM)'
      USING errcode = '42501';
  END IF;

  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin')) AND (
       NEW.legal_hold IS DISTINCT FROM OLD.legal_hold
    OR NEW.hash_verification_status IS DISTINCT FROM OLD.hash_verification_status
    OR NEW.hash_verified_at IS DISTINCT FROM OLD.hash_verified_at
    OR NEW.verified_sha256 IS DISTINCT FROM OLD.verified_sha256
    OR NEW.verified_size IS DISTINCT FROM OLD.verified_size
    OR NEW.verification_error IS DISTINCT FROM OLD.verification_error
  ) THEN
    RAISE EXCEPTION 'legal hold and hash verification are set by the server only'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_worm_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_worm_guard
BEFORE UPDATE ON public.evidence_items
FOR EACH ROW EXECUTE FUNCTION public.evidence_items_worm_guard();

-- 5. Extend registration audit trigger to log case_id in case_audit_log
CREATE OR REPLACE FUNCTION public.evidence_items_audit_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  VALUES (
    NEW.investigator_id, NEW.case_id, 'evidence_registered', 'evidence_items', NEW.id,
    jsonb_build_object(
      'case_id', NEW.case_id,
      'case_name', NEW.case_name,
      'file_name', NEW.file_name,
      'file_size', NEW.file_size,
      'mime_type', NEW.mime_type,
      's3_object_key', NEW.s3_object_key,
      'sha256_hash', NEW.sha256_hash
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_audit_insert ON public.evidence_items;
CREATE TRIGGER evidence_items_audit_insert
AFTER INSERT ON public.evidence_items
FOR EACH ROW EXECUTE FUNCTION public.evidence_items_audit_insert();

-- 6. Extend delete_evidence_item_audited to associate deletion event with case_id
CREATE OR REPLACE FUNCTION public.delete_evidence_item_audited(
  _item UUID,
  _reason TEXT,
  _correlation TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor UUID := auth.uid();
  _row public.evidence_items;
  _event UUID;
  _reason_clean TEXT := btrim(coalesce(_reason, ''));
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF length(_reason_clean) < 10 OR length(_reason_clean) > 1000 THEN
    RAISE EXCEPTION 'deletion reason must have 10-1000 characters' USING errcode = '22023';
  END IF;

  SELECT * INTO _row FROM public.evidence_items WHERE id = _item FOR UPDATE;
  IF _row.id IS NULL
     OR (_row.investigator_id <> _actor AND NOT public.has_role(_actor, 'admin')) THEN
    RAISE EXCEPTION 'evidence item not found or access denied' USING errcode = '42501';
  END IF;
  IF _row.legal_hold THEN
    RAISE EXCEPTION 'evidence item is under legal hold' USING errcode = '42501';
  END IF;

  INSERT INTO public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) VALUES (
    _actor, _row.case_id, 'evidence_deleted', 'evidence_items', _row.id,
    jsonb_build_object(
      'case_id', _row.case_id,
      'reason', _reason_clean,
      'owner', _row.investigator_id,
      'snapshot', to_jsonb(_row)
    ),
    _correlation
  )
  RETURNING event_id INTO _event;

  PERFORM set_config('forenx.evidence_delete', 'on', true);
  DELETE FROM public.evidence_items WHERE id = _row.id;
  PERFORM set_config('forenx.evidence_delete', 'off', true);
  RETURN _event;
END;
$$;

-- 7. Extend record_evidence_verification to associate verification audit with case_id
CREATE OR REPLACE FUNCTION public.record_evidence_verification(
  _item UUID,
  _status TEXT,
  _verified_sha256 TEXT,
  _verified_size BIGINT,
  _error TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.evidence_items;
BEGIN
  IF _status NOT IN ('verified', 'mismatch', 'object_missing', 'error') THEN
    RAISE EXCEPTION 'invalid verification status %', _status USING errcode = '22023';
  END IF;
  SELECT * INTO _row FROM public.evidence_items WHERE id = _item FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'evidence item not found' USING errcode = 'P0002';
  END IF;
  IF _status = 'verified' AND (
       lower(coalesce(_verified_sha256, '')) <> _row.sha256_hash
    OR _verified_size IS DISTINCT FROM _row.file_size) THEN
    RAISE EXCEPTION 'verified status requires matching sha256 and size' USING errcode = '22023';
  END IF;

  UPDATE public.evidence_items
     SET hash_verification_status = _status,
         hash_verified_at = now(),
         verified_sha256 = lower(_verified_sha256),
         verified_size = _verified_size,
         verification_error = left(_error, 500)
   WHERE id = _row.id;

  INSERT INTO public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  VALUES (
    _row.investigator_id, _row.case_id, 'evidence_hash_' || _status, 'evidence_items', _row.id,
    jsonb_build_object(
      'case_id', _row.case_id,
      'expected_sha256', _row.sha256_hash,
      'verified_sha256', lower(_verified_sha256),
      'expected_size', _row.file_size,
      'verified_size', _verified_size
    )
  );
  RETURN _status;
END;
$$;
