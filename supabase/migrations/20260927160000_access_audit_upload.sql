-- P1-04: vault access audit also covers evidence uploads.
--
-- log_case_access now accepts kind 'upload' (POST /api/vault/presign before
-- a direct-to-S3 evidence upload) in addition to 'view' and 'export'.

create or replace function public.log_case_access(
  _case_id uuid,
  _action text,
  _legal_basis text,
  _source_ip text,
  _user_agent text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _case public.cases;
begin
  if _actor is null then
    raise exception 'Chýba overenie identity.' using errcode = '42501';
  end if;
  if _action not in ('view', 'export', 'upload') then
    raise exception 'Neplatný typ prístupu (povolené: view, export, upload).'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(_legal_basis), '') = '' then
    raise exception 'Prístup k spisu vyžaduje právny základ.';
  end if;

  select * into _case from public.cases where id = _case_id;
  if not found then
    raise exception 'Prípad nebol nájdený.' using errcode = 'P0002';
  end if;

  if _case.user_id <> _actor and not public.has_role(_actor, 'admin') then
    raise exception 'Nemáte oprávnenie na túto operáciu.' using errcode = '42501';
  end if;

  insert into public.case_audit_log (user_id, case_id, action, table_name, record_id, changes)
  values (
    _case.user_id,
    _case_id,
    case _action
      when 'view' then 'case_access_view'
      when 'export' then 'case_access_export'
      else 'case_access_upload'
    end,
    'cases',
    _case_id,
    jsonb_build_object(
      'actor', _actor,
      'kind', _action,
      'legal_basis', _legal_basis,
      'source_ip', nullif(btrim(coalesce(_source_ip, '')), ''),
      'user_agent', nullif(left(coalesce(_user_agent, ''), 300), '')
    )
  );
end;
$$;

revoke all on function public.log_case_access(uuid, text, text, text, text) from public;
grant execute on function public.log_case_access(uuid, text, text, text, text) to authenticated, service_role;
