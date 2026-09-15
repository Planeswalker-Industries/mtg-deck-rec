-- Swap votes, slice 1 of the swipe rater: a voter says whether a card is a good replacement for another. Each vote keeps
-- what the voter saw (commander, sitting, position, the other candidates shown, the tags shown as the shared job), so a
-- later aggregation can weigh votes per shared tag and against candidates declined beside an accepted one. Nothing
-- reads votes for scoring yet.
--
-- Anyone can vote until OAuth ships. Signed-in voters are keyed by user id (auth.uid()); everyone else by the app's
-- salted visitor hash, which people behind one address share. The function is callable by API roles directly, so a
-- caller can pick any visitor key: fine while votes don't affect scoring, and revisited with sign-in and trust weights.

create table public.swap_votes (
  id bigint generated always as identity primary key,
  voter_key text not null, -- 'u:<user id>' when signed in, otherwise 'v:<salted visitor hash>'
  user_id uuid references auth.users (id) on delete set null,
  target_card_id integer not null references public.cards (id) on delete cascade,
  replacement_card_id integer not null references public.cards (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  commander_key_id integer references public.commander_keys (id) on delete set null,
  commander_ids integer[] not null default '{}',
  source text not null check (source in ('deck', 'rater')),
  session_id uuid, -- client-generated, one per sitting
  shown_position smallint, -- this candidate's position in the order shown, 0 first
  shown_card_ids integer[] not null default '{}', -- every candidate shown for this target in the sitting, in order
  matched_tag_ids uuid[] not null default '{}', -- tags shown as the shared job
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (voter_key, target_card_id, replacement_card_id),
  check (target_card_id <> replacement_card_id)
);

create index swap_votes_pair on public.swap_votes (target_card_id, replacement_card_id);
create index swap_votes_session on public.swap_votes (session_id) where session_id is not null;

-- Writes go through cast_swap_vote only; API roles get no direct access.
alter table public.swap_votes enable row level security;
grant all on public.swap_votes to service_role;

-- Bayesian prior for a pair's vote score: (up + priorVotes × priorScore) / (votes + priorVotes).
insert into public.app_config (key, value, is_public)
values ('votes', '{"priorVotes": 10, "priorScore": 0.5}'::jsonb, false)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Swiping is fast; a vote per half second is plenty.
update public.app_config
set value = value || '{"vote": {"limit": 120, "windowSeconds": 60}}'::jsonb, updated_at = now()
where key = 'rate_limits';

-- Records, changes (same voter and pair) or clears (value 0) a vote, then returns the pair's summary as
-- {score, voteCount, myVote}. Raises VOTER_REQUIRED, INVALID_VOTE or UNKNOWN_CARD. A repeated identical vote writes nothing.
create function public.cast_swap_vote(
  p_visitor_key text,
  p_target integer,
  p_replacement integer,
  p_value smallint,
  p_commander_key_id integer default null,
  p_commander_ids integer[] default '{}',
  p_source text default 'deck',
  p_session_id uuid default null,
  p_position smallint default null,
  p_shown_card_ids integer[] default '{}',
  p_matched_tag_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb := (select c.value from public.app_config c where c.key = 'votes');
  prior_votes numeric := coalesce((cfg ->> 'priorVotes')::numeric, 10);
  prior_score numeric := coalesce((cfg ->> 'priorScore')::numeric, 0.5);
  voter text;
  ups integer;
  total integer;
  mine smallint;
begin
  if auth.uid() is not null then
    voter := 'u:' || auth.uid()::text;
  elsif coalesce(p_visitor_key, '') <> '' then
    voter := 'v:' || p_visitor_key;
  else
    raise exception 'VOTER_REQUIRED';
  end if;

  if p_value is null or p_value not in (-1, 0, 1)
     or p_target = p_replacement
     or p_source not in ('deck', 'rater')
     or cardinality(coalesce(p_commander_ids, '{}')) > 2
     or cardinality(coalesce(p_shown_card_ids, '{}')) > 50
     or cardinality(coalesce(p_matched_tag_ids, '{}')) > 50
     or p_position < 0 or p_position > 49 then
    raise exception 'INVALID_VOTE';
  end if;

  if (select count(*) from public.cards c where c.id in (p_target, p_replacement) and c.deleted_at is null) < 2 then
    raise exception 'UNKNOWN_CARD';
  end if;

  if p_value = 0 then
    delete from public.swap_votes v
    where v.voter_key = voter and v.target_card_id = p_target and v.replacement_card_id = p_replacement;
  else
    insert into public.swap_votes as v (
      voter_key, user_id, target_card_id, replacement_card_id, value, commander_key_id, commander_ids,
      source, session_id, shown_position, shown_card_ids, matched_tag_ids
    )
    values (
      voter, auth.uid(), p_target, p_replacement, p_value,
      (select k.id from public.commander_keys k where k.id = p_commander_key_id),
      coalesce(p_commander_ids, '{}'), p_source, p_session_id, p_position,
      coalesce(p_shown_card_ids, '{}'), coalesce(p_matched_tag_ids, '{}')
    )
    on conflict (voter_key, target_card_id, replacement_card_id) do update set
      value = excluded.value,
      user_id = excluded.user_id,
      commander_key_id = excluded.commander_key_id,
      commander_ids = excluded.commander_ids,
      source = excluded.source,
      session_id = excluded.session_id,
      shown_position = excluded.shown_position,
      shown_card_ids = excluded.shown_card_ids,
      matched_tag_ids = excluded.matched_tag_ids,
      updated_at = now()
    where (v.value, v.commander_key_id, v.commander_ids, v.source, v.session_id, v.shown_position, v.shown_card_ids, v.matched_tag_ids)
      is distinct from
      (excluded.value, excluded.commander_key_id, excluded.commander_ids, excluded.source, excluded.session_id,
       excluded.shown_position, excluded.shown_card_ids, excluded.matched_tag_ids);
  end if;

  select count(*) filter (where v.value = 1), count(*) into ups, total
  from public.swap_votes v
  where v.target_card_id = p_target and v.replacement_card_id = p_replacement;

  select v.value into mine
  from public.swap_votes v
  where v.voter_key = voter and v.target_card_id = p_target and v.replacement_card_id = p_replacement;

  return jsonb_build_object(
    'score', round((ups + prior_votes * prior_score) / (total + prior_votes), 4),
    'voteCount', total,
    'myVote', coalesce(mine, 0)
  );
end;
$$;

revoke execute on function public.cast_swap_vote(text, integer, integer, smallint, integer, integer[], text, uuid, smallint, integer[], uuid[]) from public;
grant execute on function public.cast_swap_vote(text, integer, integer, smallint, integer, integer[], text, uuid, smallint, integer[], uuid[])
  to anon, authenticated, service_role;
