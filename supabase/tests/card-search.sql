-- Checks the deckbuilder's search (search_cards_filtered, card_types, card_category). Needs the local catalog.
-- Read-only, but runs in a transaction that rolls back like the other checks.
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

select chk('an artifact creature is both types', public.card_types('Artifact Creature — Golem') = array['creature', 'artifact']);
select chk('card types read the front face only', public.card_types('Creature — Human // Land') = array['creature']);
select chk('card types ignore subtypes', public.card_types('Enchantment — Aura Curse') = array['enchantment']);

select chk('results stay inside the colours (Orzhov)',
  not exists (
    select 1 from public.search_cards_filtered('', 5::smallint, null, null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where (c.color_identity & ~5) <> 0
  ));
select chk('a type filter returns only that type',
  not exists (
    select 1 from public.search_cards_filtered('', 31::smallint, array['land'], null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where not ('land' = any(public.card_types(c.type_line)))
  ));
select chk('two types narrow: every card carries both',
  (select bool_and(array['creature', 'artifact'] <@ public.card_types(c.type_line)) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, array['creature', 'artifact'], null, 7, 60, 0) s
   join public.cards c on c.id = s.card_id));
select chk('artifact alone includes artifact creatures',
  exists (
    select 1 from public.search_cards_filtered('', 31::smallint, array['artifact'], null, 7, 60, 0) s
    join public.cards c on c.id = s.card_id where 'creature' = any(public.card_types(c.type_line))
  ));
select chk('the top mana value means that or more',
  (select bool_and(c.mana_value >= 7) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, array['creature'], array[7], 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('below the top, mana value is exact',
  (select bool_and(floor(c.mana_value) = 3) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, null, array[3], 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('several mana values widen: any of them',
  (select bool_and(floor(c.mana_value) in (1, 4)) and bool_or(floor(c.mana_value) = 1) and bool_or(floor(c.mana_value) = 4)
   from public.search_cards_filtered('', 31::smallint, null, array[1, 4], 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('empty lists filter nothing',
  (select count(*) = 60 from public.search_cards_filtered('', 31::smallint, '{}', '{}', 7, 60, 0)));
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
select chk('legendary is a type filter', public.card_types('Legendary Creature — Angel') = array['legendary', 'creature']);
select chk('legendary and creature narrow to legendary creatures',
  (select bool_and(c.type_line ilike 'legendary%creature%') and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, array['legendary', 'creature'], null, 7, 60, 0) s join public.cards c on c.id = s.card_id));
select chk('commanders only returns cards that can lead a deck',
  (select bool_and(c.can_be_commander) and count(*) > 0
   from public.search_cards_filtered('', 31::smallint, null, null, 7, 60, 0, true) s join public.cards c on c.id = s.card_id));
select chk('owned ids limit the results to that collection',
  (select array_agg(s.card_id order by s.card_id) = (select array_agg(id order by id) from (
       select id from public.cards where name in ('Sol Ring', 'Arcane Signet') and deleted_at is null) o)
   from public.search_cards_filtered('', 31::smallint, null, null, 7, 60, 0, false,
     (select array_agg(id) from public.cards where name in ('Sol Ring', 'Arcane Signet') and deleted_at is null)) s));
select chk('name_asc sorts A to Z',
  (select bool_and(prev is null or prev <= name) from (
     select c.name, lag(c.name) over (order by s.ord) as prev
     from public.search_cards_filtered('', 31::smallint, array['land'], null, 7, 30, 0, false, null, 'name_asc') with ordinality s(card_id, ord)
     join public.cards c on c.id = s.card_id) x));
select chk('name_desc sorts Z to A',
  (select bool_and(prev is null or prev >= name) from (
     select c.name, lag(c.name) over (order by s.ord) as prev
     from public.search_cards_filtered('', 31::smallint, array['land'], null, 7, 30, 0, false, null, 'name_desc') with ordinality s(card_id, ord)
     join public.cards c on c.id = s.card_id) x));
select chk('a comma in the name is not needed to find it',
  exists (select 1 from public.search_cards_filtered('garruk veiled', 31::smallint) s
          join public.cards c on c.id = s.card_id where c.name = 'Garruk, Veiled Butcher'));
select chk('a hyphen in the name is not needed to find it',
  exists (select 1 from public.search_cards_filtered('high society', 31::smallint) s
          join public.cards c on c.id = s.card_id where c.name = 'High-Society Hunter'));
select chk('the picker search ignores punctuation too',
  exists (select 1 from public.search_cards('high society') s
          join public.cards c on c.id = s.card_id where c.name = 'High-Society Hunter'));
select chk('paging continues where the last page stopped',
  (select count(*) = 0 from (
     select card_id from public.search_cards_filtered('', 31::smallint, array['land'], null, 7, 20, 0)
     intersect
     select card_id from public.search_cards_filtered('', 31::smallint, array['land'], null, 7, 20, 20)) overlap));

select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
