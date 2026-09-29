-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 003_forensic_evidence.sql
-- Modules: Evidence Ledger, Source Snapshots, Immutability Guards, WORM Enforcement
-- Invariants:
--   - AI OUTPUT != EVIDENCE
--   - Evidence bytes/hash/identity are IMMUTABLE (WORM)
--   - SHA-256 integrity strictly enforced
--   - legal_hold is server-controlled; protects from mutation and deletion
--   - source_snapshots are immutable provenance records
-- ==============================================================================

-- 1. SOURCE SNAPSHOTS (UPSTREAM PROVENANCE)
CREATE TABLE IF NOT EXISTS public.source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
  source_url TEXT NOT NULL CHECK (length(source_url) BETWEEN 1 AND 2048),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  retrieved_at TIMESTAMPTZ NOT NULL,
  content_type TEXT,
  parser_version TEXT NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 40),
  raw_sha256 TEXT NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  storage_ref TEXT,
  etag TEXT,
  last_modified TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_snapshots_case_idx
  ON public.source_snapshots (case_id, retrieved_at DESC);
CREATE INDEX IF NOT EXISTS source_snapshots_user_idx
  ON public.source_snapshots (user_id);

ALTER TABLE public.source_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own source snapshots" ON public.source_snapshots;
CREATE POLICY "Users read own source snapshots"
  ON public.source_snapshots
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Snapshot Immutability Guard
CREATE OR REPLACE FUNCTION public.source_snapshots_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'source_snapshots rows are immutable (WORM violation)'
    USING errcode = '42501';
END;
$$;

DROP TRIGGER IF EXISTS source_snapshots_immutable ON public.source_snapshots;
CREATE TRIGGER source_snapshots_immutable
  BEFORE UPDATE ON public.source_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.source_snapshots_immutable();

-- Wire foreign key on case_relations if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'case_relations' AND column_name = 'source_snapshot_id'
  ) THEN
    ALTER TABLE public.case_relations
      DROP CONSTRAINT IF EXISTS case_relations_source_snapshot_id_fkey,
      ADD CONSTRAINT case_relations_source_snapshot_id_fkey
        FOREIGN KEY (source_snapshot_id) REFERENCES public.source_snapshots(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. EVIDENCE ITEMS (FORENSIC COURT-READY LEDGER)
CREATE TABLE IF NOT EXISTS public.evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investigator_id UUID NOT NULL REFERENCES auth.users(id),
  case_id UUID REFERENCES public.cases(id) ON DELETE RESTRICT,
  case_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  mime_type TEXT NOT NULL,
  s3_object_key TEXT NOT NULL,
  sha256_hash TEXT NOT NULL,
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  hash_verification_status TEXT NOT NULL DEFAULT 'pending',
  hash_verified_at TIMESTAMPTZ,
  verified_sha256 TEXT,
  verified_size BIGINT,
  verification_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT evidence_items_verification_status_check
    CHECK (hash_verification_status IN ('pending', 'verified', 'mismatch', 'object_missing', 'error')),
  CONSTRAINT evidence_items_verified_sha256_format
    CHECK (verified_sha256 IS NULL OR verified_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT evidence_items_verified_size_positive
    CHECK (verified_size IS NULL OR verified_size > 0)
);

-- Unique index guaranteeing idempotent registration under concurrency
CREATE UNIQUE INDEX IF NOT EXISTS evidence_items_s3_object_key_uidx
  ON public.evidence_items (s3_object_key);

CREATE INDEX IF NOT EXISTS idx_evidence_items_investigator
  ON public.evidence_items (investigator_id);
CREATE INDEX IF NOT EXISTS idx_evidence_items_case
  ON public.evidence_items (case_id);
CREATE INDEX IF NOT EXISTS idx_evidence_items_verification
  ON public.evidence_items (hash_verification_status, created_at);

ALTER TABLE public.evidence_items ENABLE ROW LEVEL SECURITY;

-- Explicit RLS Policies restricted TO authenticated
DROP POLICY IF EXISTS "Investigators can insert evidence" ON public.evidence_items;
CREATE POLICY "Investigators can insert evidence"
  ON public.evidence_items
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = investigator_id);

DROP POLICY IF EXISTS "Investigators can view own evidence" ON public.evidence_items;
CREATE POLICY "Investigators can view own evidence"
  ON public.evidence_items
  FOR SELECT
  TO authenticated
  USING (auth.uid() = investigator_id);

DROP POLICY IF EXISTS "Allow update if no legal hold" ON public.evidence_items;
CREATE POLICY "Allow update if no legal hold"
  ON public.evidence_items
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = investigator_id AND legal_hold = false)
  WITH CHECK (auth.uid() = investigator_id AND legal_hold = false);

