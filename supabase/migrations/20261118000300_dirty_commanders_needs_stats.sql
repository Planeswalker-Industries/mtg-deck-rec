-- A commander queued for the precompute worker says whether its stats need rebuilding, or only its scores (T097).
--
-- The stats (commander_keys, commander_stats, commander_card_stats) are counted from our own decks; the scores also read
-- EDHREC's pages. An EDHREC collation queued every commander whose page moved, so the worker rebuilt their stats from
-- decks that hadn't changed: on 2026-11-18 the first hosted import queued 6,978 commanders, and 4,000 of them were
-- rebuilt for one written row, about 3.5 minutes of database time per 2,000. EDHREC is fetched every week.
--
-- A deck write (the trigger below) queues with needs_stats true and turns a waiting scores-only row into a full one; the
-- EDHREC collation queues with false and never clears a true.

alter table corpus.dirty_commanders add column needs_stats boolean not null default true;

comment on column corpus.dirty_commanders.needs_stats is
  'True when the commander''s decks changed, so its stats are rebuilt before its scores; false when only its scores'' inputs (an EDHREC page) moved.';

create or replace function corpus.mark_commanders_dirty()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into corpus.dirty_commanders (commander_1, commander_2)
    select distinct n.commander_card_ids[1], coalesce(n.commander_card_ids[2], 0) from new_rows n
    on conflict (commander_1, commander_2) do update set seq = nextval('corpus.dirty_commanders_seq'), needs_stats = true;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    insert into corpus.dirty_commanders (commander_1, commander_2)
    select distinct o.commander_card_ids[1], coalesce(o.commander_card_ids[2], 0) from old_rows o
    on conflict (commander_1, commander_2) do update set seq = nextval('corpus.dirty_commanders_seq'), needs_stats = true;
  end if;
  return null;
end;
$$;

revoke all on function corpus.mark_commanders_dirty() from public, anon, authenticated;
