-- SumUp recurring billing is orchestrated by the application; SumUp stores the
-- tokenized payment instrument and processes each monthly checkout.
ALTER TABLE public.subscriptions
  ALTER COLUMN provider SET DEFAULT 'sumup',
  ADD COLUMN IF NOT EXISTS renewal_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recurring_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_consent_version text,
  ADD COLUMN IF NOT EXISTS renewal_attempt_count integer NOT NULL DEFAULT 0
    CHECK (renewal_attempt_count >= 0);

ALTER TABLE public.billing_events
  ALTER COLUMN provider SET DEFAULT 'sumup';

CREATE TABLE IF NOT EXISTS public.billing_payment_methods (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  customer_id text NOT NULL,
  payment_instrument_token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, environment)
);

ALTER TABLE public.billing_payment_methods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payment_methods FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_payment_methods TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'live')),
  period_end timestamptz NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  checkout_reference text NOT NULL UNIQUE,
  checkout_id text,
  status text NOT NULL DEFAULT 'prepared'
    CHECK (status IN ('prepared', 'processing', 'paid', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, environment, period_end, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_attempts_due
  ON public.billing_payment_attempts (environment, status, created_at DESC);
ALTER TABLE public.billing_payment_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payment_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_payment_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.claim_sumup_due_subscriptions(
  _environment text,
  _batch_size integer DEFAULT 50
)
RETURNS TABLE (
  user_id uuid,
  customer_id text,
  period_end timestamptz,
  status text,
  cancel_at_period_end boolean,
  renewal_attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _environment NOT IN ('sandbox', 'live') THEN
    RAISE EXCEPTION 'Invalid billing environment';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT s.id
    FROM public.subscriptions s
    WHERE s.provider = 'sumup'
      AND s.environment = _environment
      AND s.plan = 'pro'
      AND s.status IN ('trialing', 'active', 'past_due')
      AND s.current_period_end IS NOT NULL
      AND s.current_period_end <= now()
      AND (s.renewal_next_attempt_at IS NULL OR s.renewal_next_attempt_at <= now())
      AND (s.renewal_claimed_at IS NULL OR s.renewal_claimed_at < now() - interval '15 minutes')
    ORDER BY s.current_period_end
    LIMIT GREATEST(1, LEAST(COALESCE(_batch_size, 50), 100))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.subscriptions s
  SET renewal_claimed_at = now(),
      renewal_attempt_count = s.renewal_attempt_count + 1
  FROM due
  WHERE s.id = due.id
  RETURNING s.user_id, s.customer_id, s.current_period_end, s.status,
            s.cancel_at_period_end, s.renewal_attempt_count;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sumup_due_subscriptions(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sumup_due_subscriptions(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.current_plan(_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT s.plan FROM public.subscriptions s
      WHERE s.user_id = _user
        AND s.provider = 'sumup'
        AND s.status IN ('active', 'trialing', 'past_due')
        AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
      ORDER BY s.current_period_end DESC NULLS LAST
      LIMIT 1),
    'free'
  );
$$;
