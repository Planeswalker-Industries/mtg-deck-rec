-- Data layers (T053; docs/roadmap/card-graph-plan.md, "Data layers").
--
-- Every source keeps its data in a schema of its own, as the source published it. The crawler's machinery gets a
-- schema of its own. `corpus` becomes the collated layer: written by the collator (T054), resolved to our card ids,
-- every row tagged with its source. The precompute worker (T055) builds the public tables the app reads from it.
--
--   archidekt, moxfield   decks as the crawl fetched them, in the source's own identifiers (Scryfall oracle ids)
--   edhrec                EDHREC's commander pages as published (sync:edhrec fills it)
--   spellbook             Commander Spellbook's combo export (sync:spellbook fills it)
--   crawl                 the crawl engine's runs, claims and queue, and one view over every deck source
--   corpus                collated: decks from every source, EDHREC's resolved pages, and the commanders to recompute
--
-- Moving a table to another schema, or renaming it, rewrites no rows. The one rewrite is the crawled decks: they go
-- back to oracle ids, so the raw layer no longer depends on our catalog. A deck naming a card the catalog doesn't
-- have yet is now kept raw and reaches `corpus` once every card resolves, instead of being dropped and fetched again;
-- the 2026-10-03 rule that no 99-card deck reaches the corpus still holds.
--
-- The `public.crawl_*` functions the Go service calls keep their names and arguments; only their bodies change. None
-- of these schemas is on PostgREST's exposed list, and API roles get no usage on them.

-- === schemas ===

create schema archidekt;
create schema moxfield;
create schema edhrec;
create schema spellbook;
create schema crawl;

comment on schema archidekt is 'Archidekt decks as the crawl fetched them. Raw: written only by the crawl, read by the collator.';
comment on schema moxfield is 'Moxfield decks as the crawl would fetch them. Empty: the source is switched off until Moxfield grants access (T044).';
comment on schema edhrec is 'EDHREC commander pages as published. Raw: written only by sync:edhrec, read by the collator.';
comment on schema spellbook is 'Commander Spellbook''s combo export as published. Raw: written only by sync:spellbook, read by the collator.';
comment on schema crawl is 'The crawl engine''s machinery (runs, claims, the commander queue) and one view over every deck source.';
comment on schema corpus is 'Collated: every source resolved to our card ids, each row tagged with its source. Written only by the collator.';

grant usage on schema archidekt, moxfield, edhrec, spellbook, crawl to service_role;
alter default privileges in schema archidekt grant select, insert, update, delete on tables to service_role;
alter default privileges in schema moxfield grant select, insert, update, delete on tables to service_role;
alter default privileges in schema edhrec grant select, insert, update, delete on tables to service_role;
alter default privileges in schema spellbook grant select, insert, update, delete on tables to service_role;
alter default privileges in schema crawl grant select, insert, update, delete on tables to service_role;

-- === crawl: the crawler's machinery ===

alter table corpus.crawl_runs set schema crawl;
alter table crawl.crawl_runs rename to runs;
alter sequence crawl.crawl_runs_id_seq rename to runs_id_seq;
alter table corpus.crawl_state set schema crawl;
alter table crawl.crawl_state rename to state;
alter table corpus.crawl_commanders set schema crawl;
alter table crawl.crawl_commanders rename to queue;
alter index crawl.crawl_commanders_next rename to queue_next;

-- Constraint names follow the tables, so an error names the table it came from.
alter table crawl.runs rename constraint crawl_runs_pkey to runs_pkey;
alter table crawl.runs rename constraint crawl_runs_source_check to runs_source_check;
alter table crawl.runs rename constraint crawl_runs_state_check to runs_state_check;
alter table crawl.state rename constraint crawl_state_pkey to state_pkey;
alter table crawl.state rename constraint crawl_state_source_check to state_source_check;
alter table crawl.queue rename constraint crawl_commanders_pkey to queue_pkey;
alter table crawl.queue rename constraint crawl_commanders_source_check to queue_source_check;
alter table crawl.queue rename constraint crawl_commanders_outcome_check to queue_outcome_check;
alter table crawl.queue rename constraint crawl_commanders_commander_card_id_fkey to queue_commander_card_id_fkey;
alter table crawl.queue rename constraint crawl_commanders_last_run_id_fkey to queue_last_run_id_fkey;

