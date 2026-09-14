-- Tags can have several parents. Some trivia tags (e.g. cycle-znr-boltland) also sit under an allowlisted
-- functional root, so allowlisting alone lets them leak into "does the same job" matching.
-- Anything under these trivia roots is excluded, unless the tag itself is explicitly allowlisted.

insert into public.app_config (key, value, is_public)
values (
  'functional_tag_denied_roots',
  jsonb_build_object('tagIds', to_jsonb(array[
    '1adda1a4-e23d-4212-a4da-58303a20e00c', -- cycle
    '5a0a0531-5462-477d-add9-886148c4413f', -- card-names
    'e894517d-c9cc-48ea-bc05-7cd257c15155', -- flavors-of-vanilla
    '32600fa3-0c49-439d-8ff0-900829cbfebc', -- unique-type-line
    'a48e9cf5-08eb-466f-9ace-3a66c4c6c69a', -- type-errata
    '8a7328cb-d21a-436a-a311-f05dc09c2190', -- staple-with-set-s-mechanic
    '79bfc75b-78e1-46ba-9527-3ebaff284aad', -- draft-signpost
    'aa1d20fe-4b9b-4f0f-ada7-db0df9ddaf2e', -- digital-only-mechanics
    'bc363109-3735-4d44-9b0c-cb2d3ed14e7f', -- un-design
    'c67b2b59-4158-4971-9c25-bbc52a3afa7f'  -- deprecated-mechanics
  ]::text[])),
  true
)
on conflict (key) do update set value = excluded.value, updated_at = now();

create or replace view public.functional_tags as
with allowed_roots as (
  select r.id::uuid as id
  from public.app_config cfg
  cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as r (id)
  where cfg.key = 'functional_tag_roots'
),
denied as (
  select distinct tc.descendant_id as tag_id
  from public.app_config cfg
  cross join lateral jsonb_array_elements_text(cfg.value -> 'tagIds') as r (id)
  join public.tag_closure tc on tc.ancestor_id = r.id::uuid
  where cfg.key = 'functional_tag_denied_roots'
)
select distinct tc.descendant_id as tag_id
from allowed_roots a
join public.tag_closure tc on tc.ancestor_id = a.id
join public.tags t on t.id = tc.descendant_id and not t.disabled and t.deleted_at is null
where tc.descendant_id not in (select tag_id from denied)
   or tc.descendant_id in (select id from allowed_roots);
