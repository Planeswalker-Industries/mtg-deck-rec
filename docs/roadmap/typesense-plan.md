# Typesense: what moves off Postgres, and how it stays in step (plan, 2026-09-19)

Companion to [`execution-plan.md`](execution-plan.md) and [`status.md`](status.md).

**Built 2026-09-19, Phases 1–4**, and put behind a Go service on 2026-09-21 (`services/search-api`), so that nothing
but that service talks to Typesense. Self-hosted on the owner's VPS (decision made the same day; the cost comparison
below is kept for the record). [`typesense-ops.md`](typesense-ops.md) is the runbook — how to stand it up, which keys
to make, what to do when it misbehaves, and what has been measured. Phase 5 (swaps) is deliberately not built.

## Why

*(Written 2026-09-19, when the database was a Supabase Free instance at 381 MB of 500 MB with 224 MB of
`shared_buffers`. Hosted moved to **Pro, 8 GB** on 2026-09-21: storage is no longer a constraint, and the cache is
bigger. The figures below are what was measured then, and the paragraph after this one says what still holds.)*

The hosted database had a **3 s statement timeout on the `anon` role** and 224 MB of `shared_buffers`. Two things followed from that, and both are already written down in `status.md`:

- Recommendation queries that sweep `cards` blow the timeout when the cache is cold. Mitigated by `cards_rec_pool` and `retryOnTimeout`, not fixed.
- Every page view costs queries that have nothing to do with recommendations — `proxy.ts` asks "does this slug exist" on every `/card/:slug` and `/commander/:slug` request, and `fetchCardsById` pulls 120–500 wide rows out of `cards` for every swap, add, commander page and rater deal.

Typesense is a RAM-resident document store with a search engine on top. It is very good at two of our shapes and bad at a third:

| Shape | Fit |
|---|---|
| "Give me these 400 documents by id" | Excellent. This is a hash lookup in RAM; Postgres has to visit 400 heap rows in a 92 MB table. |
| "Rank names by prefix, then contains, then typo" | Excellent, and it is what the engine is for. Today this is `search_cards`: two `LIKE`s and two trigram operators over 37,350 rows, run on every debounced keystroke. |
| "Score candidates by idf-weighted tag-closure overlap" | Poor. Typesense cannot express the `rec_swap_candidates` similarity formula. Any Typesense version of it is an approximation, which collides with the still-open blind swap-quality eval. |

**What the move to Pro changes, and what it does not.** Storage never motivated this work, so nothing here rests on
it. The volume argument is untouched: a commander page still fetches 500 card rows, and each is still a heap visit
in a 92 MB table whatever the plan. What *is* now unmeasured is the urgency — the "cold `shared_buffers`, cancelled
at 3 s" story was Free-tier arithmetic, and Pro has more cache. **Re-read `rec_timeouts` on Pro before treating the
timeout argument as current** (T008 says the same).

So the rule this plan follows: **Typesense holds documents and ranks names. Postgres keeps every join that decides what a recommendation means.** That keeps the recommendation ranking exactly where the regression harness and the pending eval can see it, and it still removes the great majority of the query volume.

The frontend/backend contract does not change. Every read path named below is already a single function in `apps/web/src/lib/server/`, so this is a data-source swap behind those functions and nothing above them moves.

## What moves, what stays

| Read | Today | After |
|---|---|---|
| `proxy.ts` `pageExists` | 1 query per card/commander page view, uncached | Typesense document retrieve by slug |
| `searchCards` (header search, commander picker) | `search_cards` rpc + `fetchCardsById` | One Typesense query, documents come back whole |
| `fetchCardsById` (everywhere: 120–500 ids) | `select CARD_COLUMNS from cards where id in (...)` | Typesense multi-get |
| `fetchCardTags` (deck grouping, 100 cards a time) | `cards_functional_tags` rpc, already wrapped in `retryOnTimeout` | Tag ids on the card document, labels from the `tags` collection |
| `loadCardCorpus` | 5 queries (`card_global_stats`, `commander_card_stats`, `cards`, `card_stats`, `corpus_identity_stats`) | 1 query (`commander_cards` collection); the other four are fields on documents |
| `loadTopCardIds` (commander page) | `commander_card_stats` top 500, or `rec_add_candidates` | `commander_cards` collection, sorted |
| `rec_add_candidates` (adds, rater deals) | SQL function over `cards` + stats | `commander_cards` per source key, merged and weighted in Node by the existing scoring code |
| `rec_swap_candidates` | SQL function | **Stays in Postgres.** Phase 4 precomputes pools for hot targets only. |
| `resolve_card_names` (decklist parsing) | `resolve_card_names` rpc | **Stays.** Correctness of the parser matters more than the query; it runs once per paste, not per keystroke. |
| `resolve_collection_rows` | rpc over `printings` | **Stays.** Printing-level, 525k rows, and driven by exact identifiers — a Postgres index lookup is already the right tool. |
| Everything owned by a user (decks, collections, admin, votes) | Postgres + RLS | **Stays.** Access control is the point; none of it belongs in an index with no row-level security. |