-- The queue's order comes from EDHREC's deck counts; a column holding one source's number says which source.
alter table crawl.queue rename column seed_decks to edhrec_deck_count;

comment on table crawl.queue is
  'The per-commander crawl queue, and its verification log: outcome not_found / no_led_decks marks commanders the source does not know under that name.';
comment on column crawl.queue.edhrec_deck_count is
  'EDHREC''s deck count for the commander, summed over its pages (alone and in pairs): the queue serves the most played first. Refreshed by crawl_seed_commanders.';
comment on column crawl.queue.held_decks is
  'Decks the source''s raw table holds that this commander leads, refreshed by crawl_seed_commanders. The queue serves the commanders furthest from the target first.';
comment on column crawl.runs.skipped_unresolved is
  'Decks fetched but not stored because an id in them is not an oracle id. Refetched on the next visit.';

-- === raw decks, one table per deck source ===

-- One sequence for every deck source, so a deck id names one deck whichever source it came from (the admin pages
-- address decks by id alone).
create sequence crawl.deck_id_seq;

create table archidekt.decks (
  id                bigint primary key default nextval('crawl.deck_id_seq'),
  source_deck_id    text not null unique,
  commanders        uuid[] not null check (cardinality(commanders) >= 1),
  card_oracle_ids   uuid[] not null,
  quantities        smallint[] not null check (cardinality(quantities) = cardinality(card_oracle_ids)),
  deck_size         integer not null,
  declared_bracket  smallint check (declared_bracket between 1 and 5),
  content_hash      text not null,
  listed_updated_at timestamptz not null,
  last_updated_at   timestamptz not null,
  fetched_at        timestamptz not null default now()
);

comment on table archidekt.decks is
  'Decks as Archidekt published them, in its oracle ids. Kept whether or not our catalog knows every card; the collator decides what reaches corpus.decks.';
comment on column archidekt.decks.commanders is 'Oracle ids of the deck''s commanders, as the source reports them, sorted.';
comment on column archidekt.decks.card_oracle_ids is
  'Oracle ids of the rest of the deck, sorted. Stored as uuid rather than JSON keys: 16 bytes a card instead of a 36-character key.';
comment on column archidekt.decks.quantities is 'Copies of each card, aligned with card_oracle_ids. Basics are most of a mana base.';
comment on column archidekt.decks.declared_bracket is
  'The bracket the deck''s author declared. Checks our estimator only; it never scores (owner decision 2026-10-05).';
comment on column archidekt.decks.content_hash is
  'The crawler''s hash over sorted commanders and card/quantity pairs as oracle ids: a reshuffled list does not rewrite the row.';

-- The collator reads what changed since its last run, and the admin pages list newest first.
create index decks_fetched_at on archidekt.decks (fetched_at desc, id desc);

create table moxfield.decks (like archidekt.decks including all);
comment on table moxfield.decks is 'Decks as Moxfield would publish them. Empty while the source is switched off (T044).';

-- The crawled decks, back to the source's oracle ids. Every card id came from public.cards when the deck was written,
-- so each maps back; the check after refuses the migration rather than let a deck lose a card on the way.
do $$
declare
  v_source text;
