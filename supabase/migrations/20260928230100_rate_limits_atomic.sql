-- P0-09: Rate Limiting with Atomic PostgreSQL Operations
--
-- Production-ready distributed rate limiting for serverless environments.
-- Uses Supabase/PostgreSQL with atomic RPC operations.
--
-- Design:
-- 1. Fixed-window: window starts at first request, resets after window duration
-- 2. Atomic consume via INSERT ... ON CONFLICT DO UPDATE
-- 3. Fail-closed: missing table/RPC/infra -> reject all requests
-- 4. Counter + window_start (not timestamp array)
-- 5. RLS enabled, no direct table access
-- 6. RPC server-only (service_role execute only)

-- ============================================================================
-- Rate Limits Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key TEXT NOT NULL PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count >= 0),
  window_start TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx ON public.rate_limits (expires_at);
CREATE INDEX IF NOT EXISTS rate_limits_key_idx ON public.rate_limits (key);

-- ============================================================================
-- Cleanup Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count BIGINT;
BEGIN
    DELETE FROM public.rate_limits WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- ============================================================================
-- Atomic Rate Limit Consume Function
--
-- Stored window semantics:
--   if no record exists: create with count=1, window_start=NOW()
--   if window expired (NOW() >= window_start + window): reset count=1, window_start=NOW()
--   else: increment count
--
-- Returns exactly one row with allowed, remaining, reset_at.
-- ============================================================================

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
SET search_path = public
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

  RETURN QUERY
  WITH upserted AS (
    INSERT INTO public.rate_limits (key, count, window_start, expires_at, updated_at)
    VALUES (
      p_key,
      1,
      NOW(),
      NOW() + INTERVAL '1 hour',
      NOW()
    )
    ON CONFLICT (key) DO UPDATE SET
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
      expires_at = NOW() + INTERVAL '1 hour',
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

-- ============================================================================
-- Rate Limit Check Function (read-only, no consume)
--
-- Returns exactly one row even when key doesn't exist.
-- For non-existent keys: allowed=true, remaining=max, reset_at=new_window_end
-- ============================================================================

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
SECURITY DEFINER
SET search_path = public
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

-- ============================================================================
-- Row-Level Security
-- ============================================================================

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_rate_limits_all ON public.rate_limits;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND schemaname = 'public' AND policyname = 'no_direct_select') THEN
        CREATE POLICY no_direct_select ON public.rate_limits FOR SELECT USING (false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND schemaname = 'public' AND policyname = 'no_direct_insert') THEN
        CREATE POLICY no_direct_insert ON public.rate_limits FOR INSERT WITH CHECK (false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND schemaname = 'public' AND policyname = 'no_direct_update') THEN
        CREATE POLICY no_direct_update ON public.rate_limits FOR UPDATE USING (false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'rate_limits' AND schemaname = 'public' AND policyname = 'no_direct_delete') THEN
        CREATE POLICY no_direct_delete ON public.rate_limits FOR DELETE USING (false);
    END IF;
END
$$;

REVOKE ALL ON TABLE public.rate_limits FROM anon;
REVOKE ALL ON TABLE public.rate_limits FROM authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;

REVOKE ALL ON FUNCTION public.consume_rate_limit FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_rate_limit FROM anon;
REVOKE ALL ON FUNCTION public.consume_rate_limit FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_rate_limit TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_rate_limits FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_rate_limits TO service_role;

-- ============================================================================
-- Comments
-- ============================================================================

COMMENT ON TABLE public.rate_limits IS 'P0-09: Distributed rate limiting state. Access ONLY via consume_rate_limit() and check_rate_limit() RPC functions.';
COMMENT ON FUNCTION public.consume_rate_limit IS 'P0-09: Atomically consume one rate limit slot. Returns allowed, remaining, reset_at.';
COMMENT ON FUNCTION public.check_rate_limit IS 'P0-09: Check rate limit state without consuming. Returns allowed, remaining, reset_at.';
