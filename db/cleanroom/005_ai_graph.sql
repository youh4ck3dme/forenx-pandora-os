-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 005_ai_graph.sql
-- Modules: AI Telemetry, AI Usage Logs, Transactional Graph Commit, Ingest RPCs
-- Invariant:
--   - AI OUTPUT != EVIDENCE
--   - AI graph commits cannot alter or overwrite raw immutable evidence ledgers
--   - AI commits must be atomic and audit-logged
-- ==============================================================================

-- 1. AI USAGE (TOKEN METERING & RATE TRACKING)
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  case_id UUID REFERENCES public.cases(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  model TEXT,
  prompt_version TEXT,
  input_revision TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'failed', 'timeout')),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user ON public.ai_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_case ON public.ai_usage (case_id);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ai usage" ON public.ai_usage;
CREATE POLICY "Users read own ai usage"
  ON public.ai_usage
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 2. AI FEATURE LOGS (EVALUATION & PROVENANCE)
CREATE TABLE IF NOT EXISTS public.ai_feature_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_summary TEXT,
  output_summary TEXT,
  duration_ms INTEGER,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_feature_logs_user ON public.ai_feature_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feature_logs_feature ON public.ai_feature_logs (feature);

ALTER TABLE public.ai_feature_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own ai feature logs" ON public.ai_feature_logs;
CREATE POLICY "Users read own ai feature logs"
  ON public.ai_feature_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own ai feature logs" ON public.ai_feature_logs;
CREATE POLICY "Users insert own ai feature logs"
  ON public.ai_feature_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- 3. AI CALL RESERVATION RPC
