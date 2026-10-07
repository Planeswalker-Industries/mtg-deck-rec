-- Bracket rules and combos (T060): app_config.brackets, bracket_cards() and serving_deck_combos(). Needs the local
-- catalog and a collated, precomputed Commander Spellbook (spellbook_combo_pieces and spellbook_combo_details).
-- Runs in a transaction and rolls back, so it leaves nothing behind.
\set ON_ERROR_STOP on
begin;

create temp table t (name text, ok boolean, detail text);
grant all on t to authenticated, anon;
create or replace function chk(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into t values (p_name, coalesce(p_ok, false), p_detail); $$;

select chk('the bracket rules hold the owner''s answers',
  (select value -> 'maxExtraTurnCards' = '{"1": 0, "2": 2, "3": 2}'::jsonb
          and (value ->> 'massLandDenialFromBracket')::int = 4
          and value -> 'massLandDenialTagIds' ? 'cd12a44c-1aee-4ece-b8ea-3eb118ef0230'
          and value -> 'extraTurnTagIds' ? '03b17ebf-f5d3-4063-bfd4-1ae156a16a8f'
          and is_public
     from public.app_config where key = 'brackets'));
select chk('the combo group is configured', (select value -> 'combos' ? 'resultClasses' from public.app_config where key = 'scoring'));

select public.bracket_cards() as watched \gset
select chk('mass land denial and extra turns are watched',
  jsonb_array_length(:'watched'::jsonb -> 'massLandDenial') > 0 and jsonb_array_length(:'watched'::jsonb -> 'extraTurns') > 0);
select chk('Armageddon is mass land denial and Time Warp an extra turn',
  (:'watched'::jsonb -> 'massLandDenial') @> to_jsonb((select id from public.cards where slug = 'armageddon'))
  and (:'watched'::jsonb -> 'extraTurns') @> to_jsonb((select id from public.cards where slug = 'time-warp')));
select chk('planeswalkers are left out',
  not exists (
    select 1 from jsonb_array_elements_text((:'watched'::jsonb -> 'massLandDenial') || (:'watched'::jsonb -> 'extraTurns')) as x
    join public.cards c on c.id = x::int where c.type_line ilike '%Planeswalker%'));

-- A two-card combo with no commander piece and no template, and a pair of its pieces' ids.
select c.variant_id as v, c.card_ids[1] as p1, c.card_ids[2] as p2, c.min_bracket as mb
from corpus.spellbook_combos c
where cardinality(c.card_ids) = 2 and cardinality(c.commander_card_ids) = 0 and cardinality(c.template_names) = 0
  and not exists (select 1 from public.cards x where x.id = any (c.card_ids) and (x.game_changer or x.legal_commander <> 'legal'))
order by c.variant_id
limit 1
\gset
-- A commander that can hold both pieces: the five-colour mask is any commander of all colours.
select (select id from public.cards where can_be_commander and color_identity = 31 and legal_commander = 'legal' and deleted_at is null order by id limit 1) as five \gset

select chk('a deck holding both pieces holds the combo',
  exists (select 1 from public.serving_deck_combos(array[:p1, :p2], array[:five], '{}', true, false) s
          where s.variant_id = :'v' and s.missing is null and s.card is null));
select chk('a deck holding one piece is one card short, with the missing card whole',
  exists (select 1 from public.serving_deck_combos(array[:p1], array[:five]) s
          where s.variant_id = :'v' and s.missing = :p2 and (s.card).card_id = :p2 and (s.card).name is not null));
select chk('without p_near only complete combos come back',
  not exists (select 1 from public.serving_deck_combos(array[:p1], array[:five], '{}', true, false) s where s.missing is not null));
select chk('a missing card the deck leaves out is not offered',
  not exists (select 1 from public.serving_deck_combos(array[:p1], array[:five], array[:p2]) s where s.variant_id = :'v'));
select chk('a missing card outside the commanders'' colours is not offered',
  not exists (
    select 1 from public.serving_deck_combos(array[:p1], array[(select id from public.cards where can_be_commander and color_identity = 0 and legal_commander = 'legal' and deleted_at is null order by id limit 1)]) s
    join public.cards c on c.id = s.missing
    where c.color_identity <> 0));
select chk('results come with the combo', exists (
  select 1 from public.serving_deck_combos(array[:p1, :p2], array[:five], '{}', true, false) s
  join corpus.spellbook_combos c on c.variant_id = s.variant_id
  where s.variant_id = :'v' and s.results = c.results and s.min_bracket = c.min_bracket));

-- A combo that needs its piece to be the commander is only complete when it is.
select c.variant_id as cv, c.commander_card_ids[1] as cmdpiece, (select x from unnest(c.card_ids) x where x <> c.commander_card_ids[1] limit 1) as other
from corpus.spellbook_combos c
where cardinality(c.card_ids) = 2 and cardinality(c.commander_card_ids) = 1 and cardinality(c.template_names) = 0
order by c.variant_id
limit 1
\gset
select chk('a commander piece counts only as the commander',
  exists (select 1 from public.serving_deck_combos(array[:other], array[:cmdpiece], '{}', true, false) s where s.variant_id = :'cv')
  and not exists (select 1 from public.serving_deck_combos(array[:other, :cmdpiece], array[:five], '{}', true, false) s where s.variant_id = :'cv'));

set local role anon;
select chk('anon reads the deck''s combos and the watched cards',
  (select count(*) >= 0 from public.serving_deck_combos(array[:p1, :p2], array[:five])) and public.bracket_cards() is not null);
do $$
begin
  perform 1 from public.spellbook_combo_details limit 1;
  insert into t values ('anon cannot read the combo tables directly', false, 'no error');
exception when insufficient_privilege then
  insert into t values ('anon cannot read the combo tables directly', true, '');
end $$;

reset role;
select name, case when ok then 'PASS' else 'FAIL' end as result, detail from t order by ctid;
select count(*) filter (where not ok) as failures, count(*) as total from t;

rollback;
