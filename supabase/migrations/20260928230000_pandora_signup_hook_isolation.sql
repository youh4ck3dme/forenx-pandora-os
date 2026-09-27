-- Isolation of Pandora's signup hook from other applications in a shared database.
--
-- Until now Pandora used the Supabase-template names public.handle_new_user() and
-- trigger auth.users.on_auth_user_created. In a database shared with another app
-- (e.g. whoiswho.at) these names can belong to that app: CREATE OR REPLACE would
-- overwrite its signup logic and every signup there would create Pandora profiles.
--
-- After this migration Pandora uses ONLY its own objects:
--   function public.pandora_handle_new_user()
--   trigger  auth.users.pandora_on_auth_user_created
-- The legacy trigger on_auth_user_created is retired only when it provably belongs
-- to Pandora (its function writes both public.profiles and public.user_roles).
-- A foreign trigger/function is left untouched. Nothing is dropped from another app.
-- Both hooks are idempotent (ON CONFLICT DO NOTHING), so running side by side is safe.

create or replace function public.pandora_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.pandora_handle_new_user() from public, anon, authenticated;

drop trigger if exists pandora_on_auth_user_created on auth.users;
create trigger pandora_on_auth_user_created
after insert on auth.users
for each row execute function public.pandora_handle_new_user();

-- Retire the legacy trigger only if it is Pandora's own.
do $$
declare
  _fn oid;
  _src text;
begin
  select t.tgfoid into _fn
    from pg_trigger t
   where t.tgrelid = 'auth.users'::regclass
     and t.tgname = 'on_auth_user_created'
     and not t.tgisinternal;
  if _fn is null then
    return;
  end if;

  select p.prosrc into _src from pg_proc p where p.oid = _fn;
  if _fn = to_regprocedure('public.handle_new_user()')
     and _src like '%public.profiles%'
     and _src like '%public.user_roles%' then
    begin
      drop trigger on_auth_user_created on auth.users;
      raise notice 'pandora: retired legacy trigger on_auth_user_created (replaced by pandora_on_auth_user_created)';
    exception when insufficient_privilege then
      -- Not the owner of auth.users: both idempotent hooks keep running side by side.
      raise notice 'pandora: cannot drop on_auth_user_created (insufficient privilege); both hooks remain, results are idempotent';
    end;
  else
    raise notice 'pandora: on_auth_user_created belongs to another application; left untouched';
  end if;
end $$;
