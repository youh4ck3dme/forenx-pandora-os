-- =============================================================================
-- Overenie RLS pre public.evidence_items (po `supabase db push`).
--
-- Spustenie: Supabase Dashboard → SQL Editor → vložiť celý súbor → Run
--            (alebo: psql "$DATABASE_URL" -f supabase/verify/evidence_items_rls.sql)
--
-- Bezpečnosť: všetky testovacie dáta (2 dočasní používatelia, 3 dôkazy) vznikajú
-- v subtransakcii, ktorá sa na konci VŽDY vráti späť. V databáze nič neostane.
-- Výsledkom je tabuľka: check | status (PASS / FAIL / FINDING) | detail.
--   FAIL    = politika nechráni to, čo má
--   (od migrácie 20260927140000_evidence_ledger_worm sú hash, S3 kľúč a mazanie chránené → PASS)
-- =============================================================================

create temp table if not exists _rls_check (
  n int,
  check_name text,
  status text,
  detail text
) on commit preserve rows;
truncate _rls_check;

do $$
declare
  res text[] := '{}';
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  e_open uuid;
  e_hold uuid;
  n int;
  pol int;
  ok boolean;
begin
  -- Každý výsledok je reťazec 'check␟status␟detail' (chr(31)); pole prežije rollback.
  -- ---------------------------------------------------------------- static
  select relrowsecurity into ok from pg_class where oid = 'public.evidence_items'::regclass;
  res := res || format('RLS zapnuté%sPASS%s', chr(31), chr(31));
  if not ok then res[array_length(res, 1)] := format('RLS zapnuté%sFAIL%srelrowsecurity = false', chr(31), chr(31)); end if;

  select count(*) into pol from pg_policies where schemaname = 'public' and tablename = 'evidence_items';
  res := res || format('Počet politík%s%s%s%s politík (očakávané 4: INSERT, SELECT, UPDATE, DELETE)',
    chr(31), case when pol = 4 then 'PASS' else 'FAIL' end, chr(31), pol);

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'evidence_items' and cmd = 'ALL';
  res := res || format('Žiadna FOR ALL politika%s%s%s%s', chr(31),
    case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n || ' politík FOR ALL');

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'evidence_items'
     and (coalesce(qual, '') ilike '%true%' and coalesce(qual, '') not ilike '%auth.uid()%');
  res := res || format('Žiadna politika USING (true)%s%s%s%s', chr(31),
    case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n || ' podozrivých');

  select count(*) into n from pg_trigger
   where tgrelid = 'public.evidence_items'::regclass and not tgisinternal
     and tgname in ('evidence_items_worm_guard', 'evidence_items_delete_guard', 'evidence_items_insert_guard', 'evidence_items_audit_insert');
  res := res || format('WORM / delete / audit triggery%s%s%s%s zo 4', chr(31),
    case when n = 4 then 'PASS' else 'FAIL' end, chr(31), n);

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'evidence_items'
     and privilege_type = 'DELETE' and grantee in ('anon', 'authenticated');
  res := res || format('Priamy DELETE odobratý klientom%s%s%s%s grantov DELETE pre anon/authenticated', chr(31),
    case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);

  -- --------------------------------------------------------------- behaviour
  begin
    -- Setup ako vlastník DB (obchádza RLS), potom prepnutie na rolu authenticated.
    insert into auth.users (id, email) values
      (u1, 'rls-check-u1-' || u1 || '@invalid.local'),
      (u2, 'rls-check-u2-' || u2 || '@invalid.local');
    insert into public.evidence_items
      (investigator_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash, legal_hold)
    values
      (u1, 'RLS-CHECK', 'open.pdf', 1, 'application/pdf', 'cases/rls/open.pdf', repeat('a', 64), false)
    returning id into e_open;
    insert into public.evidence_items
      (investigator_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash, legal_hold)
    values
      (u1, 'RLS-CHECK', 'hold.pdf', 1, 'application/pdf', 'cases/rls/hold.pdf', repeat('b', 64), true)
    returning id into e_hold;

    -- anon (neprihlásený)
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    perform set_config('request.jwt.claim.sub', '', true);
    begin
      select count(*) into n from public.evidence_items where case_name = 'RLS-CHECK';
      res := res || format('anon nevidí dôkazy%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege then
      res := res || format('anon nevidí dôkazy%sPASS%sbez práva SELECT', chr(31), chr(31));
    end;

    -- u2 (iný vyšetrovateľ)
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u2::text, true);

    select count(*) into n from public.evidence_items where case_name = 'RLS-CHECK';
    res := res || format('Cudzí používateľ nevidí dôkazy%s%s%s%s riadkov', chr(31),
      case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);

    begin
      update public.evidence_items set case_name = 'HACK' where id = e_open;
      get diagnostics n = row_count;
      res := res || format('Cudzí používateľ nezmení dôkaz%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege or check_violation or raise_exception then
      res := res || format('Cudzí používateľ nezmení dôkaz%sPASS%s%s', chr(31), chr(31), 'zamietnuté: ' || sqlerrm);
    end;
    begin
      delete from public.evidence_items where id = e_open;
      get diagnostics n = row_count;
      res := res || format('Cudzí používateľ nezmaže dôkaz%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege or check_violation or raise_exception then
      res := res || format('Cudzí používateľ nezmaže dôkaz%sPASS%s%s', chr(31), chr(31), 'zamietnuté: ' || sqlerrm);
    end;

    begin
      insert into public.evidence_items
        (investigator_id, case_name, file_name, file_size, mime_type, s3_object_key, sha256_hash)
      values (u1, 'RLS-CHECK', 'spoof.pdf', 1, 'application/pdf', 'cases/rls/spoof.pdf', repeat('c', 64));
      res := res || format('Vloženie za iného vyšetrovateľa zamietnuté%sFAIL%sINSERT prešiel', chr(31), chr(31));
    exception when insufficient_privilege or check_violation then
      res := res || format('Vloženie za iného vyšetrovateľa zamietnuté%sPASS%s%s', chr(31), chr(31), sqlerrm);
    end;

    -- u1 (vlastník)
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', u1::text, true);

    select count(*) into n from public.evidence_items where case_name = 'RLS-CHECK';
    res := res || format('Vlastník vidí svoje dôkazy%s%s%s%s riadkov (očakávané 2)', chr(31),
      case when n = 2 then 'PASS' else 'FAIL' end, chr(31), n);

    begin
      update public.evidence_items set file_name = 'x.pdf' where id = e_hold;
      get diagnostics n = row_count;
      res := res || format('Legal hold: vlastník nezmení dôkaz%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege or check_violation or raise_exception then
      res := res || format('Legal hold: vlastník nezmení dôkaz%sPASS%s%s', chr(31), chr(31), 'zamietnuté: ' || sqlerrm);
    end;
    begin
      delete from public.evidence_items where id = e_hold;
      get diagnostics n = row_count;
      res := res || format('Legal hold: vlastník nezmaže dôkaz%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege or check_violation or raise_exception then
      res := res || format('Legal hold: vlastník nezmaže dôkaz%sPASS%s%s', chr(31), chr(31), 'zamietnuté: ' || sqlerrm);
    end;

    begin
      update public.evidence_items set legal_hold = false where id = e_hold;
      get diagnostics n = row_count;
      res := res || format('Legal hold: vlastník ho nezruší%s%s%s%s riadkov', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31), n);
    exception when insufficient_privilege or check_violation then
      res := res || format('Legal hold: vlastník ho nezruší%sPASS%szamietnuté', chr(31), chr(31));
    end;

    -- Forenzná integrita (bez legal hold): dá sa prepísať hash / kľúč objektu?
    begin
      update public.evidence_items
         set sha256_hash = repeat('f', 64), s3_object_key = 'cases/rls/other.pdf'
       where id = e_open;
      get diagnostics n = row_count;
      res := res || format('Nemennosť hashu a S3 kľúča%s%s%s%s', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31),
        case when n = 0 then 'zmena zamietnutá'
             else 'vlastník môže prepísať sha256_hash a s3_object_key dôkazu bez legal hold' end);
    exception when others then
      res := res || format('Nemennosť hashu a S3 kľúča%sPASS%s%s', chr(31), chr(31), sqlerrm);
    end;

    begin
      delete from public.evidence_items where id = e_open;
      get diagnostics n = row_count;
      res := res || format('Zmazanie dôkazu bez legal hold%s%s%s%s', chr(31),
        case when n = 0 then 'PASS' else 'FAIL' end, chr(31),
        case when n = 0 then 'zmazanie zamietnuté'
             else 'vlastník môže zmazať záznam z ledgeru (bez auditnej stopy)' end);
    exception when others then
      res := res || format('Zmazanie dôkazu bez legal hold%sPASS%s%s', chr(31), chr(31), sqlerrm);
    end;

    -- Vráti späť VŠETKY testovacie dáta aj prepnutie roly.
    raise exception 'rls_check_rollback' using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'rls_check_rollback' then raise; end if;
  end;

  insert into _rls_check (n, check_name, status, detail)
  select i, split_part(r, chr(31), 1), split_part(r, chr(31), 2), split_part(r, chr(31), 3)
    from unnest(res) with ordinality as t(r, i);
end $$;

select n, check_name, status, detail from _rls_check order by n;
