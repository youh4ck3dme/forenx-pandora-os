-- Pandora DB preflight (READ-ONLY; vygenerované 2026-09-27T17:20:42.064Z z 24 migrácií)
-- Mení iba dočasné tabuľky tejto session. Spustenie: SQL Editor alebo psql -f.

create temp table if not exists _pf_local (version text primary key, file text) on commit preserve rows;
create temp table if not exists _pf_obj (version text, kind text, name text, safe boolean, columns text[], target text) on commit preserve rows;
create temp table if not exists _pf_known (name text primary key) on commit preserve rows;
create temp table if not exists _pf_result (n serial, check_name text, status text, detail text) on commit preserve rows;
truncate _pf_local, _pf_obj, _pf_known, _pf_result;

insert into _pf_local (version, file) values
  ('20260915190356', '20260915190356_8c26b7d6-0a53-4765-a67c-8c4d8e2f20e0.sql'),
  ('20260916150741', '20260916150741_50cb881c-1663-4f3a-b792-4aebcecec5f6.sql'),
  ('20260916151306', '20260916151306_bd620097-876e-4494-adef-f027bd3690d3.sql'),
  ('20260916151341', '20260916151341_8533205f-9c23-465e-bfcc-b3576bd5da60.sql'),
  ('20260916151453', '20260916151453_89f7e1cf-1caa-46fe-98fa-f328b7216d37.sql'),
  ('20260916160736', '20260916160736_da047fbc-4b0f-4c5e-830b-50db746ad592.sql'),
  ('20260916194748', '20260916194748_143738c5-5035-4b43-9084-e12cf2fd46b0.sql'),
  ('20260917193202', '20260917193202_6679e439-7f2a-4ebc-81a4-8adeab156f04.sql'),
  ('20260920021805', '20260920021805_7fbcaef1-96c5-4e67-834b-c605a810c823.sql'),
  ('20260920021841', '20260920021841_e7bc1478-9322-4acb-8a3b-aef44cffeda3.sql'),
  ('20260921040519', '20260921040519_63e51aba-932c-4c05-9ba7-fb3d8a0b3b6e.sql'),
  ('20260921040609', '20260921040609_bdc8c677-043f-45c3-b220-d0a3b892948e.sql'),
  ('20260925140000', '20260925140000_avatars_storage_bucket.sql'),
  ('20260925143000', '20260925143000_admin_email_bizagent.sql'),
  ('202609270001', '202609270001_atomic_ai_graph.sql'),
  ('20260927120000', '20260927120000_court_ready_evidence_ledger.sql'),
  ('20260927130000', '20260927130000_forensic_integrity.sql'),
  ('20260927140000', '20260927140000_case_lifecycle_legal_hold.sql'),
  ('20260927150000', '20260927150000_access_audit_log.sql'),
  ('20260927160000', '20260927160000_access_audit_upload.sql'),
  ('20260927234500', '20260927234500_evidence_ledger_worm.sql'),
  ('20260927235000', '20260927235000_harden_case_lifecycle_guard.sql'),
  ('20260928000000', '20260928000000_evidence_unique_key.sql'),
  ('20260928000100', '20260928000100_operational_metrics.sql');
