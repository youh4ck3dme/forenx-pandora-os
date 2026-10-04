-- Admin allowlist: info@bizagent.sk (+ legacy erikbabcan@gmail.com).
-- Updates signup trigger and grants admin to existing matching profiles.
--
-- Shared-database guard (added 2026-09-28): public.handle_new_user() is a common
-- Supabase-template name. It is (re)defined here ONLY when it does not exist or its
-- body is exactly one of Pandora's released versions (md5 of the whitespace-
-- normalised body); another app's
-- function of the same name is never overwritten. Where this migration was already
-- applied, the change has no effect. From 20260928230000 Pandora uses its own
-- pandora_handle_new_user() / pandora_on_auth_user_created instead.

-- preflight: guarded public.handle_new_user
do $guard$
declare
  _fn oid := to_regprocedure('public.handle_new_user()');
  _src text;
begin
  if _fn is not null then
    select prosrc into _src from pg_proc where oid = _fn;
    if not md5(btrim(regexp_replace(_src, '[[:space:]]+', ' ', 'g'))) = any (array['0248868212ba18dc2a56835ccb041efc', '61da00d897181d13de4eef8d1f4f3895']) then
      raise notice 'pandora: public.handle_new_user() belongs to another application; not replaced';
      return;
    end if;
  end if;

  execute $fn$
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  admin_emails text[] := array[
    'info@bizagent.sk',
    'erikbabcan@gmail.com'
  ];
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (
    new.id,
    case
      when lower(coalesce(new.email, '')) = any (admin_emails)
        then 'admin'::public.app_role
      else 'user'::public.app_role
    end
  )
  on conflict (user_id, role) do nothing;

  return new;
end;
$body$
$fn$;
end
$guard$;

-- Existujúci účet s info@bizagent.sk → admin (ak už je v auth/profiles).
insert into public.user_roles (user_id, role)
select p.id, 'admin'::public.app_role
from public.profiles p
where lower(coalesce(p.email, '')) in ('info@bizagent.sk', 'erikbabcan@gmail.com')
on conflict (user_id, role) do nothing;
