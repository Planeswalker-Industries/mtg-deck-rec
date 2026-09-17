-- The batched form of card_functional_tags. The deck workspace groups a whole deck by what its cards do, and the
-- single-card function would mean one round trip per card — a hundred for a Commander deck.
--
-- Same logic as card_functional_tags, grouped per card: direct taggings that are functional, walked up the hierarchy
-- at most two steps, keeping the shallowest depth each ancestor was reached at.

create function public.cards_functional_tags(p_card_ids integer[])
returns table (card_id integer, tag_id uuid, slug text, label text, depth smallint)
language sql
stable
security definer
set search_path = ''
as $$
  with direct as (
    select ct.card_id, ct.tag_id
    from public.card_tags ct
    join public.functional_tags f on f.tag_id = ct.tag_id
    where ct.card_id = any (p_card_ids)
  ),
  reached as (
    select d.card_id, tc.ancestor_id as tag_id, min(tc.depth) as depth
    from direct d
    join public.tag_closure tc on tc.descendant_id = d.tag_id and tc.depth <= 2
    join public.functional_tags f on f.tag_id = tc.ancestor_id
    group by d.card_id, tc.ancestor_id
  )
  select r.card_id, t.id, t.slug, t.label, r.depth::smallint
  from reached r
  join public.tags t on t.id = r.tag_id
  order by r.card_id, r.depth, t.label
$$;

revoke all on function public.cards_functional_tags(integer[]) from public;
grant execute on function public.cards_functional_tags(integer[]) to anon, authenticated, service_role;