## Collections

Four collections, one document per thing, each self-contained so a read is one call.

### `cards` — one document per oracle card (~34,800)

Document id is the card's **slug**, so `proxy.ts` can retrieve by path segment with no query at all. `id` (the int `CardId`) is a separate indexed field for multi-get.

```
id            int32     // CardId, the surrogate the whole app keys on
slug          string    // = document id
oracle_id     string
name          string    // full name, including "Front // Back"
names         string[]  // card_names.name_normalized: aliases, faces, flavor names
type_line     string
mana_value    float
color_identity string[]  // ["W","B"] — see the identity filter note below
identity_mask int32     // kept for parity with the SQL, not filtered on
keywords      string[]
tag_ids       string[]  // card_tags, tag UUIDs (domain convention: never slugs)
tag_ancestors string[]  // closure to depth 2, so card pages need no second call
game_changer  bool
is_basic_land bool
legal_commander string
can_be_commander bool
partner_kind / partner_qualifier / copy_limit
images        object    // stored, not indexed
artist        string
released_at / first_printed_month
reference_price_usd / reference_price_finish / prices_as_of
staple_score  float     // card_stats
baseline_rate float     // card_global_stats.rate
baseline_decks_with / baseline_eligible_decks
commander_deck_count int32  // for ranking commander pickers
updated_at    int64     // the drain's version stamp
```

That field list is deliberately `CARD_COLUMNS` plus the four small tables the read paths currently join to it. `oracle_text` and `card_faces` are **not** in it — only the card page needs them, it is cached for days, and they are what makes `cards` a 92 MB table.

**Identity as `string[]`, not a bitmask.** Typesense has no bitwise operators, but it does have array negation: `filter_by: color_identity:!=[G,U,R]` returns exactly the cards whose identity fits a WB deck. That is the same predicate as `(c.color_identity & ~p_identity_mask) = 0`, expressed in the only way the engine can express it.

### `commanders` — one document per `commander_keys` row

`slug` as document id (again for `proxy.ts`), commander card ids and names, `color_identity`, `deck_count`, `borrowed` counts, `role_profile`, `computed_at`. Small, and it makes the commander picker's "more-played commanders first" a sort field instead of a left join.

### `tags` — one document per Tagger tag (~4,500)

`id` (the UUID, per the domain convention that tags are never keyed by slug), `slug`, `label`, `idf`, `disabled`, `functional`. Tiny, changes only on a tag sync or a kill-switch flip, and it is what turns the `tag_ids` on a card document into the `TagRef`s the contract returns. The web app can hold the whole thing in a per-instance map with a short TTL, the way `pricesCheckedAt` already works, so tag labels cost no call at all.

### `commander_cards` — one document per (`commander_key`, `card`)

```
id            string   // "<key_id>:<card_id>"
key_id        int32
card_id       int32
decks_with / eligible_decks / inclusion_shrunk / synergy
color_identity string[]  // the card's, for the identity filter
game_changer  bool
category      string    // cardCategory, so a commander page can fill 12 per type
```

At 129 commanders this is a few hundred thousand documents. It is the one collection that grows with the corpus — 2,000 commanders would be millions of documents and a RAM bill. Watch it as commander lookups accumulate; the sizing rule is below.

## Where it plugs into the code

**`packages/core/src/search/`**, exported as `@mtg/core/search` (core already has six subpath entries; this is the seventh and adds no dependency — the client is `fetch`):

