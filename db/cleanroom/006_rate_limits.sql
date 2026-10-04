-- ==============================================================================
-- PANDORA / FORENX — CLEANROOM DATABASE BASELINE
-- File: 006_rate_limits.sql
-- Modules: Distributed PostgreSQL Rate Limiter (Atomic RPCs, Strict RLS Isolation)
-- Invariants:
--   - Rate limits table is RPC-ONLY
--   - Direct client access (SELECT, INSERT, UPDATE, DELETE) is unconditionally blocked
--   - Atomic UPSERT with window resets in single transaction
--   - Execution restricted exclusively to service_role
-- ==============================================================================

-- 1. RATE LIMITS TABLE
CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT NOT NULL PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 0),
  window_start TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON public.rate_limits (expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_key_idx ON public.rate_limits (key);

COMMENT ON TABLE public.rate_limits IS
  'P0-09: Distributed rate limiting state. Access ONLY via consume_rate_limit() and check_rate_limit() RPC functions.';

-- 2. CLEANUP FUNCTION
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_count BIGINT;
BEGIN
  DELETE FROM public.rate_limits
  WHERE expires_at < NOW();

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

-- 3. ATOMIC CONSUME FUNCTION (FIXED-WINDOW)
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_key IS NULL OR trim(p_key) = '' OR length(p_key) > 250 THEN
    RAISE EXCEPTION 'Invalid rate limit key' USING ERRCODE = '22023';
  END IF;

  IF p_max_requests IS NULL OR p_max_requests <= 0 THEN
    RAISE EXCEPTION 'Invalid max requests' USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'Invalid window seconds' USING ERRCODE = '22023';
  END IF;

  -- Atomic upsert: resets window if expired, otherwise increments count in fixed window
  RETURN QUERY
  WITH upserted AS (
    INSERT INTO public.rate_limits (key, count, window_start, expires_at, updated_at)
    VALUES (
      p_key,
      1,
      NOW(),
      NOW() + (GREATEST(p_window_seconds, 3600) || ' seconds')::interval,
      NOW()
    )
    ON CONFLICT (key) DO UPDATE
    SET
      count = CASE
        WHEN NOW() >= rate_limits.window_start + (p_window_seconds || ' seconds')::interval
        THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN NOW() >= rate_limits.window_start + (p_window_seconds || ' seconds')::interval
        THEN NOW()
        ELSE rate_limits.window_start
      END,
      expires_at = NOW() + (GREATEST(p_window_seconds, 3600) || ' seconds')::interval,
      updated_at = NOW()
    RETURNING rate_limits.*
  )
  SELECT
    ups.count <= p_max_requests,
    GREATEST(p_max_requests - ups.count, 0),
    ups.window_start + (p_window_seconds || ' seconds')::interval
  FROM upserted ups;
END;
$$;

-- 4. READ-ONLY STATUS CHECK FUNCTION (DOES NOT CONSUME QUOTA)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS TABLE (
  allowed BOOLEAN,
  remaining INTEGER,
  reset_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
  v_window_start TIMESTAMPTZ;
  v_effective_count INTEGER;
  v_effective_window_start TIMESTAMPTZ;
BEGIN
  IF p_key IS NULL OR trim(p_key) = '' OR length(p_key) > 250 THEN
    RAISE EXCEPTION 'Invalid rate limit key' USING ERRCODE = '22023';
  END IF;

  IF p_max_requests IS NULL OR p_max_requests <= 0 THEN
    RAISE EXCEPTION 'Invalid max requests' USING ERRCODE = '22023';
  END IF;

  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'Invalid window seconds' USING ERRCODE = '22023';
  END IF;

  SELECT count, window_start
  INTO v_count, v_window_start
  FROM public.rate_limits
  WHERE key = p_key;

  IF NOT FOUND THEN
    v_effective_count := 0;
    v_effective_window_start := NOW();
  ELSIF NOW() >= v_window_start + (p_window_seconds || ' seconds')::interval THEN
    v_effective_count := 0;
    v_effective_window_start := NOW();
  ELSE
    v_effective_count := v_count;
    v_effective_window_start := v_window_start;
  END IF;

  RETURN QUERY
  SELECT
    v_effective_count < p_max_requests,
    GREATEST(p_max_requests - v_effective_count, 0),
    v_effective_window_start + (p_window_seconds || ' seconds')::interval;
END;
$$;

-- 5. ROW LEVEL SECURITY & HARDENED DENY POLICIES
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS no_direct_select ON public.rate_limits;
CREATE POLICY no_direct_select ON public.rate_limits FOR SELECT USING (false);

DROP POLICY IF EXISTS no_direct_insert ON public.rate_limits;
CREATE POLICY no_direct_insert ON public.rate_limits FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS no_direct_update ON public.rate_limits;
CREATE POLICY no_direct_update ON public.rate_limits FOR UPDATE USING (false);

DROP POLICY IF EXISTS no_direct_delete ON public.rate_limits;
CREATE POLICY no_direct_delete ON public.rate_limits FOR DELETE USING (false);

-- 6. STRICT PRIVILEGE RESTRICTION (RPC ONLY VIA SERVICE_ROLE)
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits() TO service_role;
