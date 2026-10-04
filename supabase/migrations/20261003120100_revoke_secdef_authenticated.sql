-- Security: revoke authenticated EXECUTE from two SECURITY DEFINER functions
-- that must not be callable by signed-in users via PostgREST /rpc/.
--
-- has_role(_user_id, _role): accepts an arbitrary UUID — any authenticated user
--   could enumerate roles of other users. Internal callers (owns_case,
--   set_case_status, health_metrics, evidence guards) are SECURITY DEFINER
--   themselves, so they run as their definer and are unaffected by this revoke.
--
-- health_metrics(): admin-only by internal check, but there is no reason to
--   expose it as an authenticated RPC endpoint.
--
-- All other SECURITY DEFINER functions (delete_evidence_item_audited,
-- destroy_case, set_case_status, log_case_access, owns_case) are intentional
-- user-callable RPCs with internal ownership checks — untouched.
-- The avatars bucket policy is also untouched.

revoke execute on function public.has_role(uuid, public.app_role)
  from authenticated;

revoke execute on function public.health_metrics()
  from authenticated;
