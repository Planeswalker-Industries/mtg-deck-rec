-- Local catalog required. Every fixture and config change rolls back.
\set ON_ERROR_STOP on
begin;
create temp table assertions (name text);
create function pg_temp.chk(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  insert into assertions values (label);
end $$;
do $$
declare
  -- Small distinct quantities expose duplicate folding and additive merge.
  initial_copies constant integer := 3;
  replacement_copies constant integer := 5;
  duplicate_copies constant integer := 2;
  quantity_cap_copies constant integer := 100000; -- Existing schema cap.
  expected_entries_count constant integer := 6; -- Generic, printing, finish, condition, language, other card.
  unknown_card_id constant integer := 2147483600; -- Outside the local surrogate catalog.
  old_timestamp constant timestamptz := '2000-01-01 UTC'; -- Distinguish changed metadata from transaction now().
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  invalid_printing uuid := gen_random_uuid();
  card integer;
  other_card integer;
  printing uuid;
  other_printing uuid;
  imp bigint;
  prior_import bigint;
  payload jsonb;
  totals jsonb;
  old_config jsonb;
begin
  select c.id, p.id into card, printing from public.cards c join public.printings p on p.card_id = c.id
    where c.deleted_at is null order by c.id, p.id limit 1;
  select c.id, p.id into other_card, other_printing from public.cards c join public.printings p on p.card_id = c.id
    where c.deleted_at is null and c.id <> card order by c.id, p.id limit 1;
  perform pg_temp.chk('catalog fixtures', card is not null and other_card is not null
    and not exists (select 1 from public.cards where id = unknown_card_id)
    and not exists (select 1 from public.printings where id = invalid_printing));
  insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
    values (a, 'authenticated', 'authenticated', a::text || '@test.invalid', '', now(), now()),
           (b, 'authenticated', 'authenticated', b::text || '@test.invalid', '', now(), now());
  perform set_config('request.jwt.claims', jsonb_build_object('sub', a)::text, true);
  prior_import := public.start_collection_import('text', 'merge');
  insert into public.collection_items (user_id, card_id, finish, condition, lang, quantity, import_id, updated_at)
    values (a, card, 'nonfoil', 'NM', 'en', initial_copies, prior_import, old_timestamp),
           (a, card, 'foil', 'NM', 'en', initial_copies, prior_import, old_timestamp),
           (a, card, 'etched', 'NM', 'en', initial_copies, prior_import, old_timestamp),
           (b, card, 'nonfoil', 'NM', 'en', initial_copies, null, old_timestamp);
  create temp table before_items as select ci.*, ci.ctid::text as version from public.collection_items ci where user_id in (a, b);
  payload := jsonb_build_array(
    jsonb_build_object('cardId', card, 'quantity', initial_copies),
    jsonb_build_object('cardId', card, 'finish', 'foil', 'quantity', replacement_copies),
    jsonb_build_object('cardId', card, 'printingId', printing, 'quantity', initial_copies),
    jsonb_build_object('cardId', card, 'condition', ' LP ', 'quantity', initial_copies),
    jsonb_build_object('cardId', card, 'lang', ' FR ', 'quantity', initial_copies),
    jsonb_build_object('cardId', other_card, 'quantity', initial_copies),
    jsonb_build_object('cardId', other_card, 'printingId', printing, 'quantity', duplicate_copies),
    jsonb_build_object('cardId', other_card, 'printingId', invalid_printing, 'quantity', duplicate_copies),
    jsonb_build_object('cardId', unknown_card_id, 'quantity', initial_copies));
  imp := public.start_collection_import('generic_json', 'replace');
  perform public.save_collection_rows(imp, payload);
  totals := public.commit_collection_import(imp);
  perform pg_temp.chk('unchanged full row and ctid', exists (select 1 from public.collection_items ci join before_items s on s.id = ci.id
    where ci.user_id = a and ci.finish = 'nonfoil' and ci.printing_id is null
      and ci.ctid::text = s.version and to_jsonb(ci) = to_jsonb(s) - 'version'));
  perform pg_temp.chk('changed retains ID, new version and import metadata', exists (select 1 from public.collection_items ci join before_items s on s.id = ci.id
    where ci.user_id = a and ci.finish = 'foil' and ci.quantity = replacement_copies and ci.import_id = imp
      and ci.updated_at = now() and ci.ctid::text <> s.version));
  perform pg_temp.chk('missing identity removed', not exists (select 1 from public.collection_items where user_id = a and finish = 'etched'));
  perform pg_temp.chk('all identity dimensions remain separate', (select count(*) = expected_entries_count from public.collection_items where user_id = a));
  perform pg_temp.chk('new printing records import metadata', exists (select 1 from public.collection_items where user_id = a and printing_id = printing and import_id = imp and updated_at = now()));
  perform pg_temp.chk('condition normalized', exists (select 1 from public.collection_items where user_id = a and condition = 'LP'));
  perform pg_temp.chk('language normalized', exists (select 1 from public.collection_items where user_id = a and lang = 'fr'));
  perform pg_temp.chk('invalid/mismatched/null printings fold duplicates', exists (select 1 from public.collection_items where user_id = a and card_id = other_card and printing_id is null and quantity = initial_copies + duplicate_copies + duplicate_copies));
  perform pg_temp.chk('unknown card skipped', not exists (select 1 from public.collection_items where user_id = a and card_id = unknown_card_id));
  perform pg_temp.chk('other owner physically unchanged', exists (select 1 from public.collection_items ci join before_items s on s.id = ci.id where ci.user_id = b and ci.ctid::text = s.version and to_jsonb(ci) = to_jsonb(s) - 'version'));
  perform pg_temp.chk('totals match', totals = public.my_collection_totals() and (totals ->> 'uniqueCards')::integer = duplicate_copies);
  perform pg_temp.chk('status completed', exists (select 1 from public.collection_imports where id = imp and status = 'committed' and committed_at = now()));
  perform pg_temp.chk('staging cleared', not exists (select 1 from public.collection_import_rows where import_id = imp));
  begin
    perform public.commit_collection_import(imp);
    raise exception 'repeat unexpectedly succeeded';
  exception when raise_exception then
    perform pg_temp.chk('repeat commit denied', sqlerrm = 'IMPORT_NOT_OPEN');
  end;
  create temp table stable_items as select ci.*, ci.ctid::text as version from public.collection_items ci where user_id = a;
  imp := public.start_collection_import('generic_json', 'replace');
  perform public.save_collection_rows(imp, payload);
  perform public.commit_collection_import(imp);
  perform pg_temp.chk('same replacement twice changes no physical rows or metadata', not exists (
    select 1 from public.collection_items ci full join stable_items s on s.id = ci.id
    where (ci.user_id = a or s.user_id = a) and (ci.id is null or s.id is null or ci.ctid::text <> s.version or to_jsonb(ci) <> to_jsonb(s) - 'version')));
  perform pg_temp.chk('no-op completes and clears staging', exists (select 1 from public.collection_imports where id = imp and status = 'committed') and not exists (select 1 from public.collection_import_rows where import_id = imp));
  imp := public.start_collection_import('generic_json', 'merge');
  perform public.save_collection_rows(imp, jsonb_build_array(jsonb_build_object('cardId', card, 'quantity', duplicate_copies)));
  perform public.commit_collection_import(imp);
  perform pg_temp.chk('uncapped merge adds', exists (select 1 from public.collection_items where user_id = a and card_id = card and printing_id is null and finish = 'nonfoil' and condition = 'NM' and lang = 'en' and quantity = initial_copies + duplicate_copies and import_id = imp));
  perform pg_temp.chk('merge preserves unrelated versions', not exists (select 1 from public.collection_items ci join stable_items s on s.id = ci.id where ci.user_id = a and (ci.printing_id is not null or ci.finish <> 'nonfoil' or ci.condition <> 'NM' or ci.lang <> 'en' or ci.card_id <> card) and (ci.ctid::text <> s.version or to_jsonb(ci) <> to_jsonb(s) - 'version')));
  imp := public.start_collection_import('generic_json', 'merge');
  perform public.save_collection_rows(imp, jsonb_build_array(jsonb_build_object('cardId', card, 'quantity', quantity_cap_copies), jsonb_build_object('cardId', card, 'quantity', quantity_cap_copies)));
  perform public.commit_collection_import(imp);
  perform pg_temp.chk('duplicate aggregate and merge capped', exists (select 1 from public.collection_items where user_id = a and card_id = card and printing_id is null and finish = 'nonfoil' and condition = 'NM' and lang = 'en' and quantity = quantity_cap_copies and import_id = imp));
  truncate stable_items;
  insert into stable_items select ci.*, ci.ctid::text from public.collection_items ci where user_id = a;
  imp := public.start_collection_import('generic_json', 'merge');
  perform public.save_collection_rows(imp, jsonb_build_array(jsonb_build_object('cardId', card, 'quantity', duplicate_copies)));
  perform public.commit_collection_import(imp);
  perform pg_temp.chk('already capped merge physically no-op', not exists (select 1 from public.collection_items ci join stable_items s on s.id = ci.id where ci.ctid::text <> s.version or to_jsonb(ci) <> to_jsonb(s) - 'version'));
  imp := public.start_collection_import('text', 'replace');
  perform public.commit_collection_import(imp);
  perform pg_temp.chk('empty replace empties own collection and totals', not exists (select 1 from public.collection_items where user_id = a) and (public.my_collection_totals() ->> 'totalQuantity')::integer = 0);
  insert into public.collection_items (user_id, card_id, finish, condition, lang, quantity, import_id, updated_at)
    values (a, card, 'etched', 'NM', 'en', initial_copies, prior_import, old_timestamp),
           (a, card, 'foil', 'NM', 'en', initial_copies, prior_import, old_timestamp);
  create temp table failed_items as select ci.*, ci.ctid::text as version from public.collection_items ci where user_id = a;
  imp := public.start_collection_import('generic_json', 'replace');
  perform public.save_collection_rows(imp, payload);
  select value into old_config from public.app_config where key = 'collections';
  update public.app_config set value = jsonb_set(value, '{maxEntries}', '1') where key = 'collections';
  create temp table failed_import as select i.*, i.ctid::text as version from public.collection_imports i where id = imp;
  create temp table failed_staging as select r.*, r.ctid::text as version from public.collection_import_rows r where import_id = imp;
  begin
    perform public.commit_collection_import(imp);
    raise exception 'limit unexpectedly succeeded';
  exception when raise_exception then
    perform pg_temp.chk('maxEntries exception', sqlerrm = 'COLLECTION_TOO_LARGE');
  end;
  perform pg_temp.chk('failed replace deletes, updates and inserts physically rolled back', not exists (
    select 1 from public.collection_items ci full join failed_items s on s.id = ci.id
    where (ci.user_id = a or s.user_id = a) and (ci.id is null or s.id is null or ci.ctid::text <> s.version or to_jsonb(ci) <> to_jsonb(s) - 'version')));
  perform pg_temp.chk('failed import metadata and version rolled back', exists (select 1 from public.collection_imports i join failed_import s on s.id = i.id where i.ctid::text = s.version and to_jsonb(i) = to_jsonb(s) - 'version'));
  perform pg_temp.chk('failed staging fully preserved', (select count(*) from public.collection_import_rows where import_id = imp) = jsonb_array_length(payload) and not exists (
    select 1 from public.collection_import_rows r full join failed_staging s on r.ctid::text = s.version
    where (r.import_id = imp or s.import_id = imp) and (r.import_id is null or s.import_id is null or to_jsonb(r) <> to_jsonb(s) - 'version')));
  update public.app_config set value = old_config where key = 'collections';
  -- A merge limit failure must also undo existing-row updates, not just inserts.
  perform public.commit_collection_import(imp);
  truncate stable_items;
  insert into stable_items select ci.*, ci.ctid::text from public.collection_items ci where user_id = a;
  imp := public.start_collection_import('generic_json', 'merge');
  perform public.save_collection_rows(imp, payload);
  update public.app_config set value = jsonb_set(value, '{maxEntries}', '1') where key = 'collections';
  begin
    perform public.commit_collection_import(imp);
    raise exception 'limit unexpectedly succeeded';
  exception when raise_exception then
    perform pg_temp.chk('merge maxEntries exception', sqlerrm = 'COLLECTION_TOO_LARGE');
  end;
  perform pg_temp.chk('failed merge updates physically rolled back', not exists (select 1 from public.collection_items ci join stable_items s on s.id = ci.id where ci.ctid::text <> s.version or to_jsonb(ci) <> to_jsonb(s) - 'version'));
  perform pg_temp.chk('failed merge import and staging preserved', exists (select 1 from public.collection_imports where id = imp and status = 'open' and committed_at is null) and (select count(*) from public.collection_import_rows where import_id = imp) = jsonb_array_length(payload));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', b)::text, true);
  begin
    perform public.commit_collection_import(imp);
    raise exception 'cross-owner unexpectedly succeeded';
  exception when raise_exception then perform pg_temp.chk('cross-owner denied', sqlerrm = 'IMPORT_NOT_OPEN'); end;
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.commit_collection_import(imp);
    raise exception 'no-auth unexpectedly succeeded';
  exception when raise_exception then perform pg_temp.chk('no auth denied', sqlerrm = 'NOT_SIGNED_IN'); end;
  perform pg_temp.chk('authenticated and service execute only', has_function_privilege('authenticated', 'public.commit_collection_import(bigint)', 'EXECUTE') and has_function_privilege('service_role', 'public.commit_collection_import(bigint)', 'EXECUTE') and not has_function_privilege('anon', 'public.commit_collection_import(bigint)', 'EXECUTE'));
  update public.app_config set value = old_config where key = 'collections';
  perform set_config('request.jwt.claims', jsonb_build_object('sub', a)::text, true);
  create temp table execution_import (id bigint);
  insert into execution_import values (public.start_collection_import('text', 'merge'));
  grant select on execution_import to authenticated;
end $$;
set local role authenticated;
do $$ begin
  if public.commit_collection_import((select id from execution_import)) is distinct from public.my_collection_totals() then
    raise exception 'FAIL: authenticated commit totals';
  end if;
end $$;
reset role;
select pg_temp.chk('authenticated executes commit with isolated totals', true);
set local role anon;
do $$ begin
  perform public.commit_collection_import(0);
  raise exception 'anon unexpectedly succeeded';
exception when insufficient_privilege then null;
end $$;
reset role;
select pg_temp.chk('anon execution denied', true);
select count(*) as passed_assertions from assertions;
rollback;