- `documents.ts` — the document types and the collection schemas, so the worker that writes and the app that reads cannot drift.
- `mappers.ts` — pure `toCardDocument(row, names, tags, stats, globalStats)` and friends. Unit-tested in vitest like the rest of core.
- `client.ts` — a small typed wrapper over the REST API: `retrieve`, `search`, `multiSearch`, `import`, `deleteByFilter`, alias ops. Timeouts on every call; no retries on writes, because the queue below is the retry.

**`apps/web/src/lib/server/search-index.ts`** — `getSearchIndex()`, reading `SEARCH_API_URL` and `SEARCH_API_TOKEN`. **Returns null when they are unset.** That is what keeps CI (empty database, `NEXT_PUBLIC_USE_MOCKS=1`) and any local checkout working with no search index at all.

Then each read path gains one branch and keeps its signature:

- `card-search.ts` `searchCards`
- `cards.ts` `fetchCardsById` (`pricesCheckedAt` stays as it is — one cheap global value, already cached per instance)
- `card-tags.ts` `fetchCardTags` — the batched call a hundred-card deck makes on every grouping, and one of the few reads that already needed `retryOnTimeout`
- `corpus.ts` `loadCardCorpus`
- `commander-page.ts` `loadTopCardIds`
- `recs.ts` add-candidate loading, and `rater.ts` through it
- `proxy.ts` `pageExists`

**Failure is a fallback, never an error.** Every one of those branches falls through to the Postgres query it replaced when Typesense is unset, times out or errors, and logs. This is the same stance as `getHeroArt` returning null when the database is down: an index we added for speed must not become a new way for the site to break. A check script in the style of `scripts/retry-timeout-check.ts` proves the fallback with a faked fetch, and runs in CI.

**Search stays server-side.** A browser-side Typesense key would bypass the `search` rate-limit bucket, and this repo's stance is that anti-abuse thresholds live in database config. `GET /api/cards/search` keeps its rate limit, its validation and its CDN cache headers; only what it calls underneath changes.

## Keeping it in step

Three mechanisms, each for a different kind of change.

### 1. Triggers write a queue (the part that catches everything)

One table, upsert-keyed so it is bounded by *distinct changed documents* rather than by traffic — the same shape as `rec_timeouts`:

```sql
create table public.search_index_queue (
  collection  text not null check (collection in ('cards','commanders','commander_cards')),
  document_id text not null,
  op          text not null check (op in ('upsert','delete')),
  enqueued_at timestamptz not null default now(),
  primary key (collection, document_id)
);
alter table public.search_index_queue enable row level security;  -- no policies: service_role only
grant all on public.search_index_queue to service_role;

create function public.enqueue_search_index() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_collection text := tg_argv[0];
  v_id text;
begin
  -- tg_argv[1] names the column holding the document key on this table.
  if tg_op = 'DELETE' then
    execute format('select ($1).%I::text', tg_argv[1]) into v_id using old;
  else
    execute format('select ($1).%I::text', tg_argv[1]) into v_id using new;
  end if;
  insert into public.search_index_queue (collection, document_id, op)
  values (v_collection, v_id, case when tg_op = 'DELETE' then 'delete' else 'upsert' end)
  on conflict (collection, document_id)
    do update set op = excluded.op, enqueued_at = now();
  return null;  -- after trigger
end $$;
```

Attached to the tables that feed each document:

| Table | Fires for | Enqueues |
|---|---|---|
| `cards` | insert, delete, update of any indexed column (incl. `deleted_at`, price columns) | that card |
| `card_names` | insert, delete, update | the row's `card_id` |
| `card_tags` | insert, delete, update | the row's `card_id` |
| `card_stats` | update of `staple_score`, `first_printed_at` | the row's `card_id` |
| `card_global_stats` | insert, update | the row's `card_id` |
| `commander_keys`, `commander_stats` | any | that commander key |
| `tags` | update of `slug`, `label`, `idf`, `disabled` | that tag (and the `cards` sentinel below when `disabled` moves) |
| `commander_card_stats` | insert, delete, update | `key_id:card_id` |

Two deliberate omissions. `printings` (525k rows, nothing in a document depends on it directly) has no trigger. And a change to `tags` or `tag_closure` — the kill switch, a relabel, an idf move — can touch thousands of cards at once, so those get a **statement-level** trigger that enqueues a single `('cards','*','upsert')` sentinel the drain reads as "reindex the collection". Those events are rare and a full 35k-document import takes seconds.

