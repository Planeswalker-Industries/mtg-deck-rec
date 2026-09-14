-- Scryfall Tagger oracle tags: tags keyed by stable UUID, hierarchy edges, closure, direct taggings.

create table public.tags (
  id uuid primary key, -- Tagger UUID; slug and label are display-only and can change
  type text not null check (type = 'oracle'),
  slug text not null,
  label text not null,
  description text,
  card_count integer not null default 0, -- cards tagged with this tag or any descendant
  idf real not null default 0, -- normalized 0..1; broad tags score low
  disabled boolean not null default false, -- kill switch; survives resync because it is keyed by UUID
  disabled_reason text,
  disabled_by uuid references auth.users (id),
  disabled_at timestamptz,
  content_hash bytea not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index tags_slug on public.tags (slug);

create table public.tag_edges (
  parent_id uuid not null references public.tags (id) on delete cascade,
  child_id uuid not null references public.tags (id) on delete cascade,
  primary key (parent_id, child_id)
);

create index tag_edges_child on public.tag_edges (child_id);

-- Every ancestor/descendant pair (depth 0 = the tag itself). Rebuilt after each tag sync.
create table public.tag_closure (
  ancestor_id uuid not null,
  descendant_id uuid not null,
  depth smallint not null,
  primary key (ancestor_id, descendant_id)
);

create index tag_closure_descendant on public.tag_closure (descendant_id) include (ancestor_id, depth);

-- Direct taggings only, as in the bulk file. Parent tags are reached through tag_closure.
create table public.card_tags (
  card_id integer not null references public.cards (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  weight_raw text not null, -- as published; normalization rule is set by the Phase 0 tag profile
  weight real not null check (weight between 0 and 1),
  primary key (card_id, tag_id)
);

create index card_tags_tag on public.card_tags (tag_id) include (card_id, weight);

-- Per-card tag arrays for the GIN prefilter in candidate generation.
-- The kill switch is applied at query time (join on tags.disabled), so disabling a tag never waits for a refresh.
create materialized view public.card_tag_vectors as
select
  ct.card_id,
  array_agg(distinct ct.tag_id) as direct_tag_ids,
  array_agg(distinct tc.ancestor_id) as expanded_tag_ids
from public.card_tags ct
join public.tag_closure tc on tc.descendant_id = ct.tag_id
group by ct.card_id;

create unique index card_tag_vectors_card on public.card_tag_vectors (card_id);
create index card_tag_vectors_expanded on public.card_tag_vectors using gin (expanded_tag_ids);

-- Recomputes tag_closure from tag_edges. Community data can contain cycles: the CYCLE clause stops them,
-- and the depth cap bounds pathological chains. Runs in the caller's transaction, so readers never see it half-built.
create or replace function public.rebuild_tag_closure()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.tag_closure;

  insert into public.tag_closure (ancestor_id, descendant_id, depth)
  with recursive walk (ancestor_id, descendant_id, depth) as (
    select t.id, t.id, 0
    from public.tags t
    where t.deleted_at is null
    union all
    select w.ancestor_id, e.child_id, w.depth + 1
    from walk w
    join public.tag_edges e on e.parent_id = w.descendant_id
    where w.depth < 12
  ) cycle descendant_id set is_cycle using path
  select ancestor_id, descendant_id, min(depth)::smallint
  from walk
  where not is_cycle
  group by ancestor_id, descendant_id;
end;
$$;

revoke execute on function public.rebuild_tag_closure() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['tags', 'tag_edges', 'tag_closure', 'card_tags'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Materialized views have no RLS; only security-definer recommendation functions read this.
revoke all on public.card_tag_vectors from anon, authenticated;

grant select on public.tags, public.tag_edges, public.tag_closure, public.card_tags to anon, authenticated;
grant all on public.tags, public.tag_edges, public.tag_closure, public.card_tags to service_role;
grant select on public.card_tag_vectors to service_role;
grant execute on function public.rebuild_tag_closure() to service_role;
