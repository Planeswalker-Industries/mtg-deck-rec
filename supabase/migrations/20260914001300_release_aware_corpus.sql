-- Play rates count a card only against decks updated in or after its release month: a deck last edited before a card
-- existed says nothing about it. Without this, new cards look unplayed next to years-old decks.

alter table public.commander_card_stats
  add column eligible_decks integer; -- the commander's decks updated since the card's release; set by aggregate:corpus

alter table public.commander_stats
  add column deck_months jsonb not null default '{}'::jsonb; -- {"2026-08": 22}: decks by last-updated month

-- Corpus decks by color identity and last-updated month, so a card's eligible decks can be counted even when no deck
-- runs it.
create table public.corpus_identity_stats (
  color_identity smallint primary key check (color_identity between 0 and 31),
  deck_months jsonb not null,
  computed_at timestamptz not null default now()
);

alter table public.corpus_identity_stats enable row level security;
create policy public_read on public.corpus_identity_stats for select to anon, authenticated using (true);
grant select on public.corpus_identity_stats to anon, authenticated;
grant all on public.corpus_identity_stats to service_role;

-- Same gates and signature; inclusion is now shrunk over each card's eligible decks instead of all of the commander's.
create or replace function public.rec_add_candidates(
  p_key_ids integer[],
  p_deck_count integer,
  p_alpha real,
  p_identity_mask smallint,
  p_exclude integer[],
  p_allow_game_changers boolean,
  p_owned integer[] default null,
  p_limit integer default 400
)
returns table (card_id integer, decks_with integer, baseline real)
language sql
stable
security definer
set search_path = ''
as $$
  with keys as (
    select coalesce(p_key_ids, '{}'::integer[]) as ids
  ),
  commander_cards as (
    select
      s.card_id,
      sum(s.decks_with)::integer as decks_with,
      sum(coalesce(s.eligible_decks, p_deck_count))::integer as eligible_decks
    from public.commander_card_stats s, keys
    where s.commander_key_id = any (keys.ids)
    group by s.card_id
  ),
  pool as (
    select g.card_id, coalesce(cc.decks_with, 0) as decks_with, coalesce(cc.eligible_decks, 0) as eligible_decks, g.rate as baseline
    from public.card_global_stats g
    cross join keys
    left join commander_cards cc on cc.card_id = g.card_id
    where cardinality(keys.ids) = 0 or cc.card_id is not null
  ),
  scored as (
    select
      p.card_id,
      p.decks_with,
      p.baseline,
      (p.decks_with + p_alpha * p.baseline) / (greatest(p.eligible_decks, p.decks_with) + p_alpha) as inclusion
    from pool p
  )
  select s.card_id, s.decks_with, s.baseline
  from scored s
  cross join keys
  join public.cards c on c.id = s.card_id
  where c.deleted_at is null
    and c.legal_commander = 'legal'
    and not c.is_basic_land
    and (c.color_identity & ~p_identity_mask) = 0
    and c.id <> all (coalesce(p_exclude, '{}'::integer[]))
    and (p_allow_game_changers or not c.game_changer)
    and (p_owned is null or c.id = any (p_owned))
  order by
    case
      when cardinality(keys.ids) = 0 then sqrt(greatest(s.baseline, 0))
      else 0.6 * (0.5 + 0.5 * greatest(-1, least(1, (s.inclusion - s.baseline) / 0.3))) + 0.4 * sqrt(least(1, greatest(s.inclusion, 0)))
    end desc,
    c.name
  limit p_limit
$$;
