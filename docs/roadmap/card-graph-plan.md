# Deck aggregation pipeline and card value scoring — implementation plan

Status: **revised 2026-10-05**: data layers, a collator and a precompute worker, after the owner's review of PRs #127 and
#128. Tracked as T035 and T053–T065 in [`../tasks.md`](../tasks.md). The scoring built on this pipeline (formulas,
modes, bracket rules, evaluation) is [`scoring-design.md`](scoring-design.md); the crawl's full account is
[`deck-crawl.md`](deck-crawl.md).

Replaces the ad-hoc corpus flow (a deck file, rebuilt by hand) with one pipeline in Postgres, and adds card-pair
statistics and a deck affinity score.

Principle: **store only relationships real decks produce, precompute them ahead of requests, and rank a few hundred
candidates per request from indexed lookups.** Never the card × card × commander product, and never a play rate
computed while the player waits.

## Owner decisions this rests on

**2026-09-21**
- All data moves into Postgres. The owner's legal team consented to using **all publicly facing data** (no
  paywall, no login) from every platform, EDHREC and MTGGoldfish included. The retrieval guardrails that still
  apply are under "Crawler guardrails" below.
- User decks, public or private, count toward stats **only when complete** (exactly 100 cards and legal). A partial
  deck's relationships are worthless.
- The full commander suite gets crawled. The 50-commander corpus was a proof of concept.
- Pairs are sparse, observed-only and conditioned on commander.
- Collections stay as they are. Win-condition analysis waits.

**2026-10-05**
- **Every source keeps its data in its own schema, as the source published it.** A collator resolves it into
  `corpus`, where every row names its source. A precompute worker builds everything the app reads.
- **The database stays dumb.** Anything that doesn't depend on the player's deck is computed ahead; a request is
  index reads plus small per-deck sums. This is the key to speed.
- **Relationships are sparse.** A card gets a relationship only with cards seen in the same commander's decks, or
  sharing a combo with it.
- **The deck spike's files are stale and redundant.** Their numbers reached hosted as the 2026-09-15 aggregate; the
  first rebuild from crawled decks replaces it. Nothing imports them.
- **A crawl revisit grows a commander's sample** until 25 decks were new or changed ("Crawl" below).
- **`minDecks` and `fullDecks` are both 50.**

## Plan against the repo

| Concern | `develop` on 2026-10-05 | Plan |
|---|---|---|
| Deck storage | `corpus.decks`, written by the Archidekt crawl with card ids resolved on write (68,763 decks, 3,235 commander keys on hosted); `aggregate:corpus` read the old deck spike's file (T053 retired it and points the job at the collated `corpus.decks`) | Raw `archidekt.decks` as fetched → collated `corpus.decks` for every deck source, with `source` on each row → serving tables |
| External statistics | `public.external_commanders`, `public.external_commander_card_stats` (EDHREC, resolved on import) | Raw `edhrec.*` → collated `corpus.edhrec_commanders`, `corpus.edhrec_commander_cards` |
| Combos | PR #127 (open) loads `public.combos` | Raw `spellbook.*` → `corpus.spellbook_combos` → serving `spellbook_combo_pieces` |
| Crawl machinery | `corpus.crawl_runs`, `crawl_state`, `crawl_commanders` | `crawl.runs`, `crawl.state`, `crawl.queue`, unchanged otherwise |
| Which decks count | `resolveDeck` in the worker; `save_deck` flags user decks on per-card legality only | The collator applies one rule to every deck source |
| Crawl depth | Revisits re-read page 1 only, so samples grow only from churn (93 decks at most) | A revisit reads on until 25 decks were new or changed |
| Where jobs run | The crawl on the VPS (search API); aggregates and EDHREC loads by hand; a VPS worker is in PR #128 | The VPS worker runs the collator and the precompute worker on a schedule |
| Commander card stats | `commander_card_stats` and friends: full rebuild with diff writes | Recomputed **per dirty commander** |
| Recommendation reads | `rec_add_candidates` and `rec_swap_candidates` score every request in SQL, then TypeScript re-scores. On hosted their calls average 0.8–1.0 s and peak at the 3 s timeout; one ran out of retries on 2026-09-30 (T008) | Indexed reads of precomputed serving tables; both functions retire |
| Card pairs | None (T020 shelved them as too heavy) | `commander_card_pairs` plus a `card_pairs` global backoff |
| Weights | `ADD_WEIGHTS` and `SWAP_WEIGHTS` in code, with a SQL mirror in `rec_swap_candidates` | `app_config.scoring`, read by TypeScript |
| Measuring quality | `rec-regress.ts` fixtures; blind eval T014 (needs raters) | Plus an offline holdout evaluation that gates every weight change ([`scoring-design.md`](scoring-design.md), "Evaluation") |
| Materialized views | None | None. `refresh` rewrites every row, which breaks the diff-only write rule |

