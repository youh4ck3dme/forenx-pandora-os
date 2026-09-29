-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 002_cases.sql
-- Modules: Forensic Cases, Graph Entities, Events, Relations, Transactions,
--          Weapons, Imports, Registry Profiles, Lifecycle Guards
-- ==============================================================================

-- 1. CASES (FORENSIC DOSSIERS)
CREATE TABLE IF NOT EXISTS public.cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subtitle TEXT,
  reference_date DATE,
  europol_serials JSONB DEFAULT '[]'::jsonb,
  valid_licences JSONB DEFAULT '[]'::jsonb,
  orsr_addresses JSONB DEFAULT '[]'::jsonb,
  forensic_dossier JSONB DEFAULT '{}'::jsonb,
  forensic_dossier_updated_at TIMESTAMPTZ,
  base_currency TEXT NOT NULL DEFAULT 'EUR',
  revision INTEGER NOT NULL DEFAULT 1,
  is_demo BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  status_reason TEXT NOT NULL DEFAULT '',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cases_status_check CHECK (status IN ('draft', 'closed', 'legal_hold', 'archived', 'destroyed'))
);

CREATE INDEX IF NOT EXISTS idx_cases_user ON public.cases (user_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases (user_id, status);

ALTER TABLE public.cases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own cases" ON public.cases;
CREATE POLICY "Users manage own cases"
  ON public.cases
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_cases_updated_at ON public.cases;
CREATE TRIGGER update_cases_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Ownership check RPC
CREATE OR REPLACE FUNCTION public.owns_case(_case_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cases
    WHERE id = _case_id AND user_id = auth.uid()
  );
$$;

-- Revision bumper
CREATE OR REPLACE FUNCTION public.bump_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.revision := COALESCE(OLD.revision, 1) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bump_revision_cases ON public.cases;
CREATE TRIGGER bump_revision_cases
  BEFORE UPDATE ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 2. CASE ENTITIES (GRAPH NODES)
CREATE TABLE IF NOT EXISTS public.case_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  ico TEXT,
  address TEXT,
  registered_address TEXT,
  licence TEXT,
  incorporated_at DATE,
  physical_inventory TEXT,
  responsive BOOLEAN DEFAULT true,
  country TEXT DEFAULT 'SK',
  identity_key TEXT,
  x NUMERIC,
  y NUMERIC,
  note TEXT,
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_entities_case ON public.case_entities (case_id);
CREATE INDEX IF NOT EXISTS idx_case_entities_user ON public.case_entities (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS case_entities_identity_key_unique
  ON public.case_entities (case_id, identity_key)
  WHERE identity_key IS NOT NULL;

ALTER TABLE public.case_entities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case entities" ON public.case_entities;
CREATE POLICY "Users manage own case entities"
  ON public.case_entities
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_entities_updated_at ON public.case_entities;
CREATE TRIGGER update_case_entities_updated_at
  BEFORE UPDATE ON public.case_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bump_revision_case_entities ON public.case_entities;
CREATE TRIGGER bump_revision_case_entities
  BEFORE UPDATE ON public.case_entities
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 3. CASE EVENTS (TIMELINE)
CREATE TABLE IF NOT EXISTS public.case_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  severity TEXT DEFAULT 'info',
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_events_case ON public.case_events (case_id);
CREATE INDEX IF NOT EXISTS idx_case_events_date ON public.case_events (case_id, date);

ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case events" ON public.case_events;
CREATE POLICY "Users manage own case events"
  ON public.case_events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_events_updated_at ON public.case_events;
CREATE TRIGGER update_case_events_updated_at
  BEFORE UPDATE ON public.case_events
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bump_revision_case_events ON public.case_events;
CREATE TRIGGER bump_revision_case_events
  BEFORE UPDATE ON public.case_events
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 4. CASE RELATIONS (GRAPH EDGES & TEMPORAL VALIDITY)
CREATE TABLE IF NOT EXISTS public.case_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  from_id UUID NOT NULL REFERENCES public.case_entities(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES public.case_entities(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  source_snapshot_id UUID,
  evidence_hash TEXT,
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT case_relations_valid_interval CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS idx_case_relations_case ON public.case_relations (case_id);
CREATE INDEX IF NOT EXISTS idx_case_relations_endpoints ON public.case_relations (from_id, to_id);

ALTER TABLE public.case_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case relations" ON public.case_relations;
CREATE POLICY "Users manage own case relations"
  ON public.case_relations
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_relations_updated_at ON public.case_relations;
CREATE TRIGGER update_case_relations_updated_at
  BEFORE UPDATE ON public.case_relations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bump_revision_case_relations ON public.case_relations;
CREATE TRIGGER bump_revision_case_relations
  BEFORE UPDATE ON public.case_relations
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 5. CASE TRANSACTIONS (FORENSIC FINANCIAL AUDIT)
CREATE TABLE IF NOT EXISTS public.case_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  date DATE NOT NULL,
  amount NUMERIC(16, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  method TEXT NOT NULL,
  from_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  to_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  payer_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  origin_country TEXT,
  destination_country TEXT,
  description TEXT,
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_transactions_case ON public.case_transactions (case_id);
CREATE INDEX IF NOT EXISTS idx_case_transactions_date ON public.case_transactions (case_id, date);

ALTER TABLE public.case_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case transactions" ON public.case_transactions;
CREATE POLICY "Users manage own case transactions"
  ON public.case_transactions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_transactions_updated_at ON public.case_transactions;
CREATE TRIGGER update_case_transactions_updated_at
  BEFORE UPDATE ON public.case_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bump_revision_case_transactions ON public.case_transactions;
CREATE TRIGGER bump_revision_case_transactions
  BEFORE UPDATE ON public.case_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 6. CASE WEAPONS (SPECIAL INVESTIGATIONS)
CREATE TABLE IF NOT EXISTS public.case_weapons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  serial TEXT NOT NULL,
  holder_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  acquired_at DATE,
  licence TEXT,
  revision INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_weapons_case ON public.case_weapons (case_id);

ALTER TABLE public.case_weapons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case weapons" ON public.case_weapons;
CREATE POLICY "Users manage own case weapons"
  ON public.case_weapons
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_weapons_updated_at ON public.case_weapons;
CREATE TRIGGER update_case_weapons_updated_at
  BEFORE UPDATE ON public.case_weapons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS bump_revision_case_weapons ON public.case_weapons;
CREATE TRIGGER bump_revision_case_weapons
  BEFORE UPDATE ON public.case_weapons
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_revision();

-- 7. CASE IMPORTS (INGEST LOG & METRICS)
CREATE TABLE IF NOT EXISTS public.case_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  filename TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  parser_version TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT ',',
  decimal_separator TEXT NOT NULL DEFAULT '.',
  date_format TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
  encoding TEXT NOT NULL DEFAULT 'utf-8',
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  error_rows INTEGER NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  partial BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'committed', 'failed')),
  error_detail TEXT,
  original_stored BOOLEAN NOT NULL DEFAULT false,
  storage_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_imports_case ON public.case_imports (case_id, created_at);
CREATE INDEX IF NOT EXISTS idx_case_imports_user ON public.case_imports (user_id);

ALTER TABLE public.case_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own case imports" ON public.case_imports;
CREATE POLICY "Users manage own case imports"
  ON public.case_imports
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_case_imports_updated_at ON public.case_imports;
CREATE TRIGGER update_case_imports_updated_at
  BEFORE UPDATE ON public.case_imports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 8. COMPANY REGISTRY PROFILES (ORSR CACHE)
CREATE TABLE IF NOT EXISTS public.company_registry_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  entity_id UUID REFERENCES public.case_entities(id) ON DELETE SET NULL,
  ico TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  legal_form TEXT,
  registered_address TEXT,
  country TEXT NOT NULL DEFAULT 'SK',
  status TEXT NOT NULL DEFAULT 'active',
  incorporated_at DATE,
  dissolved_at DATE,
  statutory_persons JSONB NOT NULL DEFAULT '[]'::jsonb,
  business_activities JSONB NOT NULL DEFAULT '[]'::jsonb,
  address_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL,
  source_url TEXT,
  source_hash TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_registry_profiles_case_ico_key UNIQUE (case_id, ico, source_hash)
);

CREATE INDEX IF NOT EXISTS idx_registry_profiles_case ON public.company_registry_profiles (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registry_profiles_user ON public.company_registry_profiles (user_id);

ALTER TABLE public.company_registry_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own registry profiles" ON public.company_registry_profiles;
CREATE POLICY "Users read own registry profiles"
  ON public.company_registry_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- 9. CROSS-BORDER ANALYSES
CREATE TABLE IF NOT EXISTS public.cross_border_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  report_id TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TIMESTAMPTZ,
  countries JSONB NOT NULL DEFAULT '[]'::jsonb,
  routes JSONB NOT NULL DEFAULT '[]'::jsonb,
  intermediaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  nominee_indicators JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_url TEXT,
  source_hash TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_border_case ON public.cross_border_analyses (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_border_user ON public.cross_border_analyses (user_id);

ALTER TABLE public.cross_border_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own cross border analyses" ON public.cross_border_analyses;
CREATE POLICY "Users manage own cross border analyses"
  ON public.cross_border_analyses
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 10. CASE LIFECYCLE GUARDS & CONTROLLED DESTRUCTION
CREATE OR REPLACE FUNCTION public.case_status_transition_ok(_from TEXT, _to TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _from
    WHEN 'draft'      THEN _to IN ('closed', 'legal_hold')
    WHEN 'closed'     THEN _to IN ('draft', 'legal_hold', 'archived')
    WHEN 'legal_hold' THEN _to IN ('closed', 'archived')
    WHEN 'archived'   THEN _to IN ('closed', 'legal_hold', 'destroyed')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_case_status(_case_id UUID, _status TEXT, _reason TEXT DEFAULT '')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _actor UUID := auth.uid();
  _case public.cases;
  _is_admin BOOLEAN;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'Chýba overenie identity.' USING errcode = '42501';
  END IF;

  SELECT * INTO _case FROM public.cases WHERE id = _case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prípad nebol nájdený.' USING errcode = 'P0002';
  END IF;

  _is_admin := public.has_role(_actor, 'admin');

  IF _case.user_id <> _actor AND NOT _is_admin THEN
    RAISE EXCEPTION 'Nemáte oprávnenie meniť stav tohto spisu.' USING errcode = '42501';
  END IF;

  IF _case.status = 'legal_hold' AND _status <> 'legal_hold' AND NOT _is_admin THEN
    RAISE EXCEPTION 'Zrušenie legal hold vyžaduje schválenie administrátorom.' USING errcode = '42501';
  END IF;

  IF NOT public.case_status_transition_ok(_case.status, _status) THEN
    RAISE EXCEPTION 'Nedovolený prechod stavu spisu: % -> %', _case.status, _status
      USING errcode = 'P0001';
  END IF;

  UPDATE public.cases
     SET status = _status,
         status_reason = COALESCE(_reason, ''),
         status_changed_at = NOW(),
         updated_at = NOW()
   WHERE id = _case_id;

  RETURN _status;
END;
$$;

-- Child table mutation guard: rejects INSERT/UPDATE/DELETE unless parent case is 'draft'
CREATE OR REPLACE FUNCTION public.case_child_lifecycle_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _cid UUID;
  _status TEXT;
BEGIN
  -- Allow cascade deletion if controlled case destruction is in progress
  IF TG_OP = 'DELETE' AND current_setting('forenx.case_destruction_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;

  _cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.case_id ELSE NEW.case_id END;
  IF _cid IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT status INTO _status FROM public.cases WHERE id = _cid;
  IF _status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Spis nie je v stave draft (%): zmeny podriadených záznamov sú blokované.', _status
      USING errcode = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['case_entities', 'case_events', 'case_relations', 'case_transactions', 'case_weapons', 'case_imports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %1$s_lifecycle_guard ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER %1$s_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.case_child_lifecycle_guard()', t);
  END LOOP;
END $$;

-- 11. CONTROLLED DESTRUCTION (ADMIN-SUPERVISED)
CREATE OR REPLACE FUNCTION public.destroy_case(_case_id UUID, _reason TEXT)
RETURNS BOOLEAN
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

  IF NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'Iba administrátor smie vykonať riadenú skartáciu spisu.' USING errcode = '42501';
  END IF;

  SELECT * INTO _case FROM public.cases WHERE id = _case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prípad nebol nájdený.' USING errcode = 'P0002';
  END IF;

  IF _case.status = 'legal_hold' THEN
    RAISE EXCEPTION 'Spis pod legal hold nemožno zničiť.' USING errcode = '42501';
  END IF;

  -- Block destruction if active evidence items exist for this case
  IF to_regclass('public.evidence_items') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.evidence_items WHERE case_id = _case_id) THEN
      RAISE EXCEPTION 'Spis obsahuje evidované dôkazy: skartácia spisu vyžaduje predchádzajúce vyriešenie dôkazov.' USING errcode = '42501';
    END IF;
  END IF;

  -- Audit log the controlled destruction
  IF to_regclass('public.case_audit_log') IS NOT NULL THEN
    INSERT INTO public.case_audit_log (
      user_id, case_id, action, table_name, record_id, changes, correlation_id
    ) VALUES (
      _actor, _case_id, 'case_destroyed', 'cases', _case_id,
      jsonb_build_object(
        'reason', COALESCE(_reason, ''),
        'snapshot', to_jsonb(_case)
      ),
      'destroy-case-' || _case_id::text
    );
  END IF;

  -- Controlled deletion with cascade guard bypass
  PERFORM set_config('forenx.case_destruction_in_progress', 'on', true);
  DELETE FROM public.cases WHERE id = _case_id;
  PERFORM set_config('forenx.case_destruction_in_progress', 'off', true);

  RETURN true;
END;
$$;

-- 12. GRANTS
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cases TO authenticated;
GRANT ALL ON public.cases TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_entities TO authenticated;
GRANT ALL ON public.case_entities TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_events TO authenticated;
GRANT ALL ON public.case_events TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_relations TO authenticated;
GRANT ALL ON public.case_relations TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_transactions TO authenticated;
GRANT ALL ON public.case_transactions TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_weapons TO authenticated;
GRANT ALL ON public.case_weapons TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_imports TO authenticated;
GRANT ALL ON public.case_imports TO service_role;

GRANT SELECT ON public.company_registry_profiles TO authenticated;
GRANT ALL ON public.company_registry_profiles TO service_role;

GRANT SELECT, INSERT ON public.cross_border_analyses TO authenticated;
GRANT ALL ON public.cross_border_analyses TO service_role;

GRANT EXECUTE ON FUNCTION public.owns_case(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_case_status(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.destroy_case(UUID, TEXT) TO authenticated, service_role;