**Every sync already writes only the rows that change** (`content_hash`, `is distinct from`, the 0.001 and 0.0001 tolerances), so a row trigger fires on a real change and nothing else. The queue's daily size is therefore the real daily churn. Expect the **price update to dominate it** — that is the one job that legitimately touches tens of thousands of card rows a day, and re-importing those documents is one bulk call.

Worth measuring before merging: what a `sync:catalog --force` (34,829 row trigger firings inside one transaction) costs in wall time and in dead rows on `search_index_queue`. If it is unpleasant, the syncs can insert into the queue straight from their existing changed-rows temp tables and the row triggers can be narrowed to the tables the app itself writes.

### 2. The worker drains it

`apps/worker/src/jobs/sync-search-index.ts`, CLI `sync:typesense [--rebuild]`:

1. Claim a batch from `search_index_queue` with `for update skip locked` (the pattern `serve:commander-requests` already uses).
2. Read the source rows for those ids, build documents through the core mappers, `POST /collections/<c>/documents/import?action=upsert` in JSONL batches.
3. Delete the claimed rows **only after** the import returns success, so a crash replays rather than loses.
4. `--rebuild` writes a fresh `cards_<timestamp>` collection, then moves the `cards` alias to it and drops the old one, so a full reindex is never a window where the site has no index.

Wire it where the cache refresh already is: `finishRun(..., 'succeeded')` calls `refreshWebCaches(job)` after the transaction commits, and the drain belongs next to it, before the revalidate — so a visitor whose cache was just busted reads a current index. Add it to `.github/workflows/sync.yml` after the three syncs, with `SEARCH_API_URL` / `SEARCH_API_ADMIN_TOKEN` as secrets.

### 3. Optional: `pg_cron` for out-of-band edits

Flipping `tags.disabled` in psql enqueues a sentinel that nothing drains until the next sync. If that gap matters, a `pg_cron` job every few minutes can `pg_net`-POST to a new `/api/internal/search-sync` route (bearer secret, same shape as `/api/internal/revalidate`), which drains as `service_role`. That keeps Typesense credentials out of Postgres. It is genuinely optional — today every table in the index is written by the worker.

## Hosting, sizing, cost

Typesense keeps the whole index in RAM, with the raw documents on disk. The rule of thumb is **2–3× the size of the fields you index**. Our indexed subset is names, type lines, tag UUIDs and numerics: roughly 15–20 MB of `cards` plus ~15 MB of `commander_cards`, so **plan on 100–150 MB of RAM today** and verify against the real import.

| Option | Cost | Trade |
|---|---|---|
| **Typesense Cloud**, smallest node (0.5 GB, 2 burst vCPU) | ~$0.03/hr, ~$21.60/mo, plus $0.09/GB egress after 10 GB | Fits comfortably. First recurring bill on a project whose whole point so far is free tiers. |
| **Self-host on the PC that already runs the corpus worker** | Free | Needs a public address Vercel functions can reach, and the site's search then depends on a home machine being up. The fallback path makes that survivable but not good. |
| **Self-host on a small VPS / Fly / Railway** | ~$5/mo | A machine to keep patched. Probably the best value if the fallback is solid. |

Local development: `docker-compose.search.yml` runs both containers on **56325** (Typesense) and **56326** (the API), in the project's own range beside Supabase (56321-56324).

This is the decision that should be made before any code: **which of those three**, and whether a recurring bill is acceptable. Everything else in this plan is the same either way.

## Phases

**Phase 1 — done. The index exists and one read uses it.** `@mtg/core/search`, the `cards` collection, `sync:typesense --rebuild`, and `searchCards` switched over with its fallback. Nothing else changes.
*Done when:* header search and the commander picker return the same cards as `search_cards` for a fixture list of queries (prefix, contains, typo, back-face match), and unsetting `SEARCH_API_URL` still passes the e2e suite.

**Phase 2 — done. Documents replace row fetches.** `fetchCardsById`, `fetchCardTags` (with the `tags` collection), `proxy.ts` `pageExists`. This is the largest single reduction in query volume and it changes no ranking anywhere.
*Done when:* a card page, a commander page and a swap request each issue measurably fewer Supabase queries (instrument `createPublicClient` behind a debug flag and count), and `yarn workspace @mtg/web regress` is byte-identical to its previous output.