## Data layers

```
fetchers                raw (one schema per source)      collator         corpus (collated)                     precompute       public (serving)
Go crawl ─────────────► archidekt.decks ──────────────┐                ┌► corpus.decks           archidekt|user ─┐
sync:edhrec ──────────► edhrec.commanders,           ├──► collate ────┼► corpus.edhrec_*        edhrec          ├──► precompute ──► commander_card_scores, commander_stats,
                        edhrec.commander_cards        │                └► corpus.spellbook_*     spellbook       ┘                   card_global_stats, commander_card_pairs,
sync:spellbook ───────► spellbook.combos,             │                                                                              card_pairs, card_substitutes,
                        spellbook.features ───────────┘                                                                              card_roles, spellbook_combo_pieces
public.decks (complete user decks) ──────────────────►  collate
```

**Rules:**
1. **Each table has one writer.** A raw schema is written only by its source's fetcher, `crawl` only by the crawler,
   `corpus` only by the collator, and the serving tables only by the precompute worker.
2. **Each layer reads only the one before it.** The web app and the search index read serving tables and the card
   catalog, nothing else.
3. **Raw is what the source published, in the source's own identifiers**: Scryfall oracle ids, card names, printing
   ids. Nothing in raw depends on our catalog, so no fetcher waits for `sync:catalog`.
4. **Resolution happens once, in the collator**, with the same rules for every source. A row that doesn't fully
   resolve stays in raw and is retried when the catalog changes. It never reaches `corpus` half-resolved, so the
   2026-10-03 rule holds: no 99-card deck in the corpus. Unlike today, the deck is not fetched again.
5. **A corpus row names its source in a column; a raw row's source is its schema.**
6. **Names say whose data a table holds.** A table with one source's rows names that source in its schema (raw) or
   its name (`corpus.edhrec_commanders`, `corpus.spellbook_combos`) and has no `source` column; a table that mixes
   sources has a generic name and a `source` column (`corpus.decks`, `crawl.runs`). Columns, functions and the fetch
   commands follow suit (`crawl.queue.edhrec_deck_count`, `edhrec_card_priors`, `sync:edhrec`, `sync:spellbook`). The card
   catalog is exempt (owner decision 2026-10-05): `cards`, `printings`, `tags` and the rest are our own catalog built
   from Scryfall, keyed by our ids, so they keep their names, and so does the `oracle_tags` sync job.
7. **Raw, `crawl` and `corpus` are private.** `service_role` only, and
   never in PostgREST's exposed schemas. Serving tables are public reads where the numbers are ours; a table carrying
   a third party's numbers stays `service_role` only.

### Raw: one schema per source

**`archidekt`**

```sql
create table archidekt.decks (
  id                bigint primary key default nextval('crawl.deck_id_seq'),  -- one id space across deck sources
  source_deck_id    text not null unique,
  commanders        uuid[] not null,      -- oracle ids as the source reports them, sorted
  card_oracle_ids   uuid[] not null,      -- the rest of the deck, sorted
  quantities        smallint[] not null,  -- copies, aligned with card_oracle_ids
  deck_size         integer not null,
  declared_bracket  smallint,             -- the author's bracket (edhBracket): checks our estimator, never scores (2026-10-05)
  content_hash      text not null,        -- the crawler's hash over oracle ids, unchanged
  listed_updated_at timestamptz,
  last_updated_at   timestamptz,
  fetched_at        timestamptz not null default now()
);
```

