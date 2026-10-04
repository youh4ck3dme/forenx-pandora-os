-- public.rls_auto_enable() is provided by hosted Supabase projects and is not
-- created by any migration here. On a clean Postgres (local, CI, PGlite) create
-- an inert stub so the chain applies; where the real function exists it is
-- left untouched. The stub is not attached to any event trigger.
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NULL THEN
    CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
      LANGUAGE plpgsql SET search_path = public AS $fn$ BEGIN END $fn$;
    COMMENT ON FUNCTION public.rls_auto_enable() IS
      'Inert stub: hosted Supabase provides the real implementation.';
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_import(uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.current_plan(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_ai_call(uuid, uuid, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.db_health_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_case(uuid) FROM PUBLIC, anon;