-- Checks the deckbuilder's search (search_cards_filtered, card_category). Needs the local catalog. Read-only, but runs
-- in a transaction that rolls back like the other checks.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

-- W=1 U=2 B=4 R=8 G=16
select chk('artifact creatures file as creatures', public.card_category('Artifact Creature — Golem') = 'creature');
select chk('artifact lands file as artifacts', public.card_category('Artifact Land') = 'artifact');
select chk('a double-faced card files by its front', public.card_category('Creature — Human // Land') = 'creature');
select chk('the subtype line is ignored', public.card_category('Enchantment — Aura Curse') = 'enchantment');

select chk('results stay inside the colours (Orzhov)',
  not exists (
    select 1 from public.search_cards_filtered('', 5::smallint, null, null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where (c.color_identity & ~5) <> 0
  ));
select chk('a type filter returns only that type',
  not exists (
    select 1 from public.search_cards_filtered('', 31::smallint, 'land', null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where public.card_category(c.type_line) <> 'land'
  ));
select chk('the top mana value means that or more',
  (select bool_and(c.mana_value >= 7) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, 'creature', 7, 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('below the top, mana value is exact',
  (select bool_and(floor(c.mana_value) = 3) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, null, 3, 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('a name that starts with the query comes first',
  (select c.name ilike 'sol %' or c.name ilike 'sol%'
   from public.search_cards_filtered('sol', 31::smallint, null, null, 7, 1, 0) s join public.cards c on c.id = s.card_id));
select chk('two letters only match name starts',
  (select bool_and(exists (select 1 from public.card_names cn where cn.card_id = s.card_id and cn.name_normalized like 'so%'))
   from public.search_cards_filtered('so', 31::smallint, null, null, 7, 60, 0) s));
select chk('only cards legal in Commander',
  not exists (
    select 1 from public.search_cards_filtered('', 31::smallint, null, null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where c.legal_commander <> 'legal'
  ));
select chk('paging continues where the last page stopped',
  (select count(*) = 0 from (
     select card_id from public.search_cards_filtered('', 31::smallint, 'land', null, 7, 20, 0)
     intersect
     select card_id from public.search_cards_filtered('', 31::smallint, 'land', null, 7, 20, 20)) overlap));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
