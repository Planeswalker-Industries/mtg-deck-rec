-- Shared collections: private until the owner shares, readable by anyone while shared, and the same link after sharing
-- is turned off and on again. Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;
create temp table codes (label text, code text);
grant all on codes to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
values
  ('eeeeeeee-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'share-owner@test.invalid', '', now(), now()),
  ('eeeeeeee-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'share-friend@test.invalid', '', now(), now());

insert into public.collection_items (user_id, card_id, finish, condition, lang, quantity)
select 'eeeeeeee-0000-4000-8000-000000000001', c.id, 'nonfoil', 'NM', 'en', 3
from public.cards c where c.deleted_at is null and c.name = 'Sol Ring' limit 1;

-- === signed out, before the owner shares ===
set local role anon;
do $$
begin
  perform public.set_collection_sharing(true);
  perform chk('anon cannot share', false, 'it answered');
exception when others then
  perform chk('anon cannot share', true, sqlerrm);
end;
$$;
select chk('anon cannot read collection_shares',
           not has_table_privilege('anon', 'public.collection_shares', 'select'));
reset role;

-- === the owner shares ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';
select chk('nothing to report before sharing', public.my_collection_sharing() is null);
insert into codes select 'first', public.set_collection_sharing(true) ->> 'code';
select chk('sharing reports itself on', (public.my_collection_sharing() ->> 'shared')::boolean);
select chk('the owner''s own link is mine', public.collection_share_status((select code from codes)) = 'mine');
reset role;

-- === signed out, while shared ===
set local role anon;
set local request.jwt.claims = '{}';
select chk('a stranger sees a shared link as shared', public.collection_share_status((select code from codes)) = 'shared');
select chk('a stranger reads the shared entries',
           (public.shared_collection((select code from codes)) -> 'entries' -> 0 ->> 'quantity')::integer = 3);
select chk('an unknown code is nothing', public.shared_collection('zzzzzzzzzzzz') is null
           and public.collection_share_status('zzzzzzzzzzzz') is null);
reset role;

-- === the owner turns sharing off ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';
select chk('turning off keeps the code', public.set_collection_sharing(false) ->> 'code' = (select code from codes));
select chk('the owner''s own link is still mine', public.collection_share_status((select code from codes)) = 'mine');
reset role;

-- === another signed-in player, while not shared ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000002"}';
select chk('a friend gets nothing while not shared', public.shared_collection((select code from codes)) is null);
select chk('a friend sees no status while not shared', public.collection_share_status((select code from codes)) is null);
reset role;

-- === the owner turns sharing back on ===
set local role authenticated;
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-4000-8000-000000000001"}';
select chk('turning on again brings back the same code', public.set_collection_sharing(true) ->> 'code' = (select code from codes));
reset role;

select name, case when ok then 'pass' else 'FAIL' end as result, detail from t order by name;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