**Phase 3 — done. The triggers and the queue.** The migration, the drain, the sync workflow wiring, the `--rebuild` alias swap.
*Done when:* a `sync:catalog --force` followed by a drain leaves no document stale (compare a sample of 500 documents against their rows), and a killed drain replays cleanly.

**Phase 4 — done for reads; `rec_add_candidates` deliberately left alone.** `commander_cards`, `loadCardCorpus`, `loadTopCardIds`, and the add path. The app already re-scores add candidates with `ADD_WEIGHTS`, so the merge-and-weight step moves from SQL into the scoring code that the regression harness already covers.
*Done when:* `regress` output is unchanged and commander pages no longer reach `rec_add_candidates`.

Built: `commander_cards` serves `loadCardCorpus` (five queries down to one) and `loadTopCardIds` on the path where a
commander has decks of its own. The **borrowed-key** path still calls `rec_add_candidates`, and so does the deck
tool's Add: merging several keys at their weights is where the ranking lives, and moving it was not worth doing
blind. Revisit with the eval.

**Phase 5 — swaps, and only if the numbers ask for it.** Do not try to express the tag-closure similarity in Typesense. Two honest options, in order of preference:

1. **Precompute pools for hot targets only.** The ordering inside `rec_swap_candidates` — tag similarity, staple score, mana proximity, functional twin — is *independent of the deck's colors*; identity, exclusions and ownership are filters applied afterwards. So a stored top-N list per target is exactly correct, not an approximation. Doing it for all 34,800 cards is millions of documents and real RAM; doing it for the few hundred targets that actually appear in `rec_timeouts` and in vote data is ~75k documents and kills the timeouts that are actually observed. The long tail falls back to Postgres, which is fine there — it is the cold popular queries that hurt.
2. **Leave it.** By Phase 4 a swap request is one SQL function call instead of a function plus 220 wide row fetches plus five stats queries, and the covering index and the retry are already in place.

An approximate tag-similarity vector is a third option and this plan recommends against it until the blind swap-quality eval has actually run. Changing what "does the same job" means while the gate measuring that is still open would waste the gate.

## What changed while building it

Four things the plan got wrong, all found by measurement rather than reasoning, all now written down in `CLAUDE.md`
and the ops doc:

1. **Document ids had to be the surrogate key, not the slug.** The plan keyed cards by slug so `proxy.ts` could
   retrieve a page by its own path. A rename changes a slug, which would orphan the old document. The proxy now
   filters on an indexed `slug` field instead — still one fast call, and a miss still falls through to Postgres so
   the check stays a superset of what the page loaders find.
2. **The queue needed a counter, not a timestamp.** postgres.js parses a timestamp parameter into a JS `Date`, so a
   microsecond-precision `enqueued_at` passed back compared as older than its own row and the delete matched
   nothing — the drain read the same batch forever. A `bigint` sequence crosses that boundary exactly, and the drain
   now stops rather than repeating a batch it could not clear.
3. **Ranking needed an explicit "starts with" signal.** Typesense scores by token, not by position: "smothering"
   scored *Rug of Smothering* and *Smothering Abomination* identically. `name_head` (the first word of every name),
   weighted above `name`, above `names`, is how `search_cards`' tiers are expressed.
4. **The acceptance criterion for search was wrong.** The plan said the top hit must match `search_cards`. It
   shouldn't: below the prefix tier the SQL falls through to `c.name`, which is alphabetical in practice, where the
   index breaks the tie on how played a card is. Every disagreement measured on the local catalog is the index being
   better — "rhystic" gives Rhystic Study rather than Rhystic Cave, "doubling" gives Doubling Season rather than
   Doubling Chant, a typo'd "lightening bolt" gives Lightning Bolt rather than the double-faced card whose back it
   is. The check now asserts the index never *invents* a result and reports the ordering differences instead.

## Open questions

- Hosting and budget — **settled: the owner's VPS.**
- Does `commander_cards` stay affordable as commander lookups accumulate? Re-check the sizing at 500 commanders.
- Should the `cards` collection carry `oracle_text` so card pages stop touching `cards` at all? It roughly doubles the index and card pages are cached for days, so probably not — but measure once Phase 2 is in.