begin
  foreach v_source in array array['archidekt', 'moxfield'] loop
    execute format($sql$
      insert into %I.decks (id, source_deck_id, commanders, card_oracle_ids, quantities, deck_size, content_hash,
                            listed_updated_at, last_updated_at, fetched_at)
      select d.id, d.source_deck_id,
             array(select k.oracle_id from unnest(d.commander_card_ids) as c (card_id)
                     join public.cards k on k.id = c.card_id order by k.oracle_id),
             coalesce(x.oracle_ids, '{}'), coalesce(x.quantities, '{}'),
             d.deck_size, d.content_hash, d.listed_updated_at, d.last_updated_at, d.fetched_at
        from corpus.decks d
        cross join lateral (
          select array_agg(k.oracle_id order by k.oracle_id) as oracle_ids,
                 array_agg((e.value #>> '{}')::smallint order by k.oracle_id) as quantities
            from jsonb_each(d.cards) as e (key, value)
            join public.cards k on k.id = e.key::integer
        ) x
       where d.source = %L
    $sql$, v_source, v_source);
  end loop;
end;
$$;

do $$
declare
  v_decks_before bigint;
  v_commanders_before bigint;
  v_cards_before bigint;
  v_decks_after bigint;
  v_commanders_after bigint;
  v_cards_after bigint;
begin
  select count(*),
         coalesce(sum(cardinality(commander_card_ids)), 0)::bigint,
         coalesce(sum((select count(*) from jsonb_object_keys(cards))), 0)::bigint
    into v_decks_before, v_commanders_before, v_cards_before
    from corpus.decks;
  select count(*),
         coalesce(sum(cardinality(commanders)), 0)::bigint,
         coalesce(sum(cardinality(card_oracle_ids)), 0)::bigint
    into v_decks_after, v_commanders_after, v_cards_after
    from (select commanders, card_oracle_ids from archidekt.decks
          union all
          select commanders, card_oracle_ids from moxfield.decks) d;
  if (v_decks_before, v_commanders_before, v_cards_before)
     is distinct from (v_decks_after, v_commanders_after, v_cards_after) then
    raise exception 'crawled decks did not convert cleanly: % decks, % commanders, % cards before; % decks, % commanders, % cards after',
      v_decks_before, v_commanders_before, v_cards_before, v_decks_after, v_commanders_after, v_cards_after;
  end if;
end;
$$;

select setval('crawl.deck_id_seq', coalesce((select max(id) from corpus.decks), 0) + 1, false);

drop table corpus.decks;

grant usage, select, update on sequence crawl.deck_id_seq to service_role;
alter table archidekt.decks enable row level security;
alter table moxfield.decks enable row level security;

-- What the engine and the admin pages read: every deck source's raw decks, with the source as a column. A constant
-- source per branch means a filter on one source never reads the other's table. A new deck source adds its branch.
create view crawl.decks as
  select 'archidekt'::text as source, d.* from archidekt.decks d
  union all
  select 'moxfield'::text as source, d.* from moxfield.decks d;

comment on view crawl.decks is 'Every deck source''s raw decks, with the source as a column. Read by the crawl_* and admin functions.';

-- === EDHREC: raw pages, and the resolved tables moved into corpus ===

create table edhrec.commanders (
  slug        text primary key,
  names       text[] not null check (cardinality(names) >= 1),
  printing_id uuid,
  deck_count  integer not null check (deck_count >= 0),
  fetched_at  timestamptz not null
);

create table edhrec.commander_cards (
  slug            text not null references edhrec.commanders (slug) on delete cascade,
  name            text not null,
  printing_id     uuid,
  decks_with      integer not null check (decks_with >= 0),
  potential_decks integer not null check (potential_decks > 0 and decks_with <= potential_decks),
  synergy         real,
  primary key (slug, name)
);

comment on table edhrec.commanders is
  'EDHREC commander pages as published: the names the page gives and its deck count. Not stored: salt, rank, prices, images, panels.';
comment on column edhrec.commanders.printing_id is 'The Scryfall printing the page shows for its commander, when it names one.';
comment on table edhrec.commander_cards is
  'Each page''s published card counts, by the names and printing ids the page uses. EDHREC lists about 270 cards a page.';
comment on column edhrec.commander_cards.synergy is 'EDHREC''s own synergy figure, as published. Never displayed.';

alter table edhrec.commanders enable row level security;
alter table edhrec.commander_cards enable row level security;

-- The resolved EDHREC tables move into corpus under names that say whose data they hold. A table that only ever
-- holds one source's rows names that source; its `source` column then has nothing left to say, and goes.
alter table public.external_commanders set schema corpus;
alter table corpus.external_commanders rename to edhrec_commanders;
alter table public.external_commander_card_stats set schema corpus;
alter table corpus.external_commander_card_stats rename to edhrec_commander_cards;

-- Dropping the column drops the (source, slug) key and the pair index built on it; both come back without it.
alter table corpus.edhrec_commanders drop column source;
alter table corpus.edhrec_commanders add constraint edhrec_commanders_slug_key unique (slug);
create unique index edhrec_commanders_pair on corpus.edhrec_commanders (commander_1, coalesce(commander_2, 0));
alter table corpus.edhrec_commanders add column listed_floor real;
alter sequence corpus.external_commanders_id_seq rename to edhrec_commanders_id_seq;
alter table corpus.edhrec_commanders rename constraint external_commanders_pkey to edhrec_commanders_pkey;
alter table corpus.edhrec_commanders rename constraint external_commanders_check to edhrec_commanders_check;
alter table corpus.edhrec_commanders rename constraint external_commanders_deck_count_check to edhrec_commanders_deck_count_check;
alter table corpus.edhrec_commanders rename constraint external_commanders_commander_1_fkey to edhrec_commanders_commander_1_fkey;
alter table corpus.edhrec_commanders rename constraint external_commanders_commander_2_fkey to edhrec_commanders_commander_2_fkey;

alter table corpus.edhrec_commander_cards rename column external_commander_id to edhrec_commander_id;
alter table corpus.edhrec_commander_cards rename constraint external_commander_card_stats_pkey to edhrec_commander_cards_pkey;
alter table corpus.edhrec_commander_cards rename constraint external_commander_card_stats_check to edhrec_commander_cards_check;
alter table corpus.edhrec_commander_cards rename constraint external_commander_card_stats_decks_with_check to edhrec_commander_cards_decks_with_check;
alter table corpus.edhrec_commander_cards rename constraint external_commander_card_stats_card_id_fkey to edhrec_commander_cards_card_id_fkey;
alter table corpus.edhrec_commander_cards rename constraint external_commander_card_stats_external_commander_id_fkey to edhrec_commander_cards_edhrec_commander_id_fkey;
alter index corpus.external_commander_card_stats_card rename to edhrec_commander_cards_card;

comment on table corpus.edhrec_commanders is
  'EDHREC''s commander pages resolved to our cards: one row per commander or pair. Kept apart from our own deck counts, since EDHREC aggregates the same Archidekt and Moxfield decks. Written by the collator from edhrec.*.';
comment on column corpus.edhrec_commanders.listed_floor is
  'The lowest inclusion (decks_with / potential_decks) the page lists. A card the page leaves out is below it. Filled by the collator (T054).';
comment on table corpus.edhrec_commander_cards is
  'EDHREC''s published card counts per commander page, resolved to our cards. Never displayed.';

-- === corpus: the collated decks and the commanders to recompute ===

create table corpus.decks (
  id                 bigint generated always as identity primary key,
  source             text not null check (source in ('archidekt', 'moxfield', 'user')),
  source_deck_id     text not null,
  user_deck_id       uuid references public.decks (id) on delete cascade,
  commander_card_ids integer[] not null check (cardinality(commander_card_ids) between 1 and 2),
  color_identity     smallint not null check (color_identity between 0 and 31),
  card_ids           integer[] not null,
  basic_lands        smallint not null check (basic_lands >= 0),
  updated_month      date not null,
  content_hash       bytea not null,
  collated_at        timestamptz not null default now(),
  unique (source, source_deck_id),
  check ((source = 'user') = (user_deck_id is not null))
);

comment on table corpus.decks is
  'Every deck that passes the one rule (a legal commander or pair, every card resolved and inside the identity, exactly 100 cards), from every deck source. Written only by the collator (T054).';
comment on column corpus.decks.user_deck_id is 'A player''s deck: deleting it, or the account, removes it from the corpus at once.';
comment on column corpus.decks.card_ids is 'Card ids of the rest of the deck, sorted and distinct, basics excluded.';
comment on column corpus.decks.basic_lands is 'Copies of basic lands, for land counts.';
comment on column corpus.decks.updated_month is 'The month the deck was last updated: a card counts only against decks updated in or after its release.';
comment on column corpus.decks.content_hash is 'Over commanders and cards, so a deck posted on two sites counts once.';

create sequence corpus.dirty_commanders_seq;

create table corpus.dirty_commanders (
  commander_1 integer not null references public.cards (id) on delete cascade,
  commander_2 integer not null default 0,
  seq         bigint not null default nextval('corpus.dirty_commanders_seq'),
  primary key (commander_1, commander_2)
);

comment on table corpus.dirty_commanders is
  'Commanders whose decks changed since the precompute worker last ran (T055): one row per commander or pair, upsert-keyed like search_index_queue. commander_2 is 0 for one commander.';

create index dirty_commanders_seq_idx on corpus.dirty_commanders (seq);

alter table corpus.decks enable row level security;
alter table corpus.dirty_commanders enable row level security;
grant usage, select, update on sequence corpus.decks_id_seq, corpus.dirty_commanders_seq to service_role;

-- === functions: same names and arguments, bodies on the new tables ===

-- Superseded by crawl_deck_versions; nothing calls it.
drop function public.crawl_deck_hashes(text, text[]);

create or replace function public.crawl_create_run(p_source text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into crawl.runs (source, state) values (p_source, 'queued') returning id;
$$;

create or replace function public.crawl_claim(
  p_source text,
  p_run_id bigint,
  p_client_id text,
  p_stale_after_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_run bigint;
  v_claimed_at timestamptz;
begin
  select running_run_id, claimed_at into v_prior_run, v_claimed_at
    from crawl.state where source = p_source for update;
  if not found then
    return jsonb_build_object('claimed', false, 'tookOver', false, 'heldBy', 0);
  end if;
  if v_prior_run is not null
     and v_claimed_at is not null
     and v_claimed_at > now() - make_interval(secs => greatest(p_stale_after_seconds, 0)) then
    return jsonb_build_object('claimed', false, 'tookOver', false, 'heldBy', v_prior_run);
  end if;

  update crawl.state
     set running_run_id = p_run_id, client_id = p_client_id, claimed_at = now()
   where source = p_source;

  if v_prior_run is not null then
    update crawl.runs
       set state = 'failed',
           finished_at = coalesce(finished_at, now()),
           error = coalesce(nullif(error, ''), 'abandoned: the claim went stale and was taken over')
     where id = v_prior_run and state in ('queued', 'running');
  end if;
  return jsonb_build_object('claimed', true, 'tookOver', v_prior_run is not null, 'heldBy', p_run_id);
end;
$$;

create or replace function public.crawl_release(p_source text, p_run_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released boolean := false;
begin
  update crawl.state
     set running_run_id = null, client_id = null, claimed_at = null
   where source = p_source and running_run_id = p_run_id;
  get diagnostics v_released = row_count;
  return v_released;
end;
$$;

create or replace function public.crawl_disable(p_source text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update crawl.state
     set disabled = true, disabled_reason = p_reason, disabled_at = now()
   where source = p_source and not disabled;
  if found then
    insert into public.audit_log (action, payload)
    values ('crawl.disabled', jsonb_build_object('source', p_source, 'reason', p_reason));
  end if;
end;
$$;

create or replace function public.crawl_probe_ok(p_source text)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.state set probe_ok_at = now() where source = p_source;
$$;

create or replace function public.crawl_set_cursor(p_source text, p_last_deck_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.state set last_deck_id = nullif(p_last_deck_id, '') where source = p_source;
$$;

create or replace function public.crawl_state(p_source text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row crawl.state;
begin
  insert into crawl.state (source) values (p_source) on conflict (source) do nothing;
  select * into v_row from crawl.state where source = p_source;
  return jsonb_build_object(
    'disabled', v_row.disabled,
    'disabledReason', coalesce(v_row.disabled_reason, ''),
    'runningRunId', coalesce(v_row.running_run_id, 0),
    'clientId', coalesce(v_row.client_id, ''),
    'claimedAt', v_row.claimed_at,
    'lastDeckId', coalesce(v_row.last_deck_id, ''),
    'probeOk', v_row.probe_ok_at is not null,
    'deckCount', (select count(*) from crawl.decks d where d.source = p_source),
    'commandersQueued', (select count(*) from crawl.queue
                          where source = p_source and last_visited_at is null
                            and outcome is distinct from 'not_found'),
    'commandersVisited', (select count(*) from crawl.queue
                           where source = p_source and last_visited_at is not null),
    'commandersNotFound', (select count(*) from crawl.queue
                            where source = p_source and outcome in ('not_found', 'no_led_decks'))
  );
end;
$$;

create or replace function public.crawl_finish_run(p_run_id bigint, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.runs set
    state = case when p_summary->>'state' in ('queued', 'running', 'succeeded', 'failed')
                 then p_summary->>'state' else 'failed' end,
    finished_at = now(),
    pages_seen = coalesce((p_summary->>'pages_seen')::int, 0),
    decks_listed = coalesce((p_summary->>'decks_listed')::int, 0),
    decks_fetched = coalesce((p_summary->>'decks_fetched')::int, 0),
    decks_written = coalesce((p_summary->>'decks_written')::int, 0),
    skipped_unchanged = coalesce((p_summary->>'skipped_unchanged')::int, 0),
    skipped_unqualified = coalesce((p_summary->>'skipped_unqualified')::int, 0),
    skipped_missing = coalesce((p_summary->>'skipped_missing')::int, 0),
    skipped_unresolved = coalesce((p_summary->>'skipped_unresolved')::int, 0),
    commanders_visited = coalesce((p_summary->>'commanders_visited')::int, 0),
    throttles = coalesce((p_summary->>'throttles')::int, 0),
    throttled_position = nullif(p_summary->>'throttled_position', ''),
    blocks = coalesce((p_summary->>'blocks')::int, 0),
    error = nullif(p_summary->>'error', '')
  where id = p_run_id;
$$;

-- Held decks are counted from the source's raw table. Its commanders are uuid, so the join to cards.oracle_id is uuid
-- to uuid and uses that column's unique index; casting the indexed side to text is what timed out hosted run 8.
create or replace function public.crawl_seed_commanders(p_source text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed int;
begin
  with seeds as (
    select c.card_id, sum(e.deck_count)::int as edhrec_deck_count
      from corpus.edhrec_commanders e
      cross join lateral (values (e.commander_1), (e.commander_2)) as c (card_id)
      join public.cards k on k.id = c.card_id and k.deleted_at is null
     where c.card_id is not null
     group by c.card_id
  ),
  held as (
    select k.id as card_id, count(*)::int as held_decks
      from crawl.decks d
      cross join lateral unnest(d.commanders) as c (oracle_id)
      join public.cards k on k.oracle_id = c.oracle_id
     where d.source = p_source
     group by k.id
  )
  insert into crawl.queue as t (source, commander_card_id, edhrec_deck_count, held_decks)
  select p_source, s.card_id, s.edhrec_deck_count, coalesce(h.held_decks, 0)
    from seeds s
    left join held h on h.card_id = s.card_id
  on conflict (source, commander_card_id) do update
    set edhrec_deck_count = excluded.edhrec_deck_count, held_decks = excluded.held_decks, updated_at = now()
    where t.edhrec_deck_count is distinct from excluded.edhrec_deck_count
       or t.held_decks is distinct from excluded.held_decks;
  get diagnostics v_changed = row_count;
  return v_changed;
end;
$$;

create or replace function public.crawl_next_commanders(p_source text, p_run_id bigint, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target int := coalesce((select (value->>'targetDecks')::int from public.app_config where key = p_source), 60);
begin
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'cardId', q.commander_card_id,
             'oracleId', k.oracle_id,
             'name', k.name,
             'queryName', coalesce(q.query_name, ''),
             'heldDecks', q.held_decks,
             'visited', q.last_visited_at is not null
           ) order by q.ord, q.edhrec_deck_count desc, q.last_visited_at nulls first, q.commander_card_id), '[]'::jsonb)
      from (
        select t.commander_card_id, t.query_name, t.last_visited_at, t.edhrec_deck_count, t.held_decks,
               -- Under the target first. Within each group the old order stands: never visited, most played, stalest.
               (t.held_decks >= v_target)::int * 2 + (t.last_visited_at is not null)::int as ord
          from crawl.queue t
         where t.source = p_source
           and t.outcome is distinct from 'not_found'
           and t.last_run_id is distinct from p_run_id
         order by (t.held_decks >= v_target), (t.last_visited_at is not null),
                  t.edhrec_deck_count desc, t.last_visited_at nulls first, t.commander_card_id
         limit p_limit
      ) q
      join public.cards k on k.id = q.commander_card_id
  );
end;
$$;

create or replace function public.crawl_finish_commander(p_source text, p_card_id int, p_run_id bigint, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update crawl.queue set
    outcome = p_result->>'outcome',
    last_error = nullif(p_result->>'error', ''),
    query_name = coalesce(nullif(p_result->>'queryName', ''), query_name),
    listed = coalesce((p_result->>'listed')::int, 0),
    fetched = coalesce((p_result->>'fetched')::int, 0),
    written = coalesce((p_result->>'written')::int, 0),
    counted = coalesce((p_result->>'counted')::int, 0),
    wrong_commander = coalesce((p_result->>'wrongCommander')::int, 0),
    last_run_id = p_run_id,
    last_visited_at = case when p_result->>'outcome' in ('partial', 'failed') then last_visited_at else now() end,
    updated_at = now()
  where source = p_source and commander_card_id = p_card_id;
$$;

create or replace function public.crawl_deck_versions(p_source text, p_ids text[])
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(d.source_deck_id,
           jsonb_build_object('hash', d.content_hash, 'listedUpdatedAt', d.listed_updated_at)), '{}'::jsonb)
    from crawl.decks d
   where d.source = p_source and d.source_deck_id = any(p_ids);
$$;

-- Writes decks as the source sent them, into the source's own raw table, and only rows that differ: a deck whose
-- content hash and listed update time are both unchanged is not rewritten. Nothing is resolved against the catalog
-- here; the collator does that. The one thing refused is an id that is not an oracle id at all, which comes back as
-- unresolved so the crawl can count and log it: {"written": n, "unresolved": [{"deckId", "missing": [ids]}]}.
create or replace function public.crawl_upsert_decks(p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- crawl.state's check constraint names the crawl's sources, so this also keeps the table name below to one of them.
  if not exists (select 1 from crawl.state s where s.source = p_source)
     or to_regclass(format('%I.decks', p_source)) is null then
    raise exception 'no raw deck table for source %', p_source;
  end if;

  execute format($sql$
    with incoming as (
      select
        row_value->>'source_deck_id' as source_deck_id,
        array(select jsonb_array_elements_text(row_value->'commanders')) as commanders,
        coalesce(row_value->'cards', '{}'::jsonb) as cards,
        (row_value->>'deck_size')::int as deck_size,
        nullif(row_value->>'declared_bracket', '')::smallint as declared_bracket,
        row_value->>'content_hash' as content_hash,
        (row_value->>'listed_updated_at')::timestamptz as listed_updated_at,
        (row_value->>'last_updated_at')::timestamptz as last_updated_at
      from jsonb_array_elements($1) as row_value
    ),
    checked as (
      select i.*,
             array(select s.id
                     from (select unnest(i.commanders) union all select jsonb_object_keys(i.cards)) as s (id)
                    where not pg_input_is_valid(s.id, 'uuid')) as malformed
        from incoming i
    ),
    written as (
      insert into %I.decks as d (source_deck_id, commanders, card_oracle_ids, quantities, deck_size,
                                 declared_bracket, content_hash, listed_updated_at, last_updated_at)
      select c.source_deck_id,
             array(select x::uuid from unnest(c.commanders) as x order by x::uuid),
             coalesce((select array_agg(e.key::uuid order by e.key::uuid) from jsonb_each(c.cards) as e), '{}'),
             coalesce((select array_agg((e.value #>> '{}')::smallint order by e.key::uuid) from jsonb_each(c.cards) as e),
                      '{}'),
             c.deck_size, c.declared_bracket, c.content_hash, c.listed_updated_at, c.last_updated_at
        from checked c
       where cardinality(c.malformed) = 0
      on conflict (source_deck_id) do update set
        commanders = excluded.commanders,
        card_oracle_ids = excluded.card_oracle_ids,
        quantities = excluded.quantities,
        deck_size = excluded.deck_size,
        declared_bracket = excluded.declared_bracket,
        content_hash = excluded.content_hash,
        listed_updated_at = excluded.listed_updated_at,
        last_updated_at = excluded.last_updated_at,
        fetched_at = now()
      where d.content_hash is distinct from excluded.content_hash
         or d.listed_updated_at is distinct from excluded.listed_updated_at
      returning 1
    )
    select jsonb_build_object(
      'written', (select count(*) from written),
      'unresolved', coalesce(
        (select jsonb_agg(jsonb_build_object('deckId', c.source_deck_id, 'missing', to_jsonb(c.malformed)))
           from checked c where cardinality(c.malformed) > 0),
        '[]'::jsonb))
  $sql$, p_source) using p_rows into v_result;
  return v_result;
end;
$$;

-- external_card_priors read only EDHREC's numbers, so its name now says so. The app calls it only while
-- app_config.corpus.externalPriorShare is above 0, and it is 0, so nothing calls the old name in between releases.
drop function public.external_card_priors(integer[], integer[]);

create function public.edhrec_card_priors(p_commander_ids integer[], p_card_ids integer[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Exactly these commanders, never a borrowed pairing: EDHREC publishes a page per commander or pair, and a
  -- partner's solo page describes different decks. Borrowing is what pickCorpusSources does with *our* decks.
  --
  -- The commanders arrive as an array rather than two arguments so the "one commander" case needs no null argument,
  -- and are normalised here the way edhrec_commanders stores them (lower card id first, null for a single).
  with want as (
    select (select min(id) from unnest(p_commander_ids) id) as c1,
           (select case when count(distinct id) > 1 then max(id) end from unnest(p_commander_ids) id) as c2,
           (select count(distinct id) from unnest(p_commander_ids) id) as n
  )
  select coalesce(jsonb_object_agg(s.card_id, s.decks_with::real / s.potential_decks), '{}'::jsonb)
    from want w
    join corpus.edhrec_commanders e
      on e.commander_1 = w.c1 and e.commander_2 is not distinct from w.c2
    join corpus.edhrec_commander_cards s on s.edhrec_commander_id = e.id
   where w.n between 1 and 2
     and s.card_id = any(p_card_ids);
$$;

-- As external_card_priors was: callable by the app, while the tables behind it stay out of the API roles' reach.
revoke all on function public.edhrec_card_priors(integer[], integer[]) from public;
grant execute on function public.edhrec_card_priors(integer[], integer[]) to anon, authenticated, service_role;

create or replace function public.admin_crawl_overview()
returns table (
  source text,
  decks bigint,
  last_fetched_at timestamptz,
  disabled boolean,
  disabled_reason text,
  probe_ok_at timestamptz,
  running_run_id bigint,
  claimed_at timestamptz,
  last_run_id bigint,
  last_run_state text,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_run_decks_written integer,
  last_run_error text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();

  return query
  select
    s.source,
    coalesce(d.n, 0) as decks,
    d.newest,
    s.disabled,
    s.disabled_reason,
    s.probe_ok_at,
    s.running_run_id,
    s.claimed_at,
    r.id, r.state, r.started_at, r.finished_at, r.decks_written, r.error
  from crawl.state s
  -- Every inner reference is aliased: the RETURNS TABLE column names (source, decks, ...) are in scope as plpgsql
  -- variables inside the body, so a bare column of the same name is ambiguous and the function will not run.
  left join lateral (
    select count(*) as n, max(dd.fetched_at) as newest
    from crawl.decks dd where dd.source = s.source
  ) d on true
  left join lateral (
    select cr.id, cr.state, cr.started_at, cr.finished_at, cr.decks_written, cr.error
    from crawl.runs cr where cr.source = s.source order by cr.id desc limit 1
  ) r on true
  order by s.source;
end;
$$;

create or replace function public.admin_list_crawled_decks(
  p_source text default null,
  p_search text default null,
  p_offset integer default 0,
  p_limit integer default 25
)
returns table (
  id bigint,
  source text,
  source_deck_id text,
  commander_names text[],
  deck_size integer,
  distinct_cards integer,
  listed_updated_at timestamptz,
  last_updated_at timestamptz,
  fetched_at timestamptz,
  content_hash text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform public.require_platform_admin();

  return query
  with named as (
    select
      d.id, d.source, d.source_deck_id, d.deck_size, d.listed_updated_at, d.last_updated_at, d.fetched_at,
      d.content_hash,
      cardinality(d.card_oracle_ids) as distinct_cards,
      coalesce(
        (select array_agg(c.name order by c.name)
           from public.cards c
          where c.oracle_id = any(d.commanders)),
        '{}'::text[]
      ) as commander_names
    from crawl.decks d
    where (p_source is null or d.source = p_source)
  )
  select
    n.id, n.source, n.source_deck_id, n.commander_names, n.deck_size, n.distinct_cards,
    n.listed_updated_at, n.last_updated_at, n.fetched_at, n.content_hash,
    count(*) over () as total_count
  from named n
  where v_search is null
     or n.source_deck_id ilike '%' || v_search || '%'
     or exists (select 1 from unnest(n.commander_names) cn where cn ilike '%' || v_search || '%')
  order by n.fetched_at desc, n.id desc
  offset v_offset
  limit v_limit;
end;
$$;

-- The deck's cards as the source sent them. A card the catalog doesn't have comes back with its oracle id and a null
-- name rather than quietly dropped: a stored deck shrinking on screen would hide what this page exists to show.
create or replace function public.admin_crawled_deck_cards(p_deck_id bigint)
returns table (
  oracle_id text,
  name text,
  type_line text,
  quantity integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin();

  return query
  select
    e.card_oracle_id::text as oracle_id,
    c.name,
    c.type_line,
    e.copies::integer as quantity
  from crawl.decks d
  cross join lateral unnest(d.card_oracle_ids, d.quantities) as e (card_oracle_id, copies)
  left join public.cards c on c.oracle_id = e.card_oracle_id
  where d.id = p_deck_id
  order by c.name nulls last, e.card_oracle_id;
end;
$$;
