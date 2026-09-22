# Deck aggregation pipeline and card value scoring — implementation plan

Status: **final plan, shelved** (2026-09-21) until a backend owner picks it up. Tracked as T035 in
[`../tasks.md`](../tasks.md).

Replaces the ad-hoc corpus flow (JSONL on X:, rebuilt from the home PC) with one pipeline in Postgres, and adds
card-pair statistics and a deck affinity score.

Principle: **store only relationships real decks produce, precompute them on ingestion, and rank a few hundred
candidates per request from indexed lookups.** Never the card × card × commander product.

## Owner decisions this rests on (2026-09-21)

- All data moves into Postgres. The owner's legal team consented to using **all publicly facing data** (no
  paywall, no login) from every platform, EDHREC and MTGGoldfish included. The retrieval guardrails that still
  apply are under "Crawler guardrails" below.
- User decks, public or private, count toward stats **only when complete** (exactly 100 cards and legal). A partial
  deck's relationships are worthless.
- The full commander suite gets crawled. The 50-commander corpus was a proof of concept.
- Pairs are sparse, observed-only and conditioned on commander.
- Collections stay as they are. Win-condition analysis waits.

## Plan against the repo

| Concern | Repo today | Plan |
|---|---|---|
| Deck storage | Archidekt decks in `X:\mtg_proj\archidekt\spike\decks.jsonl` (15,346 decks) | `corpus.decks` in Postgres, with card lists as a sorted `int[]` |
| Deck sources | Archidekt only; `aggregateCorpus({ source: 'archidekt' })` | `DeckSource` adapters: Archidekt crawl and complete user decks, with Moxfield once its API access is confirmed. Nothing downstream sees the source |
| External statistics | None (CLAUDE.md allows EDHREC since 2026-09-21; nothing reads it yet) | `StatsSource` adapter: EDHREC commander pages → `external_commander_card_stats`, used as a prior for thin commanders and as a benchmark. Never mixed into deck counts |
| Which decks count | `resolveDeck` for Archidekt; `save_deck` flags user decks on per-card legality only, so a 70-card deck is flagged | One rule for every source: `resolveDeck` (100 cards, identity, legal pair, ≤ 3 unresolved) |
| Crawl coverage | Top 50 commanders, run by hand (`spike:archidekt:crawl`) | Every commander with ≥ 50 listed decks (≈ 2,800), from a queue on an always-on worker (T010) |
| Where jobs run | Home PC | VPS worker container, next to `search-api` |
| Commander card stats | `commander_card_stats`, `card_global_stats`, `commander_stats` — full rebuild with diff writes | Same tables and formulas, recomputed **per dirty commander key** |
| Card pairs | None (T020 shelved them as too heavy) | `commander_card_pairs` plus a `card_pairs` global backoff |
| Candidate pool | `rec_add_candidates` top 400 by corpus score; `rec_swap_candidates` 220 by tags | Add the deck's graph neighbours to both pools |
| Score components | `tag, manaValue, staple, corpus, votes, role` (contract v10) | Add `deck` (deck affinity), in contract v11 |
| Weights | `ADD_WEIGHTS` and `SWAP_WEIGHTS` in code, with a SQL mirror in `rec_swap_candidates` | Move all weights to `app_config.scoring`, read by both TS and SQL, which ends the mirror |
| Measuring quality | `rec-regress.ts` fixtures; blind eval T014 (needs raters) | Add an offline holdout evaluation that gates every weight change |
| Materialized views | None | None. `refresh` rewrites every row, which breaks the diff-only write rule |

## Scale