-- Direct DELETE is completely forbidden via RLS (audited RPC only)
DROP POLICY IF EXISTS "Deny direct delete on evidence" ON public.evidence_items;
CREATE POLICY "Deny direct delete on evidence"
  ON public.evidence_items
  FOR DELETE
  TO authenticated
  USING (false);

-- 3. WORM TRIGGERS & INTEGRITY GUARDS

-- A. Insert Guard: Normalizes hash, enforces pending/non-hold for clients
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
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_insert_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_insert_guard
  BEFORE INSERT ON public.evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evidence_items_insert_guard();

-- B. WORM Update Guard: Core identity and hash are permanently immutable
CREATE OR REPLACE FUNCTION public.evidence_items_worm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.investigator_id IS DISTINCT FROM OLD.investigator_id
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

-- C. Direct Delete Guard
CREATE OR REPLACE FUNCTION public.evidence_items_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('forenx.evidence_deletion_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Direct DELETE of evidence_items is prohibited. Use audited delete procedure.'
    USING errcode = '42501';
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_delete_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_delete_guard
  BEFORE DELETE ON public.evidence_items
  FOR EACH ROW
  EXECUTE FUNCTION public.evidence_items_delete_guard();

-- 4. FORENSIC AUDITED OPERATIONS (RPCS)

-- Audited deletion: verifies legal hold, logs full snapshot into case_audit_log, and deletes
CREATE OR REPLACE FUNCTION public.delete_evidence_item_audited(_id UUID, _reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor UUID := auth.uid();
  _item public.evidence_items;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Chýba overenie identity.' USING errcode = '42501';
  END IF;

  SELECT * INTO _item FROM public.evidence_items WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Záznam dôkazu nebol nájdený.' USING errcode = 'P0002';
  END IF;

  IF _item.investigator_id <> _actor AND NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'Nemáte oprávnenie vymazať tento dôkaz.' USING errcode = '42501';
  END IF;

  IF _item.legal_hold THEN
    RAISE EXCEPTION 'Dôkaz podlieha legal hold: vymazanie je prísne zakázané.' USING errcode = '42501';
  END IF;

  -- Record audit event in case_audit_log
  IF to_regclass('public.case_audit_log') IS NOT NULL THEN
    INSERT INTO public.case_audit_log (
      user_id, case_id, action, table_name, record_id, changes, correlation_id
    ) VALUES (
      _actor, _item.case_id, 'evidence_deleted', 'evidence_items', _item.id,
      jsonb_build_object(
        'reason', COALESCE(_reason, ''),
        'snapshot', to_jsonb(_item)
      ),
      'audit-evidence-delete-' || _id::text
    );
  END IF;

  -- Perform guarded deletion
  PERFORM set_config('forenx.evidence_deletion_in_progress', 'on', true);
  DELETE FROM public.evidence_items WHERE id = _id;
  PERFORM set_config('forenx.evidence_deletion_in_progress', 'off', true);

  RETURN true;
END;
$$;

-- Verification recorder: atomic update of hash verification from server worker
CREATE OR REPLACE FUNCTION public.record_evidence_verification(
  _evidence_id UUID,
  _status TEXT,
  _verified_sha256 TEXT,
  _verified_size BIGINT,
  _error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _item public.evidence_items;
BEGIN
  SELECT * INTO _item FROM public.evidence_items WHERE id = _evidence_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dôkaz nebol nájdený.' USING errcode = 'P0002';
  END IF;

  UPDATE public.evidence_items
     SET hash_verification_status = _status,
         hash_verified_at = NOW(),
         verified_sha256 = _verified_sha256,
         verified_size = _verified_size,
         verification_error = _error,
         updated_at = NOW()
   WHERE id = _evidence_id;

  IF to_regclass('public.case_audit_log') IS NOT NULL THEN
    INSERT INTO public.case_audit_log (
      user_id, case_id, action, table_name, record_id, changes, correlation_id
    ) VALUES (
      _item.investigator_id, _item.case_id, 'evidence_verified', 'evidence_items', _item.id,
      jsonb_build_object(
        'status', _status,
        'verified_sha256', _verified_sha256,
        'verified_size', _verified_size,
        'error', _error
      ),
      'verify-' || _evidence_id::text
    );
  END IF;

  RETURN true;
END;
$$;

-- 5. GRANTS
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT SELECT ON public.source_snapshots TO authenticated;
GRANT ALL ON public.source_snapshots TO service_role;

GRANT SELECT, INSERT, UPDATE ON public.evidence_items TO authenticated;
GRANT ALL ON public.evidence_items TO service_role;

REVOKE ALL ON FUNCTION public.delete_evidence_item_audited(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_evidence_item_audited(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_evidence_verification(UUID, TEXT, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_evidence_verification(UUID, TEXT, TEXT, BIGINT, TEXT) TO service_role;
