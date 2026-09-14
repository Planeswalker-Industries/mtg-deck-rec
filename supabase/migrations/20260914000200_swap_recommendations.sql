-- Recommendation building blocks that work without a deck corpus: which tags describe what a card does,
-- tag-similarity swap candidates, and role membership for cut suggestions.

-- Tagger tags that count when matching cards that "do the same job". Each entry includes its descendants.
-- Stored as tag UUIDs (slugs are not stable). Meta and trivia tags (triggered ability, cycle, card names,
-- type errata, ...) are deliberately absent. Edit this row to change the list; no deploy needed.
-- (An ARRAY constructor, not jsonb_build_array: functions accept at most 100 arguments.)
insert into public.app_config (key, value, is_public)
values (
  'functional_tag_roots',
  jsonb_build_object('tagIds', to_jsonb(array[
    -- interaction
    '444f824c-f910-4530-9dbe-ede7a84cd7f9', -- removal
    'de1ee67d-74ab-4ffc-8d65-1e5c0d233464', -- bounce
    '779417f5-7220-4bae-a46b-3eb9e21940ac', -- tuck
    'd5bfa621-66d9-4c1d-92b0-eafc5a712d4d', -- tuck-outlet
    '6ba18e8c-ca24-4c2e-86e3-304e9096074d', -- swap-removal
    '0641a74c-4dd5-426d-be58-2ab86d71995d', -- burn
    'a96e7ee2-d411-435f-978f-0f50e1ce7a16', -- pinger
    '6b5c9d4c-6585-4be6-8067-77b791cba959', -- shrink
    'ef08c6b9-df6d-4a3c-913f-c647db945555', -- gives-mm-counters
    '690fc968-48ba-4854-a948-3db6bf19d3a9', -- counterspell
    'b565fc9e-30af-49da-9d13-05cf00558f59', -- counterspell-soft
    '5d568ef7-0a34-4ded-b65e-0954707b3530', -- counterspell-with-set-mechanic
    'ceb2782c-94e2-42db-ad64-2b271859790f', -- remove-from-stack
    '249eaa21-acc1-45de-bb29-757cd60dffb8', -- hate
    '94eb16fe-34e0-48b4-82f1-a9bde410d058', -- hand-disruption
    'f6cb45db-9890-4bbb-a744-c19da0ecefa6', -- control-changing-effects
    '085d4c3d-2c46-4f86-b294-5780c4936748', -- nightveil-theft
    '486472f8-d4cd-4f88-ae7c-bb01e08cdd9d', -- tapper
    'abdb5417-eee7-4ba2-a314-a75b08d8db71', -- freeze
    'd678e4c3-6d99-43e0-8f36-1c085a8fec54', -- lockdown
    '2ffad104-2092-410d-9a71-080c57b2e8c5', -- tax
    '0387216a-0e23-47fb-a71d-7029f36dbf4e', -- pillowfort
    '1cf4581e-ada4-46d3-8789-dfaab7d3cd46', -- prevent-attack
    '87d5c272-1a31-4412-9ec8-789365ce22d4', -- prevent-cast
    '1f75f46a-034f-4a02-b3ec-5131a86d788d', -- prevent-activation
    'cd12a44c-1aee-4ece-b8ea-3eb118ef0230', -- mass-land-denial
    '9c231dce-0511-4d19-9722-e9a5a892c4b6', -- group-slug
    -- card flow
    'a9b682a7-47ed-4d0d-8a2f-30e9d075525f', -- card-advantage
    'f9579474-bf53-4029-a2ae-e3dfe2de1012', -- force-draw
    'a07140be-dadf-4c3b-a68a-3e885028aed1', -- group-hug
    'f7f1c8d4-9cbf-4001-9dfa-ce018132bf0b', -- peek
    'f2486826-9b36-4aba-88bb-c2482e72f9ec', -- library-manipulation
    'c768d2ec-3264-4a90-a98f-bea8467857d3', -- tutor
    'c4b7e1d2-4e00-4073-8784-65fea9b8e83f', -- wish
    '800416e9-d68c-46f6-af28-d93b66866144', -- gives-castable-from-nonhand
    'afb0c553-e747-4859-9b8b-f11791b56e31', -- hand-size-increase
    '2af2712e-6228-4559-836f-3cdb65db1242', -- discard-outlet
    '338d1ecc-88be-451a-b744-e2cd6c6c9b33', -- discard-outlet-random
    '82b4e653-20f8-44a9-ab46-621f7c49b135', -- mill
    '50ca3b86-4bbb-405c-baf3-40a87f941e2a', -- graveyard-fuel
    '82b824ad-648f-467f-a190-2e0fa9a795d2', -- recursion
    '7ef982da-7f7a-4003-8bb9-84fd368f4441', -- unexile
    '2633b4e0-9361-4bc4-8dfe-cdd16b32dcb9', -- mass-reanimation
    '2694a616-7361-41cf-8ec9-bc0e7236c664', -- temporary-reanimation
    'ddd6954d-2c5a-48a2-875f-e953214cdc13', -- recycle
    -- mana
    '2f3e4ad7-5e60-41b4-bdbc-653f16869cf6', -- ramp
    '458887e7-bfa8-4933-8746-4c9efb578c54', -- adds-multiple-mana
    '43d07dd1-ec75-4416-b5a0-dce4e951a4ca', -- mana-filter
    '49d48660-c095-4389-bdf9-f5668d3849fe', -- chromatic-lantern
    '4b885271-f048-46ae-9d83-72f02e1d1e0b', -- gives-mana-ability
    '1a8e9788-b694-4330-a1a4-1aed6183bd57', -- cost-reducer
    'dd10dded-2973-446e-b078-4240bce90cea', -- cost-ignorer
    '82e2cb8b-1a53-4814-a7a2-76c1369055b4', -- refund
    '524690dc-32c2-4b32-b94a-482585d087cd', -- untapper
    'adab7de4-6227-43bf-9d6f-4543f684423e', -- extra-untap
    '5e708c4d-9992-431e-afe1-fb5af05b2ea3', -- utility-land
    '97e00241-272e-4a67-97e8-193e4ff69b82', -- dual-land
    'f56ffe60-72b0-4275-b07d-45fcdcb199c2', -- triland
    '66cf0e37-bf81-4ef6-9b07-f319f44efe7c', -- tapland
    'f45f1a50-c48d-4312-87b0-ef7fd4b43852', -- conditional-tapland
    '6671420c-fd48-417e-bd71-a1f3c5553866', -- rainbow-land
    -- board
    'a9657a5d-e7f8-4000-a795-7a78b5fb8923', -- repeatable-token-generator
    '07808167-c4ef-4a2d-bfe9-fa38a5a9d17b', -- multiple-bodies
    '8c0894c6-7275-4ea9-afbb-fe621e588b5b', -- copy
    'e4f2ccba-e715-40cb-8540-5a5d50a5a7bc', -- flicker
    'ad4bb0cb-a634-4104-b8da-aad9ec2674a9', -- phase-manipulation
    'c7bd55a7-1ea0-49da-b25e-0be470fbe8ec', -- sacrifice-outlet
    '3057ec76-1c84-45e3-babc-ef65862b1ffe', -- tap-outlet
    'e03446e0-821d-41a2-9627-43f14a42ab91', -- trigger-doubler
    '23d7c011-6732-46ac-baea-2aea1fc33864', -- damage-multiplier
    'c1100c9e-08bf-4845-9263-1a5f86b9005f', -- gives-pp-counters
    '9a3f1038-140e-447a-ba5d-020893c49977', -- repeatable-pp-counters
    '469a7561-464d-4c63-9fb0-45c29fb075e5', -- counter-increaser
    'ec4a8749-9056-4b09-91e3-7595ba1ad111', -- pseudo-proliferate
    'b7cfc923-3a15-4168-876b-525ce37850c5', -- repeatable-proliferate
    '1f681e54-b6ff-4d84-85f7-5955113eee5d', -- move-counters
    -- combat
    'c7756471-d290-452f-bfc6-24866c841f28', -- evasion
    '6cdeab4c-72a6-4f40-ab19-14284d6cf775', -- gives-evasion
    '702286e6-707d-4adb-9a98-21de8ca13519', -- gives-haste
    '12b7f1f1-1a32-4e82-8b3b-47be7c8bf373', -- gives-trample
    '6df5fabf-6d9d-4254-b83f-37476536e111', -- gives-first-strike
    '8c1188fb-2c4b-4422-8a8a-fb27859680db', -- gives-double-strike
    '5f6e7f05-b36f-44f5-9167-8bb939f4c28f', -- gives-vigilance
    'f8506719-ec4b-4b73-a5a4-5b6e82143079', -- gives-deathtouch
    '114264c5-d07a-4a60-bd36-59382e392da1', -- gives-reach
    '55a82c0d-f10d-4faf-8d05-cf0071ab0417', -- gives-flash
    '2032b8a1-4dea-4742-9fce-3dd2c6e69604', -- keyword-anthem
    '0454fcef-0118-4f10-b9d7-c071845bfbd4', -- anthem
    'e7f7559f-5ddd-4262-90ad-04f2ea2a735b', -- power-boost-to-all
    '3c3c90d3-b93c-46fb-9848-7940a3adebf7', -- toughness-boost-to-all
    '24d4542d-ea49-4d59-92fa-fc4bdb91fc17', -- enlarge
    '36f2a0d4-b689-4011-9750-472dd786f2de', -- combat-trick
    '01563423-30bd-42ab-962a-d926bb716705', -- combat-manipulation
    -- defense and life
    '6e2cdc7c-b02c-4b59-a171-f93723721b79', -- protection
    'eb641bf6-0a54-43fc-8934-d22463c1159f', -- cheat-death
    '04292839-74fb-47f0-8d60-a98e0551de70', -- regenerates-other
    '36f69cea-4d3a-4400-9784-f2a197b7cb66', -- damage-prevention
    '92c990fa-2b50-4f04-a95e-ad8b62284d7e', -- pseudo-fog
    '4caab3cc-1d60-44fb-a26a-cc833bc67c97', -- lifegain
    'c0d4b22b-b12e-44c8-8485-36a7247b660f', -- opponent-loses-life
    '3e551f26-c17a-4532-bcd8-7b03c166540e', -- set-life-total
    '67db1fb0-26bd-49a0-9766-84ed4069dbdd'  -- alternate-win-condition
  ]::text[])),
  true
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Role targets for a typical Commander deck. A role counts as overloaded well above its target (see @mtg/core scoring).
insert into public.app_config (key, value, is_public)
values (
  'deck_role_targets',
  '{"roles": [
    {"tagId": "2f3e4ad7-5e60-41b4-bdbc-653f16869cf6", "label": "Ramp", "target": 10},
    {"tagId": "a9b682a7-47ed-4d0d-8a2f-30e9d075525f", "label": "Card advantage", "target": 10},
    {"tagId": "444f824c-f910-4530-9dbe-ede7a84cd7f9", "label": "Removal", "target": 9},
    {"tagId": "6e2cdc7c-b02c-4b59-a171-f93723721b79", "label": "Protection", "target": 5}
  ]}'::jsonb,
  true
)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Public config values (is_public) for the app; everything else in app_config stays service-role only.
create or replace function public.get_public_config(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.app_config where key = p_key and is_public
$$;

-- Allowlisted tags plus descendants, minus disabled tags. A plain view so the kill switch applies immediately.
create view public.functional_tags as
select distinct tc.descendant_id as tag_id
from public.app_config cfg
cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as root (id)
join public.tag_closure tc on tc.ancestor_id = root.id::uuid
join public.tags t on t.id = tc.descendant_id and not t.disabled and t.deleted_at is null
where cfg.key = 'functional_tag_roots';

create or replace function public.rec_functional_tag_count(p_card_id integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.card_tags ct
  join public.functional_tags f on f.tag_id = ct.tag_id
  where ct.card_id = p_card_id
$$;

-- Replacement candidates for one card, ranked by functional tag similarity.
-- For each of the target's functional tags, take the candidate's closest functional tag: an exact match scores 1,
-- a shared parent 0.5 per step (capped at 2 steps each side). Each target tag counts by its idf, so broad roles
-- like "removal" matter less than specific ones like "sweeper". Tagging weights are ignored (almost all "median").
create or replace function public.rec_swap_candidates(
  p_target integer,
  p_exclude integer[],
  p_identity_mask smallint,
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 60
)
returns table (card_id integer, tag_similarity real, matches jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  with target_tags as (
    select ct.tag_id, greatest(t.idf, 0.05) as idf
    from public.card_tags ct
    join public.functional_tags f on f.tag_id = ct.tag_id
    join public.tags t on t.id = ct.tag_id
    where ct.card_id = p_target
  ),
  denominator as (
    select sum(idf) as total from target_tags
  ),
  target_ancestors as (
    select tt.tag_id as target_tag, tt.idf as target_idf, tc.ancestor_id, tc.depth as target_depth
    from target_tags tt
    join public.tag_closure tc on tc.descendant_id = tt.tag_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.ancestor_id
  ),
  candidate_ancestors as (
    select ct.card_id, ct.tag_id as candidate_tag, tc.ancestor_id, tc.depth as candidate_depth
    from (select distinct ancestor_id from target_ancestors) a
    join public.tag_closure tc on tc.ancestor_id = a.ancestor_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.descendant_id
    join public.card_tags ct on ct.tag_id = tc.descendant_id
    join public.cards c on c.id = ct.card_id
    where ct.card_id <> p_target
      and c.deleted_at is null
      and c.legal_commander = 'legal'
      and not c.is_basic_land
      and (c.color_identity & ~p_identity_mask) = 0
      and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
      and (p_allow_game_changers or not c.game_changer)
      and (p_owned is null or c.id = any (p_owned))
  ),
  pairs as (
    select distinct on (c.card_id, t.target_tag)
      c.card_id,
      t.target_tag,
      t.target_idf,
      c.candidate_tag,
      t.ancestor_id,
      t.target_depth + c.candidate_depth as distance
    from target_ancestors t
    join candidate_ancestors c on c.ancestor_id = t.ancestor_id
    order by c.card_id, t.target_tag, t.target_depth + c.candidate_depth, t.ancestor_id
  )
  select
    p.card_id,
    least(1, sum(p.target_idf * power(0.5, p.distance)) / (select total from denominator))::real as tag_similarity,
    jsonb_agg(
      jsonb_build_object(
        'targetTagId', p.target_tag,
        'candidateTagId', p.candidate_tag,
        'viaTagId', case when p.distance = 0 then null else p.ancestor_id end,
        'distance', p.distance
      )
      order by p.distance
    ) as matches
  from pairs p
  group by p.card_id
  order by tag_similarity desc, p.card_id
  limit p_limit
$$;

-- Which of the given role tags (e.g. ramp, removal) each card belongs to, through the tag hierarchy.
create or replace function public.rec_card_roles(p_card_ids integer[], p_role_ids uuid[])
returns table (card_id integer, role_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct ct.card_id, tc.ancestor_id as role_id
  from public.card_tags ct
  join public.tags t on t.id = ct.tag_id and not t.disabled and t.deleted_at is null
  join public.tag_closure tc on tc.descendant_id = ct.tag_id
  where ct.card_id = any (p_card_ids)
    and tc.ancestor_id = any (p_role_ids)
$$;

revoke all on public.functional_tags from anon, authenticated;
grant select on public.functional_tags to service_role;

revoke execute on function public.get_public_config(text) from public;
revoke execute on function public.rec_functional_tag_count(integer) from public;
revoke execute on function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer) from public;
revoke execute on function public.rec_card_roles(integer[], uuid[]) from public;

grant execute on function public.get_public_config(text) to anon, authenticated, service_role;
grant execute on function public.rec_functional_tag_count(integer) to anon, authenticated, service_role;
grant execute on function public.rec_swap_candidates(integer, integer[], smallint, boolean, integer[], integer) to anon, authenticated, service_role;
grant execute on function public.rec_card_roles(integer[], uuid[]) to anon, authenticated, service_role;