insert into _pf_obj (version, kind, name, safe, columns, target) values
  ('20260915190356', 'table', 'user_roles', false, array['id', 'user_id', 'role', 'created_at']::text[], null),
  ('20260915190356', 'table', 'profiles', false, array['id', 'email', 'full_name', 'avatar_url', 'onboarding_completed', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'cases', false, array['id', 'user_id', 'name', 'subtitle', 'reference_date', 'europol_serials', 'valid_licences', 'orsr_addresses', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'case_entities', false, array['id', 'case_id', 'user_id', 'name', 'kind', 'role', 'ico', 'address', 'registered_address', 'licence', 'incorporated_at', 'physical_inventory', 'responsive', 'country', 'x', 'y', 'note', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'case_transactions', false, array['id', 'case_id', 'user_id', 'date', 'amount', 'method', 'from_id', 'to_id', 'payer_id', 'origin_country', 'destination_country', 'description', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'case_weapons', false, array['id', 'case_id', 'user_id', 'brand', 'model', 'serial', 'holder_id', 'supplier_id', 'acquired_at', 'licence', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'case_relations', false, array['id', 'case_id', 'user_id', 'from_id', 'to_id', 'label', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'table', 'case_events', false, array['id', 'case_id', 'user_id', 'date', 'title', 'detail', 'severity', 'created_at', 'updated_at']::text[], null),
  ('20260915190356', 'function', 'has_role', false, null, null),
  ('20260915190356', 'function', 'update_updated_at_column', false, null, null),
  ('20260915190356', 'function', 'handle_new_user', false, null, null),
  ('20260915190356', 'trigger', 'update_profiles_updated_at', false, null, 'public.profiles'),
  ('20260915190356', 'trigger', 'on_auth_user_created', false, null, 'auth.users'),
  ('20260915190356', 'trigger', 'update_cases_updated_at', false, null, 'public.cases'),
  ('20260915190356', 'trigger', 'update_case_entities_updated_at', false, null, 'public.case_entities'),
  ('20260915190356', 'trigger', 'update_case_transactions_updated_at', false, null, 'public.case_transactions'),
  ('20260915190356', 'trigger', 'update_case_weapons_updated_at', false, null, 'public.case_weapons'),
  ('20260915190356', 'trigger', 'update_case_relations_updated_at', false, null, 'public.case_relations'),
  ('20260915190356', 'trigger', 'update_case_events_updated_at', false, null, 'public.case_events'),
  ('20260916150741', 'table', 'ai_feature_logs', true, array['id', 'created_at', 'feature', 'input_summary', 'output_summary', 'success', 'error_message', 'duration_ms', 'provider', 'model', 'user_id']::text[], null),
  ('20260916150741', 'function', 'db_health_stats', false, null, null),
  ('20260916151306', 'table', 'case_imports', true, array['id', 'case_id', 'user_id', 'filename', 'byte_size', 'sha256', 'parser_version', 'delimiter', 'decimal_separator', 'date_format', 'encoding', 'column_mapping', 'total_rows', 'valid_rows', 'error_rows', 'partial', 'status', 'error_detail', 'original_stored', 'storage_path', 'created_at', 'updated_at']::text[], null),
  ('20260916151306', 'table', 'case_audit_log', true, array['id', 'user_id', 'case_id', 'table_name', 'record_id', 'action', 'changes', 'created_at']::text[], null),
  ('20260916151306', 'table', 'ai_usage', true, array['id', 'user_id', 'case_id', 'task', 'model', 'prompt_version', 'input_revision', 'status', 'error_code', 'prompt_tokens', 'completion_tokens', 'created_at', 'finished_at']::text[], null),
  ('20260916151306', 'table', 'deletion_requests', true, array['id', 'user_id', 'scope', 'status', 'steps', 'error_detail', 'created_at', 'finished_at']::text[], null),
  ('20260916151306', 'table', 'subscriptions', true, array['id', 'user_id', 'environment', 'provider', 'customer_id', 'subscription_id', 'price_id', 'plan', 'status', 'current_period_end', 'cancel_at_period_end', 'last_event_at', 'created_at', 'updated_at']::text[], null),
  ('20260916151306', 'table', 'billing_events', true, array['id', 'event_id', 'provider', 'type', 'user_id', 'event_created_at', 'result', 'processed_at', 'created_at']::text[], null),
  ('20260916151306', 'table', 'company_registry_profiles', true, array['id', 'case_id', 'user_id', 'entity_id', 'ico', 'legal_name', 'legal_form', 'registered_address', 'country', 'status', 'incorporated_at', 'dissolved_at', 'statutory_persons', 'business_activities', 'address_history', 'source', 'source_url', 'source_hash', 'captured_at', 'raw_payload', 'created_at']::text[], null),
  ('20260916151306', 'table', 'cross_border_analyses', true, array['id', 'case_id', 'user_id', 'report_id', 'source', 'captured_at', 'countries', 'routes', 'intermediaries', 'signals', 'nominee_indicators', 'source_url', 'source_hash', 'raw_payload', 'created_at']::text[], null),
  ('20260916151306', 'function', 'bump_revision', false, null, null),
  ('20260916151306', 'function', 'current_plan', false, null, null),
  ('20260916151306', 'function', 'reserve_ai_call', false, null, null),
  ('20260916151306', 'function', 'commit_import', false, null, null),
  ('20260917193202', 'table', 'error_logs', false, array['id', 'created_at', 'route', 'user_id', 'message', 'stack', 'severity', 'source']::text[], null),
  ('20260920021805', 'function', 'owns_case', false, null, null),
  ('20260921040609', 'function', 'db_health_stats', false, null, null),
  ('20260925143000', 'function', 'handle_new_user', false, null, null),
  ('202609270001', 'function', 'commit_ai_case_graph', false, null, null),
  ('20260927120000', 'table', 'evidence_items', false, array['id', 'investigator_id', 'case_name', 'file_name', 'file_size', 'mime_type', 's3_object_key', 'sha256_hash', 'legal_hold', 'created_at', 'updated_at']::text[], null),
  ('20260927120000', 'function', 'update_evidence_updated_at', false, null, null),
  ('20260927120000', 'trigger', 'evidence_items_updated_at', false, null, 'public.evidence_items'),
  ('20260927130000', 'table', 'source_snapshots', true, array['id', 'case_id', 'user_id', 'source', 'source_url', 'http_status', 'retrieved_at', 'content_type', 'parser_version', 'raw_sha256', 'byte_size', 'storage_ref', 'etag', 'last_modified', 'created_at']::text[], null),
  ('20260927130000', 'function', 'audit_event_hash', false, null, null),
  ('20260927130000', 'function', 'case_audit_log_chain', false, null, null),
  ('20260927130000', 'function', 'case_audit_log_append_only', false, null, null),
  ('20260927130000', 'function', 'erase_user_audit_log', false, null, null),
  ('20260927130000', 'function', 'verify_audit_chain', false, null, null),
  ('20260927130000', 'function', 'append_audit_event', false, null, null),
  ('20260927130000', 'function', 'source_snapshots_immutable', false, null, null),
  ('20260927130000', 'function', 'case_relations_history_guard', false, null, null),
  ('20260927130000', 'function', 'relation_evidence_hash', false, null, null),
  ('20260927130000', 'function', 'commit_ai_case_graph', false, null, null),
  ('20260927130000', 'function', 'commit_import', false, null, null),
  ('20260927140000', 'function', 'case_status_transition_ok', false, null, null),
  ('20260927140000', 'function', 'set_case_status', false, null, null),
  ('20260927140000', 'function', 'destroy_case', false, null, null),
  ('20260927140000', 'function', 'enforce_case_lifecycle_child', false, null, null),
  ('20260927140000', 'function', 'enforce_case_lifecycle_case_update', false, null, null),
  ('20260927140000', 'function', 'enforce_case_lifecycle_case_delete', false, null, null),
  ('20260927150000', 'function', 'log_case_access', false, null, null),
  ('20260927160000', 'function', 'log_case_access', false, null, null),
  ('20260927234500', 'function', 'evidence_items_insert_guard', false, null, null),
  ('20260927234500', 'function', 'evidence_items_worm_guard', false, null, null),
  ('20260927234500', 'function', 'evidence_items_delete_guard', false, null, null),
  ('20260927234500', 'function', 'evidence_items_audit_insert', false, null, null),
  ('20260927234500', 'function', 'delete_evidence_item_audited', false, null, null),
  ('20260927234500', 'function', 'record_evidence_verification', false, null, null),
  ('20260927234500', 'function', 'case_audit_log_append_only', false, null, null),
  ('20260927235000', 'function', 'case_lifecycle_rpc_active', false, null, null),
  ('20260927235000', 'function', 'enforce_case_lifecycle_case_update', false, null, null),
  ('20260927235000', 'function', 'enforce_case_lifecycle_case_delete', false, null, null),
  ('20260927235000', 'function', 'enforce_case_lifecycle_case_insert', false, null, null),
  ('20260928000100', 'function', 'health_metrics', false, null, null);
insert into _pf_known (name) values ('ai_feature_logs'), ('ai_usage'), ('billing_events'), ('case_audit_log'), ('case_entities'), ('case_events'), ('case_imports'), ('case_relations'), ('case_transactions'), ('case_weapons'), ('cases'), ('company_registry_profiles'), ('cross_border_analyses'), ('deletion_requests'), ('error_logs'), ('evidence_items'), ('profiles'), ('source_snapshots'), ('subscriptions'), ('user_roles');

do $pf$
declare
  _has_history boolean := to_regclass('supabase_migrations.schema_migrations') is not null;
  _hook_hashes text[] := array['0248868212ba18dc2a56835ccb041efc', '61da00d897181d13de4eef8d1f4f3895']::text[];
  _pending text[] := '{}';
  _n int;
  _list text;
  _src text;
  _missing text[];
  _hnu_foreign boolean := false;
  r record;
begin
  -- 1. História migrácií
  if _has_history then
    execute 'select coalesce(array_agg(l.version order by l.version), ''{}'') from _pf_local l
             where l.version not in (select version from supabase_migrations.schema_migrations)'
      into _pending;
    insert into _pf_result (check_name, status, detail) values
      ('História migrácií', 'PASS', 'supabase_migrations.schema_migrations nájdená'),
      ('Čakajúce migrácie', case when cardinality(_pending) = 0 then 'PASS' else 'INFO' end,
       case when cardinality(_pending) = 0 then 'žiadne' else cardinality(_pending) || ': ' || array_to_string(_pending, ', ') end);
    execute 'select string_agg(version, '', '' order by version) from supabase_migrations.schema_migrations
             where version not in (select version from _pf_local)' into _list;
    if _list is not null then
      insert into _pf_result (check_name, status, detail) values
        ('Migrácie na DB, ktoré repo nepozná', 'WARN', _list || ' (iná appka alebo ručné zmeny — db push ich nahlási)');
    end if;
  else
    select array_agg(version order by version) into _pending from _pf_local;
    insert into _pf_result (check_name, status, detail) values
      ('História migrácií', 'WARN', 'supabase_migrations.schema_migrations neexistuje — všetky migrácie sa považujú za čakajúce');
  end if;

  -- 2. Existujúce tabuľky, ktoré čakajúce migrácie zakladajú
  for r in
    select o.version, o.name, o.safe, o.columns from _pf_obj o
     where o.kind = 'table' and o.version = any (_pending)
       and to_regclass('public.' || quote_ident(o.name)) is not null
  loop
    select coalesce(array_agg(c), '{}') into _missing
      from unnest(r.columns) c
     where not exists (select 1 from information_schema.columns ic
                        where ic.table_schema = 'public' and ic.table_name = r.name and ic.column_name = c);
    if not r.safe then
      insert into _pf_result (check_name, status, detail) values
        ('Kolízia tabuľky ' || r.name, 'FAIL', r.version || ': CREATE TABLE bez IF NOT EXISTS, tabuľka už existuje → db push zlyhá');
    elsif cardinality(_missing) > 0 then
      insert into _pf_result (check_name, status, detail) values
        ('Cudzia tabuľka ' || r.name, 'FAIL', r.version || ': tabuľka existuje s inou schémou (chýba ' || array_to_string(_missing, ', ')
         || ') — IF NOT EXISTS ju preskočí, no migrácia na nej vytvorí indexy/politiky/triggery');
    else
      insert into _pf_result (check_name, status, detail) values
        ('Existujúca tabuľka ' || r.name, 'WARN', r.version || ': už existuje so zhodnými stĺpcami; migrácia na nej vytvorí indexy/politiky/triggery — over, že je Pandorina');
    end if;
  end loop;

  -- 3. Triggery z čakajúcich migrácií (bez DROP IF EXISTS), ktoré už existujú → push zlyhá
  for r in
    select o.version, o.name, o.target from _pf_obj o
     where o.kind = 'trigger' and o.version = any (_pending)
       and to_regclass(o.target) is not null
       and exists (select 1 from pg_trigger t where t.tgrelid = to_regclass(o.target) and t.tgname = o.name and not t.tgisinternal)
  loop
    insert into _pf_result (check_name, status, detail) values
      ('Kolízia triggera ' || r.name, 'FAIL', r.version || ': CREATE TRIGGER na ' || r.target || ', trigger už existuje → db push zlyhá');
  end loop;

  -- 4. public.handle_new_user(): Pandorina iba pri presnej zhode tela so známou verziou
  if to_regprocedure('public.handle_new_user()') is not null then
    select prosrc into _src from pg_proc where oid = to_regprocedure('public.handle_new_user()');
    if md5(btrim(regexp_replace(_src, '[[:space:]]+', ' ', 'g'))) = any (_hook_hashes) then
      insert into _pf_result (check_name, status, detail) values
        ('public.handle_new_user()', 'PASS', 'známa Pandorina verzia');
    else
      _hnu_foreign := true;
      if exists (select 1 from _pf_obj o where o.kind = 'function' and o.name = 'handle_new_user'
                  and not o.safe and o.version = any (_pending)) then
        select string_agg(o.version, ', ') into _list from _pf_obj o
         where o.kind = 'function' and o.name = 'handle_new_user' and not o.safe and o.version = any (_pending);
        insert into _pf_result (check_name, status, detail) values
          ('public.handle_new_user()', 'FAIL', 'patrí inej appke a čakajúca migrácia ' || _list || ' ju nepodmienene prepíše');
      else
        insert into _pf_result (check_name, status, detail) values
          ('public.handle_new_user()', 'WARN', 'patrí inej appke — žiadna čakajúca migrácia ju nepodmienene neprepíše; Pandora používa pandora_handle_new_user()');
      end if;
    end if;
  end if;

  -- 5. Ďalšie funkcie, ktoré čakajúce migrácie nepodmienene prepíšu
  select string_agg(distinct o.name, ', ') into _list from _pf_obj o
   where o.kind = 'function' and not o.safe and o.version = any (_pending)
     and not (o.name = 'handle_new_user' and _hnu_foreign)
     and exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                  where ns.nspname = 'public' and p.proname = o.name);
  if _list is not null then
    insert into _pf_result (check_name, status, detail) values
      ('Existujúce funkcie, ktoré push prepíše', 'WARN', _list || ' — over, že patria Pandore');
  end if;

  -- 6. Triggery na auth.users
  for r in
    select t.tgname, p.proname, n.nspname, p.prosrc
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
     where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal
     order by t.tgname
  loop
    if r.nspname = 'public' and md5(btrim(regexp_replace(r.prosrc, '[[:space:]]+', ' ', 'g'))) = any (_hook_hashes) then
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'PASS', 'Pandora → ' || r.nspname || '.' || r.proname);
    else
      insert into _pf_result (check_name, status, detail) values
        ('auth.users trigger ' || r.tgname, 'WARN', 'cudzí → ' || r.nspname || '.' || r.proname || ' (zdieľaná DB; Pandora ho nemení)');
    end if;
  end loop;

  -- 7. Cudzie tabuľky v public → zdieľaná databáza
  select count(*), string_agg(c.relname, ', ' order by c.relname) into _n, _list
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and c.relname not in (select name from _pf_known);
  insert into _pf_result (check_name, status, detail) values
    ('Zdieľaná databáza', case when _n = 0 then 'PASS' else 'WARN' end,
     case when _n = 0 then 'v public sú iba tabuľky známe z migrácií Pandory'
          else _n || ' cudzích tabuliek: ' || left(_list, 400) end);

  -- 8. Používatelia bez Pandora profilu
  if to_regclass('public.profiles') is not null then
    execute 'select count(*) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)' into _n;
    insert into _pf_result (check_name, status, detail) values
      ('auth.users bez Pandora profilu', case when _n = 0 then 'PASS' else 'INFO' end, _n || ' používateľov');
  end if;

  -- Verdikt
  select case
           when exists (select 1 from _pf_result where status = 'FAIL') then 'NO-GO'
           when exists (select 1 from _pf_result where status = 'WARN') then 'GO S VAROVANÍM'
           else 'GO' end
    into _list;
  insert into _pf_result (check_name, status, detail) values
    ('VERDIKT', _list, case _list
       when 'NO-GO' then 'db push by zlyhal alebo poškodil cudzie objekty — vyrieš FAIL riadky'
       when 'GO S VAROVANÍM' then 'push je technicky možný; posúď každé WARN (zdieľaná DB)'
       else 'push je bezpečný' end);
end
$pf$;

select n, check_name, status, detail from _pf_result order by n;