Today's `corpus.decks` moves here. Its card ids go back to oracle ids once, which is the migration's only full
rewrite (68,763 rows, about 115 MB). Oracle ids are stored as `uuid` arrays rather than JSON keys: 16 bytes a card
instead of a 36-character key, about 2.5 times smaller, which matters at the full crawl's half a million decks. The
crawler still sends `{oracle id: quantity}`; `crawl_upsert_decks` unpacks it.

This replaces the 2026-10-03 mechanism (a deck naming a card the catalog lacks was not stored, and was fetched again
on the next visit) while keeping its intent: such a deck is stored raw and reaches the corpus only once every card
resolves.

**`edhrec`**

```sql
create table edhrec.commanders (
  slug        text primary key,
  names       text[] not null,     -- the commander names the page gives
  printing_id uuid,                -- the page's own card, when it names one
  deck_count  integer not null,
  fetched_at  timestamptz not null
);
create table edhrec.commander_cards (
  slug            text not null references edhrec.commanders (slug) on delete cascade,
  name            text not null,
  printing_id     uuid,
  decks_with      integer not null,
  potential_decks integer not null,
  synergy         real,            -- theirs, as published
  primary key (slug, name)
);
```

`sync:edhrec` (PR #128) writes these. They start empty and fill on its first run, about 3.5 hours. Not stored: salt,
rank, prices, images, page panels.

**`spellbook`**

```sql
create table spellbook.combos (
  variant_id        text primary key,     -- '2645-5640-7935'; commanderspellbook.com/combo/<id>/
  uses              jsonb not null,       -- [{oracleId, name, mustBeCommander}]
  templates         text[] not null,      -- pieces described, not named
  feature_ids       integer[] not null,
  bracket_tag       text not null,
  mana_value_needed smallint not null,
  edhrec_deck_count integer,              -- Spellbook's count of EDHREC decks: never displayed, never leaves raw
  combo_ids         integer[] not null
);
create table spellbook.features (id integer primary key, name text not null, status text not null);
```

PR #127 is reworked to create these in place of `public.combos` and `public.combo_features`.

**`moxfield`** has a `decks` table shaped like Archidekt's, empty: the crawl engine already carries a Moxfield adapter, seeded off until Moxfield grants access (T044). Every deck source's table takes its ids from one sequence (`crawl.deck_id_seq`), so a deck id names one deck whichever source it came from, and the `crawl.decks` view reads them together with the source as a column.

### `crawl`: the crawler's machinery

`corpus.crawl_runs`, `crawl_state` and `crawl_commanders` move to `crawl.runs`, `crawl.state` and `crawl.queue`, with
their columns unchanged. They record how the crawler works, not what a source published, and one engine serves every
deck source (each row carries `source`). The `crawl.decks` view is what the engine and the admin pages read.

The 13 `public.crawl_*` functions the Go service calls keep their names and arguments, so the service doesn't change.
Only their bodies point at the new tables:
- `crawl_upsert_decks` writes the source's own raw table (`archidekt.decks`) and resolves nothing. Its `unresolved`
  list now holds only decks with an id that is not an oracle id at all.
- `crawl_seed_commanders` counts held decks from the raw table. The commanders are stored as `uuid`, so the join
  to `cards.oracle_id` is uuid to uuid and uses its index. Casting the indexed side to text is what timed out hosted
  run 8.

### `corpus`: collated, every row tagged with its source

```sql
create table corpus.decks (
  id                 bigint generated always as identity primary key,
  source             text not null check (source in ('archidekt', 'moxfield', 'user')),
  source_deck_id     text not null,
  user_deck_id       uuid references public.decks (id) on delete cascade,  -- user decks only
  commander_card_ids integer[] not null,  -- sorted: one, or a legal pair
  color_identity     smallint not null,
  card_ids           integer[] not null,  -- sorted, distinct, the rest of the deck, basics excluded
  basic_lands        smallint not null,   -- copies of basics, for land counts
  updated_month      date not null,       -- release-aware counting
  content_hash       bytea not null,      -- commanders + cards: a deck on two sites counts once
  collated_at        timestamptz not null default now(),
  unique (source, source_deck_id)
);

create table corpus.dirty_commanders (    -- upsert-keyed, like search_index_queue
  commander_1 integer not null,
  commander_2 integer not null,           -- 0 when none
  seq         bigint not null,
  primary key (commander_1, commander_2)
);
```

- **Only decks that pass the one rule are stored**: a legal commander or pair, every card resolved and inside the
  identity, exactly 100 cards. Exclusions are counted in the collation run's metrics, not stored. The allowance of
  three unknown cards (`maxUnresolvedCards`) goes: a deck now waits in raw until every card resolves.
- **User decks** come from `public.decks` and `deck_cards` when complete and legal (T035 slice 3's rule). The
  `user_deck_id` foreign key means a deleted deck or account leaves the corpus at once, and a trigger marks the
  commander dirty.
- **`corpus.edhrec_commanders` and `corpus.edhrec_commander_cards`** are the old `public.external_commanders` and
  `public.external_commander_card_stats`, moved and renamed with their rows. Their `source` column, always 'edhrec',
  is gone: the names say it. The collator writes them from `edhrec.*`. They gain `edhrec_commanders.listed_floor`, the
  lowest inclusion the page lists; scoring uses it for unlisted cards.
- **`corpus.spellbook_combos`** holds one row per combo: `variant_id` (Spellbook's id), `card_ids`,
  `commander_card_ids`, `template_names`, `results` (standalone and contextual result names; Spellbook's hidden steps
  are dropped), `min_bracket` (from Spellbook's tag), `color_identity` and `mana_value_needed`. Combos tagged banned
  are left out. EDHREC's count stays in raw.

### The reorg migration (T053)

**Built 2026-10-05** as `supabase/migrations/20261005000200_data_layers.sql`:

1. Creates the schemas `archidekt`, `moxfield`, `edhrec`, `spellbook` and `crawl`, with usage for `service_role` only.
2. Moves tables:
   - `corpus.crawl_runs`, `crawl_state` and `crawl_commanders` → `crawl.runs`, `crawl.state`, `crawl.queue`.
   - `corpus.decks` → `archidekt.decks`, with card ids converted back to oracle ids (`uuid[]`, quantities aligned). A
     check refuses the migration if any deck, commander or card is lost on the way.
   - `public.external_commanders` and `external_commander_card_stats` → `corpus.edhrec_commanders` and
     `corpus.edhrec_commander_cards`, with the always-'edhrec' `source` column dropped (`external_commander_id` becomes
     `edhrec_commander_id`). `listed_floor` is added empty; the collator fills it.
   - `crawl.queue.seed_decks` becomes `edhrec_deck_count`, and every moved table's constraints are renamed after it.
3. Creates the empty raw `edhrec.*` and `moxfield.decks` tables, the `crawl.decks` view, the collated `corpus.decks`
   and `corpus.dirty_commanders`.
4. Recreates every function that names a moved table, with the same names and arguments: the 13 crawl functions, the
   `admin_*` crawl readers, and the EDHREC prior, renamed `edhrec_card_priors` (from `external_card_priors`).
   `crawl_deck_hashes`, which nothing called, is dropped.
5. Updates the SQL checks (`crawl-commanders.sql`, `admin-crawled-decks.sql`, `edhrec-stats.sql` (was `external-stats.sql`),
   `edhrec-prior.sql`) and adds `data-layers.sql`.

Moving a table between schemas or renaming it rewrites no rows; the deck conversion is the one rewrite (about 77,000
decks on hosted). Until the collator ships (T054), `corpus.decks` is empty and nothing reads it.

## Collator (T054)

`cli collate` on the VPS worker, recorded in `sync_runs` as `corpus_collate`.

- **When:** after every fetch (a crawl run ending, `sync:edhrec`, `sync:spellbook`), and after `sync:catalog`, so raw
  rows that failed to resolve get another try.
- **Incremental:** per source, only raw rows changed since the last successful collation, plus rows still
  unresolved.
- **Decks:** resolve oracle ids to card ids, apply the one rule, and write only rows whose content hash differs.
  Delete corpus rows whose raw row is gone, and mark changed commanders dirty.
- **EDHREC:** resolve each page's names by printing id first, then by unique name, as the retired `import:edhrec` did.
  Every commander name must resolve. Compute `listed_floor`.
- **Spellbook:** resolve every piece by oracle id or skip the combo, map the bracket tag to `min_bracket`, and drop
  banned combos and hidden steps.
- **Sanity gate per source**, like the syncs: a collation that would remove more than a set share of a source's
  corpus rows refuses (the share lives in `app_config.corpus`).
- **Metrics** per source: rows resolved, unresolved, and excluded by reason.

## Precompute worker (T055)

A recommendation request reads indexed rows and does small per-deck sums. Nothing recomputes play rates, pairs or
tag similarity while the player waits.

| Serving table | Key | Holds | Rows (est.) | Recomputed |
|---|---|---|---|---|
| `commander_card_scores` | `(commander_1, commander_2, card_id)`, with `commander_2` 0 for one commander | The card's final `corpus` score for that commander ([`scoring-design.md`](scoring-design.md)), plus our own counts for evidence | ~3M for our commanders, ~1M more for EDHREC-only ones | Per dirty commander |
| `commander_stats` (exists) | Commander key | Gains `curve_profile`, `land_count` and `basic_land_count` | 3,235 | Per dirty commander |
| `card_global_stats` (exists) | Card | Baseline p0 | ~21k | Nightly, summed from per-commander partials |
| `commander_card_pairs`, `card_pairs` | See "Statistics" | Lift and PMI | 4–11M | Per dirty commander; global weekly |
| `card_substitutes` | `(card_id, substitute_id)` | idf-weighted functional tag similarity (exclusive tag modes applied, as `rec_swap_candidates` does): the top 50 inside the card's own colour identity, which suit every deck that can hold the card, plus the top 50 overall | ~3M | After `sync:tags`, changed cards only |
| `card_roles` | `(card_id, role_id)` | Which tracked roles a card fills | ~60k | After `sync:tags` |
| `spellbook_combo_pieces` | `(card_id, combo_id)` | Which combos a card is in; per combo: pieces, minimum bracket, result weight, commander requirement | ~400k | After Spellbook collation |

- **Keyed by commander cards**, not `commander_keys`. `commander_keys` rows stay what they are, our commander pages,
  so an EDHREC-only commander gets scores without becoming a page.
- **A pair no source knows** is scored from each partner's own rows at `partnerPoolWeight`, combined in the request
  by the same rule as `pickCorpusSources`.
- **A card with no row** (never seen with the commander, not on its EDHREC page) gets its score from
  `card_global_stats` and the commander's deck counts. That is a pure function in `@mtg/core`, so the table holds only
  observed cards.
- **Evidence shows our own counts only.** A score built mostly on EDHREC's numbers never displays them.

**The request path after the switch:**

```
1. one Promise.all:
     top N of commander_card_scores for the deck's commanders      (the add pool)
     commander_card_scores for the deck's cards and owned cards     (cuts, collection mode)
     card_roles for pool ∪ deck · card_substitutes for a swap target
     commander_card_pairs + card_pairs for the deck's cards · spellbook_combo_pieces for the deck's cards
2. pure @mtg/core: m(c | deck) for adds, m(c | deck − c) for cuts, the swap blend, combo completions
3. explain: components and evidence, top 20 per category
```

- `rec_add_candidates` and `rec_swap_candidates` retire, along with `retry-timeout.ts` and `rec_timeouts`. That
  closes T008 and makes T040 moot.
- Every write is a stage, sanity gate and diff-only merge, skipping moves under 0.001 as `aggregate:corpus` does.
  Then the usual `startRun`/`finishRun`, index drain and cache revalidation.
- **Schedule** (VPS worker, `app_config.worker`): collation after each fetch; dirty commanders recomputed after each
  collation; `card_global_stats` nightly; `card_pairs` weekly; `card_roles` and `card_substitutes` after `sync:tags`
  changes; `spellbook_combo_pieces` after Spellbook collation.
- **Parity first.** The switch must reproduce today's add and swap lists (regression fixtures plus a parity script),
  so speed and scoring changes ship separately.

## Scale

Hosted on 2026-10-05:

| | Value |
|---|---|
| Database | 705 MB of Supabase Pro's 8 GB |
| Crawled decks (`corpus.decks`) | 68,763 decks over 3,235 commander keys, 115 MB; 947 keys with ≥ 50 decks |
| EDHREC | 6,787 commanders, 1.79M card rows, 160 MB |
| EDHREC's sample against ours, same commander | 29× at the 10th percentile, 91× median, 645× at the 90th |
| Our commander keys without an EDHREC page | 806 of 3,235 |
| Today's serving stats (from the 2026-09-15 run) | 129 keys, 117,927 commander-card rows, 18 MB |

At full size the serving layer adds about 1.5–2.5 GB: scores about 0.6 GB, pairs 0.5–1.2 GB, substitutes about
0.3 GB. That fits in Pro's 8 GB.

Pair estimates, measured on the 52 commander keys with ≥ 50 decks in the old deck file (84.8 non-basic cards per
deck). A pair is kept when it is seen in at least max(5, 5% of the key's decks). Lift is shrunk with α = 10 toward the
card's commander rate.

| Pruning | Pairs per key | ~2,500 keys |
|---|---|---|
| Support threshold only | 9,457 | ~24M rows |
| Lift > 1.2, up to 50 partners per card | 4,268 | ~10.7M rows, ~1.2 GB with indexes |
| Lift > 1.5, up to 50 partners per card | 1,744 | ~4.4M rows, ~0.5 GB with indexes |

The lift floor and the partner cap live in `app_config` and start at **1.2 and 50**. The offline evaluation decides
whether the extra 6M rows over the 1.5 floor earn their place. The pair job's sanity gate refuses a run that would
double the table. With 50–100 decks per commander, per-commander pairs are thin; the backoff to global pairs carries
them.

## Statistics

For a commander key K, over the decks that could have run both cards (updated in or after the later release month):

```
p̂(B|K)    = commander_card_stats.inclusion_shrunk           existing: (x + α·p0) / (n + α)
P̂(B|A,K)  = (n_ab + α_pair · p̂(B|K)) / (n_a + α_pair)       shrinks toward "no association"
lift_ab    = P̂(B|A,K) / p̂(B|K)
pmi_ab     = ln(lift_ab)
```

- **Global layer.** The same formulas over the whole corpus. Denominators count only decks whose identity allows
  both cards, the same way p0 counts eligible decks.
- **Backoff.** `pmi = w·pmi_K + (1 − w)·pmi_global`, where `w = n_a,K / (n_a,K + β)`. A new or thin commander leans
  on the global graph, and a commander with thousands of decks stands on its own.
- **Pruning.** Keep a pair when its support is at least max(`pairMinSupport`, `pairMinShare`·n), its lift is above
  `pairLiftFloor`, and it is in either card's top `pairMaxPartners`. Negative associations are dropped for now.
- **New settings in `app_config.corpus`:** `pairShrinkAlpha`, `pairBackoffBeta`, `pairMinSupport`, `pairMinShare`,
  `pairLiftFloor`, `pairMaxPartners`.
- **Counting:** per dirty commander, load its corpus decks and count cards and pairs in memory with pure functions
  from `@mtg/core/scoring/pairs.ts`. A key with 5,000 decks is about 18M pair increments, which takes seconds.
- **Global pairs** are recounted weekly with a dense upper-triangle counter over cards above `minDecks`: about 450 MB
  of memory at 15k eligible cards. Check the VPS has that room beside Typesense before T064. Only changed rows are
  written.

## Crawl

Built 2026-10-01 in the Go search API (`internal/crawl/`, adapter `internal/archidekt/`);
[`deck-crawl.md`](deck-crawl.md) is the account and runbook.

- The queue is seeded from EDHREC's commander list and ordered by need: commanders under `targetDecks` (60) first.
- Each commander's decks are listed most viewed first, never `-updatedAt`: Archidekt bumps `updatedAt` faster than a
  polite crawl can page.
- A requested commander goes to the front of the queue (PR #128).

**How a commander's sample grows (owner rule, 2026-10-05; T056):**
- A first visit reads one page: up to 60 decks, most viewed first.
- A revisit re-reads page 1 and fetches every deck that is new, or whose listed update time moved since the last
  crawl.
- If fewer than `revisitNewDecks` (25) decks were new or changed, it reads the next page, and so on, until 25 are
  reached or the list ends.
- Every deck fetched because it was new or changed counts toward the 25, whichever commander leads it, so 25 also
  bounds a revisit's deck requests. A deck led by another commander is still kept for that commander.
- `maxPagesPerCommander` (40) and `maxFetchesPerCommander` (120) stay as ceilings.
- This replaces `revisitPages` (page 1 only, 2026-10-03), under which a sample grew only as decks entered the top 60
  by views: 204 commanders had passed 60 decks by 2026-10-05, and none had passed 93.
- The adapter also reads each deck's declared bracket into `archidekt.decks.declared_bracket`.

## Crawler guardrails (every source)

Consent covers the data. These rules cover how it is fetched, and they don't change with consent:

- **One limiter per host**, shared by every worker. Only one crawler process runs per source.
- **Jitter** on normal spacing, not only on backoff.
- **Exponential backoff honouring `Retry-After`.**
- **A request timeout**, so one hung request can't stall a crawl.
- **Graceful shutdown.** On SIGINT or SIGTERM the crawler finishes its batch, commits, releases its claim, and exits.
- **robots.txt is obeyed.** It is read once per run per host, and disallowed paths are never requested. Today that
  rules out EDHREC's `/deckpreview/` (its individual decklists), MTGGoldfish's `/deck/download*` and
  `/embed/decklist`, and `backend.commanderspellbook.com`.
- **An honest User-Agent**, with no fingerprint spoofing, UA rotation, proxies or challenge solvers.
- **A block stops the source.** A 403, a Cloudflare challenge or a bot wall switches that source off until someone
  re-enables it by hand. `json.edhrec.com` is a static S3 bucket behind CloudFront: a key that doesn't exist answers
  403 with `server: AmazonS3`, which counts as a missing page, not a block.

## External statistics (EDHREC)

EDHREC publishes aggregates, not decklists, and its data comes from Moxfield and Archidekt decks. So it is a
**statistics source, never a deck source**. Adding it to deck counts would count Archidekt decks twice and still yield
no pairs.

- **Layers:** `sync:edhrec` writes `edhrec.*` weekly; the collator resolves pages into `corpus.edhrec_commanders`
  and `corpus.edhrec_commander_cards`. Commanders are keyed by their own cards, since EDHREC covers ~6,800
  commanders and `commander_keys` rows are our commander pages.
- **Its lists are trimmed by length, not by rate.** A page lists about 270 cards whatever its size. The lowest listed
  inclusion is 7.7% (median) for commanders under 100 decks, 4.8% for 100–999, 3.2% for 1,000–4,999 and 2.6% for
  5,000 and up. A missing row means "below this page's floor", not "never played".
- **Uses:** the prior for our scores (strength from its deck count, [`scoring-design.md`](scoring-design.md)), part of
  each commander's candidate pool, and a benchmark in the evaluation.
- **Never displayed.** If that changes, credit and link EDHREC wherever its numbers appear.

**Prior evaluation (2026-09-28, `spike:edhrec:prior`, since retired; T058 repeats it).** For 49 commanders with at least 200 of our decks (from the old
deck file): hide all but 50 as the answer key, estimate each card's inclusion from n of the 50 shrunk toward the
colour baseline or toward EDHREC's inclusion for that commander, and grade the top 50 against the hidden decks.

| Our decks | Top-50 synergy overlap, colour | EDHREC | Commanders where EDHREC wins |
|---|---|---|---|
| 0 | 6% | 80% | 49 of 49 |
| 5 | 58% | 82% | 49 of 49 |
| 10 | 70% | 81% | 48 of 49 |
| 20 | 78% | 83% | 43 of 49 |
| 50 | 86% | 88% | 35 of 49 |

EDHREC's sample includes some of the decks hidden here, but it is at least 12× ours for these commanders (median 92×).
The evaluation repeats this with a time split (scoring-design.md).

## Card value scoring

The scoring itself is [`scoring-design.md`](scoring-design.md): components, the one marginal-value function, modes and
the evaluation. This plan supplies its inputs.

| Component | Meaning | Serving source | State |
|---|---|---|---|
| `corpus` | How this commander's decks (and EDHREC) play the card, against the colour baseline | `commander_card_scores` | Exists, computed per request today |
| `deck` | How strongly it connects to cards already in **this** deck | Pair tables | New |
| `role` | Does the deck need another card of this role | `card_roles`, `commander_stats.role_profile` | Exists |
| `curve` | Does the deck need a card at this mana value | `commander_stats.curve_profile` | New |
| `tag` | Does the same job (swaps) | `card_substitutes` | Exists, computed per request today |
| `manaValue`, `staple`, `votes` | Swap fit, reprint breadth, rater votes (T006) | Existing | Exist |

Deck affinity:

```
deckAffinity(c) = Σ_{A ∈ deck} idf(A) · max(0, pmi(A, c))  /  Σ_{A ∈ deck} idf(A)      scaled to 0–1
idf(A)          = ln(1 / p̂(A|K))        specific cards (Viscera Seer) outweigh generic ones (Arcane Signet)
evidence        = the three deck cards contributing most
```

- **Swaps.** A replacement's affinity is measured against the deck minus the card being replaced, and that card's
  own affinity is the baseline to beat.
- **Cuts.** A new cut reason, `LOW_AFFINITY`: the card connects to little else in the deck. It applies only above
  `minDecks`, like `LOW_SYNERGY`.
- **Web read path:** every serving read goes in the one `Promise.all`; global pair rows per card are cached
  (`use cache`, `cacheLife("days")`, tag `corpus`); the client receives components and evidence, never pair maps; and
  serving reads stay out of `next/cache` imports in `recs.ts`, so `regress` and the evaluation run outside Next.js.

## Combo relationships (Commander Spellbook)

Pairs say which cards decks run together; combos say which cards *work* together, whatever the commander and however
few decks it has.

- **Layers:** `sync:spellbook` (PR #127's `sync:combos`, renamed) writes `spellbook.*` daily from the published export; the collator writes
  `corpus.spellbook_combos`; the precompute worker writes `spellbook_combo_pieces`.
- **Pool.** The missing piece of a combo the deck is one card short of joins the candidate pool.
- **Shown as its own Add group** (decided 2026-10-05): "complete a combo", listing only combos the chosen bracket
  allows, each credited and linked to Spellbook. A combo already in the deck above the bracket is flagged with a cut
  offered. Details in [`scoring-design.md`](scoring-design.md).

## Tasks

Each task is one PR into `develop`. The original slices map onto them as shown.

| Task | What | Was |
|---|---|---|
| T053 | Data layers: schemas and table moves (with PR #127 reworked into `spellbook`) | Slice 2, in part |
| T054 | Collator, every source including complete user decks (with PR #128 reworked) | Slices 2–3 |
| T055 | Precompute worker and the serving request path; retire the rec SQL functions | Slice 4, and new |
| T056 | Crawl growth: revisits read on until 25 decks were new or changed; declared brackets in raw | Slice 10 |
| T057 | Scoring weights into `app_config.scoring` | Slice 1 |
| T058 | Offline evaluation | Slice 6 |
| T061 | EDHREC prior by sample size | Slice 11's prior |
| T062 | Learned skeleton: curve and land profiles, EDHREC role and curve priors | New |
| T064 | Deck affinity from card pairs, `LOW_AFFINITY`, contract `deck` component | Slices 5, 7–9 |

T059 (collection mode), T060 (bracket rules and combos), T063 (build mode) and T065 (live accept rate) are scoring
work in [`scoring-design.md`](scoring-design.md).

## Out of scope

- **MTGGoldfish.** It is allowed now, but its decks lean toward constructed formats and its deck downloads are
  disallowed by robots.txt. It is low value for Commander, so it waits until the other sources are running.
- **Moxfield** until its API access or User-Agent whitelist is confirmed. Its whitelisting wants a production
  domain (T033). Its adapter in the crawl engine is shelved: a 2026-09-22 probe from the VPS answered Cloudflare's
  hard WAF block, so the source stays off until access is granted.
- Negative associations, win-condition analysis, multiple collections, and embeddings.
