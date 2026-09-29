-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 004_audit.sql
-- Modules: Immutable Cryptographic Audit Log, Hash Chaining, Tamper Detection
-- Invariants:
--   - case_audit_log is APPEND-ONLY
--   - Every entry is cryptographically linked to the previous entry via SHA-256
--   - Concurrency is serialized per user via advisory locks
--   - Clock is server-enforced (NOW()); back-dating is mathematically impossible
--   - UPDATE and TRUNCATE are unconditionally blocked
--   - Individual row DELETE is forbidden; only complete GDPR erasure is permitted
-- ==============================================================================

-- 1. CASE AUDIT LOG TABLE
CREATE TABLE IF NOT EXISTS public.case_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  case_id UUID,
  action TEXT NOT NULL CHECK (action ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  table_name TEXT NOT NULL,
  record_id UUID,
  changes JSONB DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  chain_seq BIGINT,
  previous_event_hash TEXT,
  event_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS case_audit_log_event_id_key
  ON public.case_audit_log (event_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_audit_log_user_chain_seq_key
  ON public.case_audit_log (user_id, chain_seq);

CREATE INDEX IF NOT EXISTS idx_case_audit_log_user
  ON public.case_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_audit_log_case
  ON public.case_audit_log (case_id, created_at DESC);

ALTER TABLE public.case_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own audit log" ON public.case_audit_log;
CREATE POLICY "Users read own audit log"
  ON public.case_audit_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. CANONICAL SHA-256 HASH COMPUTATION
CREATE OR REPLACE FUNCTION public.audit_event_hash(
  _event_id UUID,
  _user_id UUID,
  _case_id UUID,
  _action TEXT,
  _table_name TEXT,
  _record_id UUID,
  _changes JSONB,
  _correlation_id TEXT,
  _created_at TIMESTAMPTZ,
  _chain_seq BIGINT,
  _previous_hash TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT encode(sha256(convert_to(concat_ws(
    E'\x1f',
    'forenx-audit-v1',
    _event_id::text,
    _user_id::text,
    COALESCE(_case_id::text, ''),
    _action,
    _table_name,
    COALESCE(_record_id::text, ''),
    COALESCE(_changes::text, 'null'),
    COALESCE(_correlation_id, ''),
    to_char(_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    _chain_seq::text,
    _previous_hash
  ), 'UTF8')), 'hex');
$$;

-- 3. CRYPTOGRAPHIC CHAINING TRIGGER
CREATE OR REPLACE FUNCTION public.case_audit_log_chain()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _prev_hash TEXT;
  _prev_seq BIGINT;
BEGIN
  -- Serialise appends per user to prevent chain forks under concurrency
  PERFORM pg_advisory_xact_lock(hashtextextended('case_audit_log:' || NEW.user_id::text, 0));

  SELECT event_hash, chain_seq INTO _prev_hash, _prev_seq
    FROM public.case_audit_log
   WHERE user_id = NEW.user_id
   ORDER BY chain_seq DESC
   LIMIT 1;

  NEW.event_id := COALESCE(NEW.event_id, gen_random_uuid());
  NEW.created_at := NOW();
  NEW.chain_seq := COALESCE(_prev_seq, 0) + 1;
  NEW.previous_event_hash := COALESCE(_prev_hash, repeat('0', 64));
  NEW.event_hash := public.audit_event_hash(
    NEW.event_id, NEW.user_id, NEW.case_id, NEW.action, NEW.table_name,
    NEW.record_id, NEW.changes, NEW.correlation_id, NEW.created_at,
    NEW.chain_seq, NEW.previous_event_hash
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS case_audit_log_chain ON public.case_audit_log;
CREATE TRIGGER case_audit_log_chain
  BEFORE INSERT ON public.case_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.case_audit_log_chain();

-- 4. IMMUTABILITY & TRUNCATE DEFENSE
CREATE OR REPLACE FUNCTION public.case_audit_log_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('forenx.audit_erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'case_audit_log is strictly append-only (% rejected)', TG_OP
    USING errcode = '42501';
END;
$$;

DROP TRIGGER IF EXISTS case_audit_log_no_update ON public.case_audit_log;
CREATE TRIGGER case_audit_log_no_update
  BEFORE UPDATE OR DELETE ON public.case_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.case_audit_log_append_only();

DROP TRIGGER IF EXISTS case_audit_log_no_truncate ON public.case_audit_log;
CREATE TRIGGER case_audit_log_no_truncate
  BEFORE TRUNCATE ON public.case_audit_log
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.case_audit_log_append_only();

-- 5. TAMPER VERIFICATION & AUDIT RPCS

-- Chain Verifier: checks the mathematical integrity of the cryptographic chain
CREATE OR REPLACE FUNCTION public.verify_audit_chain(_user UUID)
RETURNS TABLE (chain_seq BIGINT, event_id UUID, problem TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  _expected_prev TEXT := repeat('0', 64);
  _expected_seq BIGINT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.case_audit_log l WHERE l.user_id = _user ORDER BY l.chain_seq
  LOOP
    _expected_seq := _expected_seq + 1;
    IF r.chain_seq <> _expected_seq THEN
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'sequence_gap';
      RETURN NEXT; RETURN;
    END IF;
    IF r.previous_event_hash <> _expected_prev THEN
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'previous_hash_mismatch';
      RETURN NEXT; RETURN;
    END IF;
    IF r.event_hash <> public.audit_event_hash(
         r.event_id, r.user_id, r.case_id, r.action, r.table_name, r.record_id,
         r.changes, r.correlation_id, r.created_at, r.chain_seq, r.previous_event_hash) THEN
      chain_seq := r.chain_seq; event_id := r.event_id; problem := 'event_hash_mismatch';
      RETURN NEXT; RETURN;
    END IF;
    _expected_prev := r.event_hash;
  END LOOP;
END;
$$;

-- GDPR Erasure: removes the entire chain atomically (never partial manipulation)
CREATE OR REPLACE FUNCTION public.erase_user_audit_log(_user UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _deleted INTEGER;
BEGIN
  PERFORM set_config('forenx.audit_erasure', 'on', true);
  DELETE FROM public.case_audit_log WHERE user_id = _user;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  PERFORM set_config('forenx.audit_erasure', 'off', true);
  RETURN _deleted;
END;
$$;

-- Case Access Audit Logging (§ 119 Trestného poriadku / GDPR Art 6 & 9)
CREATE OR REPLACE FUNCTION public.log_case_access(
  _case_id UUID,
  _action TEXT,
  _legal_basis TEXT,
  _source_ip TEXT,
  _user_agent TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor UUID := auth.uid();
  _case public.cases;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Chýba overenie identity.' USING errcode = '42501';
  END IF;
  IF _action NOT IN ('view', 'export') THEN
    RAISE EXCEPTION 'Neplatný typ prístupu (povolené: view, export).' USING errcode = 'P0001';
  END IF;
  IF COALESCE(btrim(_legal_basis), '') = '' THEN
    RAISE EXCEPTION 'Prístup k spisu vyžaduje právny základ.' USING errcode = 'P0001';
  END IF;

  SELECT * INTO _case FROM public.cases WHERE id = _case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prípad nebol nájdený.' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) VALUES (
    _actor, _case_id, 'case_' || _action, 'cases', _case_id,
    jsonb_build_object(
      'legal_basis', _legal_basis,
      'source_ip', _source_ip,
      'user_agent', _user_agent,
      'case_status', _case.status,
      'case_name', _case.name
    ),
    'access-' || _action || '-' || gen_random_uuid()::text
  );
END;
$$;

-- Evidence Upload Audit Logging
CREATE OR REPLACE FUNCTION public.log_evidence_upload(
  _case_id UUID,
  _evidence_id UUID,
  _file_name TEXT,
  _file_size BIGINT,
  _sha256 TEXT,
  _s3_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor UUID := auth.uid();
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Chýba overenie identity.' USING errcode = '42501';
  END IF;

  INSERT INTO public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) VALUES (
    _actor, _case_id, 'evidence_uploaded', 'evidence_items', _evidence_id,
    jsonb_build_object(
      'file_name', _file_name,
      'file_size', _file_size,
      'sha256', _sha256,
      's3_object_key', _s3_key
    ),
    'evidence-upload-' || _evidence_id::text
  );
END;
$$;

-- Generic Server Event Appender
CREATE OR REPLACE FUNCTION public.append_audit_event(
  _actor UUID,
  _case UUID,
  _action TEXT,
  _target_table TEXT,
  _record UUID,
  _changes JSONB,
  _correlation TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _event UUID;
BEGIN
  INSERT INTO public.case_audit_log (
    user_id, case_id, action, table_name, record_id, changes, correlation_id
  ) VALUES (
    _actor, _case, _action, _target_table, _record, _changes, _correlation
  )
  RETURNING event_id INTO _event;
  RETURN _event;
END;
$$;

-- 6. GRANTS
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION public.audit_event_hash(UUID, UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT, TIMESTAMPTZ, BIGINT, TEXT) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.case_audit_log_chain() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.case_audit_log_append_only() FROM public, anon, authenticated;

GRANT SELECT ON public.case_audit_log TO authenticated;
GRANT ALL ON public.case_audit_log TO service_role;

REVOKE ALL ON FUNCTION public.verify_audit_chain(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.erase_user_audit_log(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.erase_user_audit_log(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.log_case_access(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_case_access(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.log_evidence_upload(UUID, UUID, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_evidence_upload(UUID, UUID, TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.append_audit_event(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_audit_event(UUID, UUID, TEXT, TEXT, UUID, JSONB, TEXT) TO service_role;
