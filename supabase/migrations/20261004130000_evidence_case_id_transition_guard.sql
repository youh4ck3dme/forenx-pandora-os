-- Transitional hardening for legacy evidence_items rows without a case_id.
-- Existing NULL rows are preserved and explicitly inventoried; no case is guessed.
-- All new evidence writes fail closed until a valid case_id is supplied.

CREATE TABLE IF NOT EXISTS public.evidence_items_legacy_unresolved (
  evidence_id UUID PRIMARY KEY REFERENCES public.evidence_items(id) ON DELETE RESTRICT,
  investigator_id UUID NOT NULL REFERENCES auth.users(id),
  legacy_case_name TEXT NOT NULL,
  s3_object_key TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolution_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (resolution_status IN ('unresolved', 'resolved', 'retired')),
  resolution_note TEXT
);

INSERT INTO public.evidence_items_legacy_unresolved (
  evidence_id, investigator_id, legacy_case_name, s3_object_key
)
SELECT id, investigator_id, case_name, s3_object_key
FROM public.evidence_items
WHERE case_id IS NULL
ON CONFLICT (evidence_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.evidence_items_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.case_id IS NULL THEN
    RAISE EXCEPTION 'case_id is required for new evidence_items records; resolve legacy records explicitly'
      USING errcode = '23502';
  END IF;

  NEW.sha256_hash := lower(btrim(NEW.sha256_hash));
  IF NEW.sha256_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'sha256_hash must be 64 hex characters' USING errcode = '23514';
  END IF;

  NEW.created_at := now();
  IF NOT (current_user IN ('postgres', 'service_role', 'supabase_admin')) THEN
    NEW.legal_hold := false;
    NEW.hash_verification_status := 'pending';
    NEW.hash_verified_at := null;
    NEW.verified_sha256 := null;
    NEW.verified_size := null;
    NEW.verification_error := null;
    IF NOT EXISTS (
      SELECT 1 FROM public.cases
      WHERE id = NEW.case_id
        AND user_id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    ) THEN
      RAISE EXCEPTION 'case_id does not belong to the authenticated user' USING errcode = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS evidence_items_insert_guard ON public.evidence_items;
CREATE TRIGGER evidence_items_insert_guard
BEFORE INSERT ON public.evidence_items
FOR EACH ROW EXECUTE FUNCTION public.evidence_items_insert_guard();