CREATE OR REPLACE FUNCTION public.reserve_ai_call(
  _user_id UUID,
  _case_id UUID,
  _task TEXT,
  _model TEXT,
  _prompt_version TEXT,
  _input_revision TEXT,
  _max_tokens INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _usage_id UUID;
BEGIN
  INSERT INTO public.ai_usage (
    user_id, case_id, task, model, prompt_version, input_revision, status
  ) VALUES (
    _user_id, _case_id, _task, _model, _prompt_version, _input_revision, 'reserved'
  )
  RETURNING id INTO _usage_id;

  RETURN _usage_id;
END;
$$;

-- 4. ATOMIC AI GRAPH COMMIT RPC
CREATE OR REPLACE FUNCTION public.commit_ai_case_graph(
  _case UUID,
  _actor UUID,
  _entities JSONB,
  _events JSONB,
  _relations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _owner UUID;
  _status TEXT;
  _entity_count INTEGER := 0;
  _event_count INTEGER := 0;
  _relation_count INTEGER := 0;
BEGIN
  -- Strict row-level lock on target case to prevent concurrent modifications
  SELECT user_id, COALESCE(status, 'draft')
    INTO _owner, _status
  FROM public.cases
  WHERE id = _case
  FOR UPDATE;

  IF _owner IS NULL OR _owner <> _actor THEN
    RAISE EXCEPTION 'Case not found or access denied' USING errcode = '42501';
  END IF;

  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Spis nie je v stave draft (%): AI generovaný graf nemožno zapísať.', _status
      USING errcode = '42501';
  END IF;

  -- 1. Insert Entities
  IF _entities IS NOT NULL AND jsonb_array_length(_entities) > 0 THEN
    INSERT INTO public.case_entities (
      id, case_id, user_id, name, kind, role, identity_key, x, y, note
    )
    SELECT
      COALESCE((entry->>'id')::uuid, gen_random_uuid()),
      _case,
      _actor,
      entry->>'name',
      entry->>'kind',
      entry->>'role',
      NULLIF(entry->>'identity_key', ''),
      (entry->>'x')::numeric,
      (entry->>'y')::numeric,
      entry->>'note'
    FROM jsonb_array_elements(_entities) AS entry
    ON CONFLICT (case_id, identity_key) WHERE identity_key IS NOT NULL DO UPDATE
      SET name = EXCLUDED.name,
          kind = EXCLUDED.kind,
          role = COALESCE(EXCLUDED.role, case_entities.role),
          note = COALESCE(EXCLUDED.note, case_entities.note),
          updated_at = NOW();

    GET DIAGNOSTICS _entity_count = ROW_COUNT;
  END IF;

  -- 2. Insert Events
  IF _events IS NOT NULL AND jsonb_array_length(_events) > 0 THEN
    INSERT INTO public.case_events (
      id, case_id, user_id, date, title, detail, severity
    )
    SELECT
      COALESCE((entry->>'id')::uuid, gen_random_uuid()),
      _case,
      _actor,
      (entry->>'date')::date,
      entry->>'title',
      entry->>'detail',
      COALESCE(entry->>'severity', 'info')
    FROM jsonb_array_elements(_events) AS entry;

    GET DIAGNOSTICS _event_count = ROW_COUNT;
  END IF;

  -- 3. Insert Relations
  IF _relations IS NOT NULL AND jsonb_array_length(_relations) > 0 THEN
    INSERT INTO public.case_relations (
      id, case_id, user_id, from_id, to_id, label, valid_from, valid_to, evidence_hash
    )
    SELECT
      COALESCE((entry->>'id')::uuid, gen_random_uuid()),
      _case,
      _actor,
      (entry->>'from_id')::uuid,
      (entry->>'to_id')::uuid,
      entry->>'label',
      NULLIF(entry->>'valid_from', '')::date,
      NULLIF(entry->>'valid_to', '')::date,
      NULLIF(entry->>'evidence_hash', '')
    FROM jsonb_array_elements(_relations) AS entry;

    GET DIAGNOSTICS _relation_count = ROW_COUNT;
  END IF;

  -- 4. Record audit entry in immutable case_audit_log
  IF to_regclass('public.case_audit_log') IS NOT NULL THEN
    INSERT INTO public.case_audit_log (
      user_id, case_id, action, table_name, record_id, changes, correlation_id
    ) VALUES (
      _actor, _case, 'ai_graph_committed', 'cases', _case,
      jsonb_build_object(
        'entities_count', _entity_count,
        'events_count', _event_count,
        'relations_count', _relation_count
      ),
      'ai-commit-' || gen_random_uuid()::text
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'entities_committed', _entity_count,
    'events_committed', _event_count,
    'relations_committed', _relation_count
  );
END;
$$;

-- 5. COMMIT IMPORT RPC
CREATE OR REPLACE FUNCTION public.commit_import(
  _case UUID,
  _data JSONB,
  _actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _owner UUID;
  _status TEXT;
BEGIN
  SELECT user_id, status INTO _owner, _status FROM public.cases WHERE id = _case FOR UPDATE;
  IF _owner IS NULL OR _owner <> _actor THEN
    RAISE EXCEPTION 'Case not found or access denied' USING errcode = '42501';
  END IF;

  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Spis nie je v stave draft (%): import dát je blokovaný.', _status
      USING errcode = '42501';
  END IF;

  -- Import logic delegates to graph commit
  RETURN public.commit_ai_case_graph(
    _case,
    _actor,
    COALESCE(_data->'entities', '[]'::jsonb),
    COALESCE(_data->'events', '[]'::jsonb),
    COALESCE(_data->'relations', '[]'::jsonb)
  );
END;
$$;

-- 6. GRANTS
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT SELECT ON public.ai_usage TO authenticated;
GRANT ALL ON public.ai_usage TO service_role;

GRANT SELECT, INSERT ON public.ai_feature_logs TO authenticated;
GRANT ALL ON public.ai_feature_logs TO service_role;

REVOKE ALL ON FUNCTION public.reserve_ai_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_call(UUID, UUID, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.commit_ai_case_graph(UUID, UUID, JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_ai_case_graph(UUID, UUID, JSONB, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.commit_import(UUID, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_import(UUID, JSONB, UUID) TO service_role;