Measured on today's corpus, the 52 commander keys with ≥ 50 decks (84.8 non-basic cards per deck). A pair is kept
when it is seen in at least max(5, 5% of the key's decks). Lift is shrunk with α = 10 toward the card's commander
rate.

| Pruning | Pairs per key | Full suite, ~2,500 keys |
|---|---|---|
| Support threshold only | 9,457 | ~24M rows |
| Lift > 1.2, up to 50 partners per card | 4,268 | ~10.7M rows, ~1.2 GB with indexes |
| Lift > 1.5, up to 50 partners per card | 1,744 | ~4.4M rows, ~0.5 GB with indexes |

From the Archidekt ranking (`commanders.json`, 3,269 commanders; listed counts include decks that merely contain the
card, so qualified decks will be fewer):

| | Value |
|---|---|
| Commanders with ≥ 50 listed decks | 2,810 |
| Listed decks, capped at 300 per commander | ~740k |
| Crawl time at 1 request per second | ~9 days continuous, resumable |
| `corpus.decks` at ~500k qualified decks, stored as `int[]` | ~200 MB |
| The same stored as one row per card | ~2.5 GB, which is why decks are arrays |

The lift floor and the partner cap live in `app_config` and start at **1.2 and 50**. The offline evaluation decides
whether the extra 6M rows over the 1.5 floor earn their place. The pair job's sanity gate refuses a run that would
double the table.

## Data model

```sql
-- Private: no grants to anon or authenticated. Third-party decklists never leave the database.
create schema corpus;

create table corpus.decks (
  id               bigint generated always as identity primary key,
  source           text not null,                 -- 'archidekt' | 'user'
  source_deck_id   text not null,                 -- Archidekt id, or public.decks.id for user decks
  commander_key_id integer references public.commander_keys (id),
  color_identity   smallint not null,
  updated_month    date not null,                 -- release-aware counting
  bracket          smallint,
  cards            integer[] not null,            -- sorted card ids, commanders and basics excluded
  content_hash     bytea not null,                -- skip unchanged decks
  included         boolean not null,              -- passed resolveDeck
  exclusion        text,                          -- why not
  fetched_at       timestamptz not null default now(),
  unique (source, source_deck_id)
);

create table corpus.dirty_keys (                  -- upsert-keyed; same shape as search_index_queue
  commander_key_id integer primary key,
  seq              bigint not null
);

create table corpus.crawl_queue (                 -- T010: one row per commander to crawl
  commander_card_id integer primary key references public.cards (id),
  target_decks      integer not null,
  cursor            jsonb,                        -- page, order, last updatedAt seen
  state             text not null,                -- queued | running | done | failed
  heartbeat_at      timestamptz,
  next_due_at       timestamptz                   -- recrawl schedule
);

-- Public read, service_role write.
create table public.commander_card_pairs (
  commander_key_id integer not null references public.commander_keys (id) on delete cascade,
  card_a_id        integer not null references public.cards (id) on delete cascade,
  card_b_id        integer not null references public.cards (id) on delete cascade,  -- a < b
  n_ab             integer not null,              -- evidence for the UI
  lift_ab          real not null,                 -- shrunk P(B|A,K) / p̂(B|K)
  lift_ba          real not null,
  primary key (commander_key_id, card_a_id, card_b_id)
);
create index commander_card_pairs_b on public.commander_card_pairs (commander_key_id, card_b_id, card_a_id);

create table public.card_pairs (                  -- global backoff, identity-aware denominators
  card_a_id integer not null, card_b_id integer not null, n_ab integer not null,
  lift_ab real not null, lift_ba real not null,
  primary key (card_a_id, card_b_id)
);
create index card_pairs_b on public.card_pairs (card_b_id, card_a_id);
```

- **Rows are slim on purpose.** The denominators (`n`, `n_a`, `n_b`) exist only in the worker's memory while a key is
  recomputed, and a new `α` means rerunning that key's job. At ~10M rows, every 4-byte column costs about 40 MB.
- **User decks.** `public.decks` and `deck_cards` stay the source of truth. Triggers on `save_deck`, `delete` and
  account deletion copy a deck into `corpus.decks` as `source = 'user'` or remove it, and mark its key dirty.
  `include_in_corpus` becomes `resolveDeck(...).ok`. That check moves out of SQL into the worker, which already owns
  it, so the trigger only enqueues and the worker decides. The column comment and the visibility copy in the deck
  editor change to say "complete decks only".
- **Account deletion.** A deleted account's decks leave `corpus.decks` through the cascade, and their keys go dirty,
  so the aggregates forget them on the next run. `/privacy` already says submitted decks improve recommendations.
- **Grants.** `select` on both pair tables for `anon`/`authenticated`, and `all` for `service_role`. The `corpus`
  schema is `service_role` only. Row-level security is enabled on the pair tables with a public read policy, like the
  other stats tables.

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

## Pipeline

```
Archidekt API ──► crawl worker ─┐                     (1 req/s, honest UA, crawl_queue, resumable)
                                ├─► corpus.decks  ── diff by content_hash ──► corpus.dirty_keys
public.decks ── trigger ────────┘
                                                       nightly: aggregate job
                                                        ├─ per dirty key: commander_stats,
                                                        │    commander_card_stats, commander_card_pairs
                                                        ├─ card_global_stats, corpus_identity_stats
                                                        └─ weekly: card_pairs (dense recount)
                                                       → drain search_index_queue → revalidate corpus, recs
```

- **Crawl** (replaces `spike:archidekt:*` for production):
  - The queue is seeded from `spike:archidekt:rank` plus a verification pass.
  - The worker claims a commander with `skip locked` and heartbeats `worker_status`. It pages `-updatedAt` so a
    recrawl stops at the first deck it already has unchanged, then writes qualified decks straight to
    `corpus.decks`.
  - `serve:commander-requests` becomes "bump this commander to the front of the queue".
- **Discovery and fetching are separate jobs.** Discovery reads list pages and upserts `(source, source_deck_id,
  listed_updated_at)`. Fetching pulls only decks that are new or whose `listed_updated_at` moved. A cache that
  never refetches would keep serving decks their owners have since edited.
- **Raw payloads** go to zstd files on the VPS (`raw/<source>/<id>.json.zst`), not Postgres, so a parser fix can
  reprocess without refetching. Measure one response before setting a retention period.
- **Cross-source dedupe.** A deck mirrored on two sites counts once. `corpus.decks.content_hash` covers commander
  key plus card set, and aggregation keeps one included deck per hash (the most recently updated).
- **Aggregate** runs per dirty key:
  - Load the key's included decks, count cards and pairs in memory with pure functions from
    `@mtg/core/scoring/pairs.ts`, and stage the rows.
  - Run a sanity gate against the previous run's `sync_runs.metrics`, then diff-merge in one transaction.
  - A key with 5,000 decks is about 18M pair increments, which takes seconds.
  - The global tables (`card_global_stats`, identity histograms) are sums over keys, so they are refreshed from
    per-key partials rather than rescanning every deck.
- **Global pairs** are recounted weekly with a dense upper-triangle counter over cards above `minDecks`. That is
  about 450 MB of memory at 15k eligible cards. Only changed rows are written.
- Every job keeps the existing failure model:
  - `startRun` / `finishRun`.
  - A stale `running` row is marked abandoned.
  - Nothing live changes until commit.
  - The index drain and cache revalidation run after success.

## Crawler guardrails (every source)

Consent covers the data. These rules cover how it is fetched, and they don't change with consent:

- **One limiter per host**, shared by every worker. The existing `RateLimiter` in `lib/http.ts` already does this
  within one process. Only one crawler process runs per source.
- **Jitter** on normal spacing, not only on backoff.
- **Exponential backoff honouring `Retry-After`.** This already exists in `politeFetch`.
- **A request timeout.** `politeFetch` has none today, so one hung request stalls a crawl.
- **Graceful shutdown.** On SIGINT or SIGTERM the crawler finishes its batch, commits, and exits.
- **robots.txt is obeyed.** It is read once per run per host, and disallowed paths are never requested. Today that
  rules out EDHREC's `/deckpreview/` (its individual decklists) and MTGGoldfish's `/deck/download*` and
  `/embed/decklist`.
- **An honest User-Agent**, with no fingerprint spoofing, UA rotation, proxies or challenge solvers.
- **A block stops the source.** A 403, a Cloudflare challenge or a bot wall switches that source off, the same way
  the share-import kill switch does, until someone re-enables it by hand. `json.edhrec.com` already returned 403 to
  an automated fetch on 2026-09-21, so the EDHREC adapter reads the public HTML commander pages instead.

## External statistics (EDHREC)

EDHREC publishes aggregates, not decklists, and its data comes from Moxfield and Archidekt decks. So it is a
**statistics source, never a deck source**. Adding it to deck counts would count Archidekt decks twice and still
yield no pairs.

```sql
create table public.external_commander_card_stats (
  source           text not null,                 -- 'edhrec'
  commander_key_id integer not null references public.commander_keys (id) on delete cascade,
  card_id          integer not null references public.cards (id) on delete cascade,
  inclusion        real not null,                 -- their published share
  synergy          real,
  deck_count       integer,                       -- their published sample size
  fetched_at       timestamptz not null,
  primary key (source, commander_key_id, card_id)
);
```

- **As a prior.** For a commander below `minDecks`, `p̂(B|K)` shrinks toward EDHREC's inclusion instead of the
  baseline p0: `(x + α·p_ext) / (n + α)`. As our own decks grow, our numbers take over, so a gap in EDHREC's
  coverage never decides a recommendation. The pair layers stay ours alone.
- **As a benchmark.** The offline evaluation reports agreement against EDHREC per commander, which automates T031.
- **Not shown in the UI.** Their numbers inform scoring and are never displayed. If that changes, credit and link
  EDHREC wherever they appear.
- Refreshed weekly per commander, diff-only, one request per commander page.

## Card value scoring

The recommendation request flow stays the same, with the two new steps marked *(new)*:

```
1. pool     = legal ∩ identity ∩ (owned, when owned-only) − deck
              ∩ ( top by corpus score  ∪  graph neighbours of the deck's cards )   ← neighbours (new)
2. fetch    = card rows, tags, play rates (existing)  ‖  pair rows deck × pool (new)   — one Promise.all
3. score    = weighted components, each 0–1, weights from app_config.scoring
4. explain  = component values + evidence, top 20 per category
```

| Component | Meaning | Source | State |
|---|---|---|---|
| `corpus` | How common in this commander's decks, blended with baseline popularity and synergy | `commander_card_stats`, `card_global_stats` | Exists |
| `deck` | How strongly it connects to cards already in **this** deck | pair tables | **New** |
| `role` | Does the deck need another card of this role | `deck_role_targets`, `role_profile` | Exists |
| `tag` | Does the same job (swaps) | `card_tags`, tag closure | Exists |
| `manaValue`, `staple`, `votes` | Swap fit, reprint breadth, rater votes (T006) | existing | Exist |
| Ownership | **A filter**, not a weight. A weight would be constant in owned-only mode, and outside it would rank weaker owned cards over better ones | `ownership` | Exists |
| Confidence | **A multiplier**, applied through shrinkage and backoff, not an added term | stats counts | Exists; extended to pairs |

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
- **Weights move to `app_config.scoring`** before anything is tuned. `rec_swap_candidates` reads the same row instead
  of mirroring constants, so "change both together" stops being a rule someone has to remember. That also closes the
  gap with the Hard constraint that scoring weights belong in the database.
- **Web read path**, following the React best-practices rules:
  - Pair rows come in the same `Promise.all` as the pool and `loadCardCorpus`, never after them.
  - Global pair rows per card are cached (`use cache`, `cacheLife("days")`, tag `corpus`).
  - `after()` handles timeout logging.
  - The client receives the component and its evidence, never pair maps.
  - Pair fetching stays out of `next/cache` imports in `recs.ts`, so `regress` and the evaluation run outside
    Next.js.

## Offline evaluation (gates every weight change)

- Split `corpus.decks` 90/10 **by deck**, and build the stats from the 90% only.
- For each held-out deck, hide 10 non-land cards. Ask for adds on the rest and report:
  - recall@20 of the hidden cards;
  - the same, bucketed by commander size (≥ 300 decks, 50–299, < 50);
  - a "Sol Ring rate": how many hits are generic staples, to catch a model that only learned popularity.
- Compare today's scoring, `corpus` plus `deck`, and the pruning settings (lift 1.2 against 1.5).
- `yarn workspace @mtg/worker cli eval:holdout`. The report goes to `X:\mtg_proj\reports`. The regression fixtures
  and the blind eval (T014) stay the human checks.

## Slices

Each slice is one PR into `develop`, in order.

| # | Slice | Main files | Done when |
|---|---|---|---|
| 1 | **Rules and weights.** Rewrite the CLAUDE.md data-source and storage rules to match the legal consent. Move `ADD_WEIGHTS`/`SWAP_WEIGHTS` into `app_config.scoring`, with the SQL reading the same row | `CLAUDE.md`, `scoring/add.ts`, `scoring/swap.ts`, a new migration, `rec_swap_candidates` | Regression fixtures unchanged |
| 2 | **Corpus in Postgres.** `corpus` schema, one-time JSONL import, and `aggregate:corpus` reads the database | new migration, `jobs/aggregate-corpus.ts`, `lib/corpus.ts`, `cli.ts` | Aggregates byte-identical to the JSONL run |
| 3 | **User decks as a source.** Triggers, `include_in_corpus` = complete-and-legal, and the editor copy | `save_deck` migration, deck editor visibility control, `supabase/tests/saved-decks.sql` | 70-card deck excluded; SQL tests pass |
| 4 | **Per-key incremental aggregation.** `dirty_keys`, partials for global stats | `aggregate-corpus.ts` | A one-deck change rewrites only that key's rows |
| 5 | **Pair layers.** Tables, `@mtg/core/scoring/pairs.ts` (tested), worker job, sanity gate | new migration, worker job, core | Row counts match this plan's estimates on the current corpus |
| 6 | **Offline evaluation** | `jobs/eval-holdout.ts` | Baseline recall@20 recorded |
| 7 | **Deck affinity in adds.** Neighbours in the pool and the `deck` component, weighted from the evaluation | `rec_add_candidates`, `lib/server/recs.ts`, `scoring/add.ts` | Recall@20 beats baseline; p95 add latency not worse on hosted |
| 8 | **Swaps and cuts** use affinity; `LOW_AFFINITY` | `rec_swap_candidates`, `scoring/swap.ts`, `scoring/cut.ts` | Evaluation and fixtures |
| 9 | **Contract v11.** `ScoreComponent` gains `deck`; evidence names the connected cards; UI explanation | `contract/recs.ts`, `version.ts`, mocks, deck UI | Frontend and backend approval |
| 10 | **Full-suite crawl.** Crawler guardrails in `politeFetch` (timeout, jitter, robots, shutdown, block kill switch), discovery/fetch split, raw payload files, `crawl_queue`, VPS worker (T010, T009) | `lib/http.ts`, `sources/archidekt/`, new jobs, `deploy/` | ~2,800 commanders crawled; nightly aggregate runs off the PC |
| 11 | **EDHREC statistics source.** Adapter over public commander pages, `external_commander_card_stats`, prior and benchmark | `sources/edhrec/`, new migration, `scoring/corpus.ts`, evaluation | Evaluation shows the prior helps commanders below `minDecks`, or it is switched off |

Slices 10 and 11 can start in parallel after slice 2, since they only write their own tables. The plan sizes the
tables for them from the start.

## Out of scope

- **MTGGoldfish.** It is allowed now, but its decks lean toward constructed formats and its deck downloads are
  disallowed by robots.txt. It is low value for Commander, so it waits until the other sources are running.
- **Moxfield** until its API access or User-Agent whitelist is confirmed. Its whitelisting wants a production
  domain (T033). A colly scrape built for it (`feature/moxfield-scrape`, T036) is shelved: a 2026-09-22 probe from
  the VPS answered Cloudflare's hard WAF block, so the source stays off until access is granted.
- Negative associations, win-condition analysis, multiple collections, and embeddings.
