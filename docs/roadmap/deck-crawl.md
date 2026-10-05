# Deck crawls

A daily crawl that collects public Commander decklists into a private `corpus` schema, so the recommendations have
play-rate evidence that does not depend on someone asking for a commander by hand.

Two sources share one engine. **Archidekt is active**; **Moxfield is built and switched off** — it answers
Cloudflare's hard WAF block to the app's honest User-Agent on a path its own robots.txt allows (probed 2026-09-22),
and the guardrails say a wall is obeyed, not worked around.

Built under T036 (closed 2026-09-28); rebuilt per commander on 2026-10-01. Open: the daily cron trigger (T042), a crawl database role (T043) and Moxfield access (T044). The aggregation that turns these decks into `commander_card_stats` is the follow-up milestone, and
the wider design they feed is [`card-graph-plan.md`](card-graph-plan.md).

## Why it exists

Play rates are the strongest signal the recommender has, and until now the corpus grew only when a visitor asked for
a commander nobody had looked up yet (`serve:commander-requests`, T009). That is demand-driven: the commanders
nobody browses stay empty, and the ones that are popular today stay frozen at whatever week they were collected.

A daily crawl that works through every commander fixes both. It takes commanders from a queue seeded from EDHREC's
commander list, most played first, and lists each one's decks on Archidekt most viewed first:

- **A first visit reads one list page** (up to 60 decks). Every commander gets a small base before any gets more
  (owner decision 2026-10-01).
- **A revisit re-reads `revisitPages` (1) pages** and fetches only the decks whose listed update time has moved, which
  is the whole of the "skip what has not changed" optimisation. It replaced a target of 350 new decks per revisit: that
  made a visit walk up to 40 pages — 2,400 deck fetches, hours at the polite pace — hunting decks that, for a commander
  leading few of the decks its card merely appears in, were never there to find. `maxFetchesPerCommander` (120) now
  bounds one visit's work directly, which a page cap never did.
- **Revisits begin only once every commander has had its first visit**: the queue hands out never-visited commanders
  before any second look.

It replaced a walk of Archidekt's site-wide feed, newest update first, that stopped at the first stretch of
unchanged decks. Hosted runs 1–5 (2026-09-24 to 2026-10-01) showed that never worked: Archidekt bumps `updatedAt`
faster than a polite crawl can page, so the feed slid away under every walk, and each run collected only decks edited
while it ran (the oldest any run reached was edited under a minute before it started). View order holds still
between visits, so a commander's page 1 is the same decks tomorrow.

## The shape of it

```
VPS worker, `cli serve` (daily at app_config.worker.crawlHourUtc, and for a deck lookup)   apps/worker, T066
Vercel cron (daily, the backup until the worker has proved itself)
  └─ GET  /api/cron/{archidekt,moxfield}-scrape        apps/web — CRON_SECRET bearer
      └─ POST /cron/:source/scrape                     services/search-api — cron token, answers 202
          └─ crawl.Runner.Run (background goroutine)
              ├─ GET  archidekt.com/api/decks/v3/…     one commander's decks, most viewed first
              ├─ GET  archidekt.com/api/decks/<id>/    one deck
              └─ POST /rest/v1/rpc/crawl_*             the private corpus, through functions
```

The web route does nothing but authorize and forward. The crawl is asynchronous because a backfill runs for hours
and a serverless function must not: the search API answers `202 {"started": true}` and keeps going.

The 202 means *a crawl began*, not *a request arrived*. Before it answers, the scrape makes the same database read the
run makes first, and a failure is a **502** the web route passes straight through to Vercel's cron log. That read is
the difference between a crawl that stopped and a crawl nobody noticed had stopped: the background half reports itself
only to the container log, so anything knowable at trigger time has to be said while the caller is still listening.

### The pieces

| Path | What it is |
|---|---|
| `services/search-api/internal/crawl/` | the engine: policy, fetcher, run loop, store. Knows nothing about any site |
| `services/search-api/internal/archidekt/` | URLs and parsers for Archidekt — the active source |
| `services/search-api/internal/moxfield/` | the same for Moxfield — built, blocked, seeded off |
| `services/search-api/internal/supabase/` | a thin PostgREST client: `RPC` and `SelectAll`, nothing general |
| `supabase/migrations/20260922000300_deck_crawl_corpus.sql` | the `corpus` schema and the `public.crawl_*` functions |
| `apps/web/src/lib/server/crawl-cron.ts` | the shared cron route body |

A source supplies four things — `ListURL`, `DeckURL`, `ParseList`, `ParseDeck` — and nothing downstream knows which
site a deck came from. Adding a third source is those four methods, a `Defaults()` policy, a `crawl.state` row, and a schema of its own with a `decks` table shaped like `archidekt.decks` (plus its branch in the `crawl.decks` view).

## What one run does

1. **Read the policy** from `app_config.<source>` and hand it to the fetcher.
2. **Read the state.** A disabled source stops here, having made no request.
3. **Open a run row**, then **claim the source**. The claim is the only thing that decides whether this run crawls;
   losing it means another crawl is live, which is a normal outcome, not a failure.
4. **Seed the queue** (`crawl_seed_commanders`): add the commanders `corpus.edhrec_commanders` (EDHREC) knows and
   refresh their deck counts, writing only what changed. A later EDHREC import reaches the queue on its own.
5. **Visit commanders in queue order** until `runMinutes` is up or the queue is empty: never visited first, most
   played (EDHREC deck count) first, then the least recently visited. Per commander:
   1. List `?commanderName=<name>&deckFormat=3&size=100&orderBy=-viewCount&page=N` (`size` is the deck size, so
      only complete 100-card decks; Archidekt pages by 60). A two-faced card that finds nothing is tried again under
      its front face, and the name that worked is kept.
   2. Per page, **look up what we hold** for exactly the ids it listed (`crawl_deck_versions`). A held deck whose
      listed update time has not moved is stepped over without a request.
   3. Fetch the rest and write them. A deck whose cards are unchanged has only its new listed time recorded, and
      does not count. A deck led by another commander (the search also finds decks that merely run the card) is
      kept, since it is a real deck already paid for, but does not count either.
   4. Stop after `firstVisitPages` (1) on a first visit and `revisitPages` (1) on a revisit, or sooner at
      `maxFetchesPerCommander`, the end of the list, or `maxPagesPerCommander`. Record the visit
      (`crawl_finish_commander`).
6. **Close the run** and release the claim.

### Outcomes and the verification log

Each commander's last visit is a row in `crawl.queue`:

| Outcome | |
|---|---|
| `done` | the visit read the pages it was asked for |
| `exhausted` | the commander's list ran out: the source has fewer decks for it than the visit was allowed to read |
| `page_cap` | the **ceiling** cut the visit short — it asked for more pages than `maxPagesPerCommander` allows. A visit that read exactly the pages it wanted is `done`, because with `revisitPages` at 1 that is what every healthy revisit does |
| `fetch_cap` | a visit stopped at `maxFetchesPerCommander` (120): one commander must not be able to take a whole run |
| `partial` | the run's time ran out mid-visit; not stamped as visited, so it comes back first |
| `not_found` | **no decks under its name or front face.** Left out of the queue until someone clears it |
| `no_led_decks` | **a first visit listed decks, but none were led by this commander** (likely a name mismatch) |
| `failed` | the visit hit an error that ended the run; not stamped, so it comes back first |

The last two above `failed` are the verification log the owner asked for: commanders EDHREC knows that Archidekt
does not, under that name. They are also logged at Warn in the container log.

### Budget

A run is bounded by time, `runMinutes` (360: the owner's six hours a day, 2026-10-01), and each visit by its
commander's target. At about 2.75 s a request a first visit is one list page and up to 60 deck fetches, under
three minutes, so a day covers about 130 commanders and the first pass over the ~3,600 EDHREC commanders takes
about four weeks.

### What counts as a deck

The feed URL filters on Commander format and 100 cards, but **a filter is not a guarantee** — Archidekt's own browse
endpoint returns decks that are neither. So the adapter re-checks the deck itself, the same four rules as the
worker's `qualifyDeck`:

- Commander format (`deckFormat == 3`)
- public — not `private`, not `unlisted`
- at least one card in the `Commander` category
- exactly 100 cards, commander(s) included

A deck failing any of them is a `NotQualified`: counted in `crawl.runs.skipped_unqualified` and stepped over. Only a
page that stopped looking like itself is a `ShapeError`, which quarantines the whole run rather than guessing.

**An empty deck is unqualified, not a changed shape.** A deck someone just created, or emptied, answers with an empty
(or null) `cards` list; it is skipped as `empty deck`. Only a body with no `cards` field at all quarantines. Until
2026-10-03 an empty list read as a changed shape, and hosted run 7 stopped on one after 57 decks.

A deck that answers **404 or 410** is stepped over too, counted in `crawl.runs.skipped_missing`. The loop runs at
one request every few seconds, so minutes pass between a deck being listed and being fetched; in that window it can be deleted, made private or have its id retired. That is ordinary at this rate. It used
to fail the whole run — observed 2026-09-24, a crawl died on deck 26724957 after about a hundred decks, and because
the next run walked the same feed it would have died on the same id every night.

A deck naming a card **our catalog does not have yet** is stored all the same: the raw table keeps what the source
published, and the collator (T054) lets the deck into `corpus.decks` only once every card resolves, so no 99-card deck
reaches the corpus (owner decision 2026-10-03) and the deck is not fetched again. Only an id that is **not an oracle id
at all** is refused: counted in `crawl.runs.skipped_unresolved`, logged at Warn with the ids, and fetched again on the
commander's next visit.

The counters are separate on purpose: a rising `skipped_unqualified` says the browse filters admit decks the
corpus does not want, a rising `skipped_missing` says the feed is stale or the crawl is falling behind
deletions, and a rising `skipped_unresolved` says our catalog sync is behind.

Skipping has a ceiling. Once a run has seen at least `missingDeckFloor` (20) missing decks **and** they are more than
`missingDeckShare` (half) of what it attempted, it fails with `N of M listed decks were missing`. Without it, a deck
endpoint that moved would make every deck "gone" and the run would report a cheerful success over an empty corpus —
the same silent-failure shape the cron's preflight exists to prevent. Both conditions are required: the share alone
would fail a five-deck run that met three deletions, the floor alone a healthy thousand-deck backfill that met twenty.

Two details that are easy to get backwards:

- **A card with no category is in the deck.** Uncategorised is the default state of a card someone just added.
  Only a card whose *first* category is an excluded board (`Sideboard`, `Maybeboard`, `Considering`, or one the deck
  marked `includedInDeck: false`) is dropped, because the first category is what Archidekt counts its quantity
  against.
- **Quantities are kept.** Thirty Forests are not one Forest, and the 100-card rule cannot be checked from a set of
  distinct cards.

## Politeness

Every outbound request goes through `crawl.Fetcher`:

- the honest User-Agent, `MTGDeckRec/0.1 (+https://github.com/Planeswalker-Industries/mtg-deck-rec)`, matching the
  worker's. Never rotated, never spoofed.
- **robots.txt obeyed** — colly's default, and the `IgnoreRobotsTxt` option is absent on purpose.
- one request in flight at a time, spaced `requestIntervalMs` apart plus a random extra of up to `requestJitterMs`,
  so requests do not land on a fixed beat. **Archidekt is 1 s + up to 0.2 s** (owner decision 2026-10-03: it has been
  taking that rate).
- **The pace adapts rather than being a fixed guess.** A `429` doubles the interval, up to `requestIntervalMaxMs`
  (8 s), and `paceRecoverRequests` (60) responses with no 429 in them return it to the base. The reason it is not just
  a flat safe number is on the record: one request a second drew 429s on 2026-09-14, so a fixed pace would have to be
  slow enough for the worst day and needlessly slow on every other one. A run that was slowed down says so in its own
  row — `crawl.runs.throttles` counts it and `throttled_position` names the commander and page it happened at,
  because a count says there was resistance and only a position says where to look.
- 429 and 5xx retry up to three times with exponential backoff, widened to `Retry-After` when the server sets one.
- **403 or a challenge is never retried.** It is a decision by the source, and the crawl honours it.

### The kill switch

One blocked response disables that source (`crawl.state.disabled`) and writes an `audit_log` row. There is
deliberately no "how many blocks" threshold: a wall is a wall.

```sql
select * from public.audit_log where action = 'crawl.disabled' order by created_at desc;
```

Re-enabling is a manual `update` — a human decides the source is reachable again, never the crawler.

A challenge is recognised by a `cf-mitigated: challenge` header, or by markers in a body the response *says* is
HTML. It is deliberately not a substring search of any body: the active source answers JSON, deck and card names are
user-written, and one false positive switches off the pipeline until someone notices.

## Single flight

`crawl_claim` takes the source's `crawl.state` row `for update`, so two triggers cannot both crawl — the loser closes
its own run row as failed and reports busy. There is no read-then-write fast path, because that is a check with a gap
in front of it.

**A claim untouched for `staleClaimSeconds` (8 h, longer than a six-hour run) can be taken over.** A container killed mid-crawl — a deploy, an
OOM — can never release its own claim, and without a takeover the source would be wedged until someone ran SQL. The
superseded run is closed as failed so the log says what became of it.

Shutdown tries not to need that. Background crawls share one cancellable context, the app's post-shutdown hook
cancels it and waits (20 s) for the run to record itself, and the run's closing writes are detached from that
context (`context.WithoutCancel`) so a cancelled crawl still finishes its bookkeeping. Fiber's own shutdown only
waits for in-flight *requests*, and the scrape's request ended at its 202 — hence the hook. The compose files set
`stop_grace_period: 60s`, because Docker's ten-second default would SIGKILL the drain.

## The data

The decks live in each source's own raw schema, and the crawl's machinery in `crawl` (since 2026-10-05, T053; the
layers are in [`card-graph-plan.md`](card-graph-plan.md), "Data layers"). Nothing in the app reads them.

| Table | |
|---|---|
| `archidekt.decks` (`moxfield.decks` alike, empty) | one row per scraped deck, as the source sent it: `commanders uuid[]` and `card_oracle_ids uuid[]` (oracle ids, sorted), `quantities smallint[]` (aligned), `deck_size`, `declared_bracket`, `content_hash`, the update times. Ids come from one sequence across sources |
| `crawl.decks` (view) | every deck source's raw decks with `source` as a column: what the `crawl_*` and admin functions read |
| `crawl.runs` | one row per run, shaped like `sync_runs`: pages, decks listed/fetched/written, skipped unchanged, skipped unqualified, skipped missing, skipped unresolved, commanders visited, blocks, error |
| `crawl.state` | one row per source: cursor, claim, kill switch, probe |
| `crawl.queue` | one row per source and commander: EDHREC deck count (queue order), the name that worked, last visit, outcome, counts |

**Decks are stored raw, in the source's oracle ids.** `crawl_upsert_decks` resolves nothing against the catalog;
the collator does that once, into `corpus.decks`. The ids are `uuid`, so every join to `cards.oracle_id` is uuid to
uuid and uses its unique index. Before 2026-10-03 the table held oracle ids as text, and joining text to the uuid
column cast the indexed side: `crawl_seed_commanders` read the whole `cards` heap on every run, ran past PostgREST's
8 s `statement_timeout` cold, and hosted run 8 failed before its first request. From 2026-10-03 to 2026-10-05 the
decks were stored by card id instead; T053 moved them back to oracle ids, now typed.

`content_hash` is sha256 over **sorted** commanders and **sorted** card/quantity pairs. Sorted because the hash has
to describe the deck and not the order a site happened to list it in — an order-sensitive hash would rewrite every
row the first time a source reshuffled its output.

`crawl_upsert_decks` writes only rows whose hash or listed update time differs, so the project's diff-only rule is
enforced by the database rather than trusted to the caller. The listed time is written on an unchanged deck so the
next visit can step over it without a request.

### Why functions, not tables

**The Go service never addresses a table.** It calls security-definer functions in `public`, with
execute revoked from `public`, `anon` and `authenticated` and granted to `service_role` alone.

PostgREST can only address a table in a schema on its exposed list, so `/rest/v1/archidekt.decks` is read as a table
*named* `archidekt.decks` in `public` — `PGRST205`. Putting the raw schemas on that list is exactly what schemas holding
third-party decklists must not do. The functions give the crawl the handful of operations it needs and leave the
tables unreachable by the API roles.

The same reasoning covers the claim. PostgREST has no `a=eq.x and b=is.null` query form; an operation needing two
conditions at once belongs in a function, not in a filter string.

| Function | |
|---|---|
| `crawl_state(source)` | state plus `deckCount`, upserting the row if the source is new |
| `crawl_create_run(source)` | opens a run row |
| `crawl_claim(source, run, client, stale_seconds)` | the mutex, with stale takeover |
| `crawl_release(source, run)` | releases only a claim that run still holds |
| `crawl_finish_run(run, summary)` | closes it; the only place `finished_at` is set |
| `crawl_seed_commanders(source)` | adds EDHREC's commanders to the queue, refreshes their counts, diff-only |
| `crawl_next_commanders(source, run, limit)` | the next commanders in queue order, leaving out those this run finished and `not_found` |
| `crawl_finish_commander(source, card, run, result)` | records a visit; stamps it visited unless partial or failed |
| `crawl_deck_versions(source, ids)` | hash and listed update time for one list page's ids |
| `crawl_deck_hashes(source, ids)` | hashes only; no longer called, kept until a cleanup |
| `crawl_upsert_decks(source, rows)` | diff-only write, returns rows changed |
| `crawl_set_cursor(source, id)` | the first deck a run listed |
| `crawl_probe_ok(source)` | an honest fetch of an allowed path worked |
| `crawl_disable(source, reason)` | the kill switch, audited |

Held decks are read **per list page**, not per run or per commander. The corpus is the one thing that grows without
bound, and a visit only needs to know about the decks in front of it.

## Configuration

Pace and budget live in `app_config.<source>` — the repo is public, so anti-abuse thresholds belong in the database:

```json
{ "requestIntervalMs": 1000, "requestJitterMs": 200, "requestIntervalMaxMs": 8000, "paceRecoverRequests": 60,
  "backoffStartMs": 5000, "backoffMaxMs": 300000, "staleClaimSeconds": 28800, "runMinutes": 360,
  "firstVisitPages": 1, "revisitPages": 1, "maxPagesPerCommander": 40, "maxFetchesPerCommander": 120,
  "targetDecks": 60 }
```

Each source's Go `Defaults()` is the baseline under that row, so a crawl has a sane pace before the database is
read at all.

Secrets are environment, in two places:

| Where | Variable | |
|---|---|---|
| VPS (search API) | `SUPABASE_URL` | `https://<ref>.supabase.co` |
| VPS | `SUPABASE_SERVICE_ROLE_KEY` | the service-role key. The web app calls the same value `SUPABASE_SECRET_KEY` |
| VPS | `SEARCH_API_CRON_TOKEN` | the token the cron route sends |
| Vercel | `CRON_SECRET` | what the cron route checks on the way in |
| Vercel | `SEARCH_API_URL`, `SEARCH_API_CRON_TOKEN` | where to forward, and the same token as the VPS |

All three VPS values or none: with any missing, `/cron/:source/*` answers 503 and search serves unchanged.

**`CRON_SECRET` is the authorization, not a header Vercel happens to set.** Vercel sends
`Authorization: Bearer $CRON_SECRET` on every cron invocation. `x-vercel-cron-schedule` and the `vercel-cron` user
agent are ordinary inbound headers any caller can type; trusting them leaves an open endpoint that drives outbound
crawling of someone else's site.

## Operating it

Check a source without triggering anything:

```sh
curl -H "Authorization: Bearer $SEARCH_API_CRON_TOKEN" https://<host>/cron/archidekt/status
# {"disabled":false,"running":false,"lastDeckId":"26657848","deckCount":9134,
#  "commandersQueued":3412,"commandersVisited":170,"commandersNotFound":12}
```

That answer is a real round trip to the database, so it also proves the credentials work. `503` means one of the
three VPS variables is missing; `502` means they are set and wrong.

Trigger a run by hand:

```sh
curl -i -X POST -H "Authorization: Bearer $SEARCH_API_CRON_TOKEN" https://<host>/cron/archidekt/scrape
```

| Answer | What it means |
|---|---|
| `202 {"started": true}` | the database answered and a crawl is running; everything after this is in the log |
| `202 {"started": false, "reason": "already running"}` | this host already has a goroutine for the source; no database call was made |
| `502` | the crawl's database did not answer, and **nothing was started** — the container log has the status and body |
| `503` | one of `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEARCH_API_CRON_TOKEN` is unset on this host |

On a 502, the log line names the cause:

```sh
docker logs --since 10m <search-api> 2>&1 | grep "crawl preflight failed"
```

`supabase: HTTP 401` is the key; `HTTP 404` or an HTML body is `SUPABASE_URL` (note the client appends `/rest/v1`
itself, so a URL that already ends in it produces `/rest/v1/rest/v1` and 404s); a `dial tcp` or
`context deadline exceeded` with no `supabase:` prefix is egress or DNS. `PGRST301: Expected 3 parts in JWT` means a
non-JWT key reached PostgREST — a new-style `sb_secret_…` key where a legacy `service_role` JWT was expected.

Read what runs have done:

```sql
select id, state, started_at, finished_at, decks_listed, decks_written,
       skipped_unchanged, skipped_unqualified, skipped_missing, skipped_unresolved, blocks, error
  from crawl.runs where source = 'archidekt' order by id desc limit 20;
```

Read the verification log (commanders Archidekt has no decks for under that name):

```sql
select k.name, c.outcome, c.query_name, c.listed, c.fetched, c.wrong_commander, c.updated_at
  from crawl.queue c join public.cards k on k.id = c.commander_card_id
 where c.source = 'archidekt' and c.outcome in ('not_found', 'no_led_decks')
 order by c.edhrec_deck_count desc;
```

Put a commander back in the queue after fixing its name (it is tried with `query_name` first):

```sql
update crawl.queue set outcome = null, query_name = '<name Archidekt uses>'
 where source = 'archidekt' and commander_card_id = <card id>;
```

Re-enable a source after a block, once you believe it is reachable:

```sql
update crawl.state
   set disabled = false, disabled_reason = null, disabled_at = null
 where source = 'archidekt';
```

Free a claim by hand (rarely needed — the stale window does this after eight hours):

```sql
update crawl.state set running_run_id = null, client_id = null, claimed_at = null
 where source = 'archidekt';
```

## Testing

`go test ./...` runs everything below except the live check.

- Parsers are pinned against live fixtures in `internal/archidekt/testdata/`. Those fixtures are **trimmed** to a few
  card entries, so they pin the wire shape and cannot satisfy the 100-card rule — which is why the parse and the
  qualification are separate functions, each tested on its own.
- The run loop is tested against a fake store and a scripted fetcher: stale takeover, unqualified skips, per-page
  lookups, the first visit reading page 1 only, the revisit target, the page cap, an exhausted list, not found and
  the front-face retry, decks led by another commander kept but not counted, held decks stepped over and a moved
  listed time recorded, running out of time, a block, and that a cancelled run still finishes and releases.
- `supabase/tests/crawl-commanders.sql` checks the queue functions in the database: diff-only seeding, queue order,
  what a finish stamps, listed times on unchanged decks, and that no API role but `service_role` reaches them.
- **`TestLiveStoreRoundTrip` runs the real store against a real PostgREST.** A fake HTTP server answers any path
  with anything, so it cannot tell a working call from one PostgREST would reject — function names, argument names,
  grants and JSON shapes are only checked here. Local only:

  ```sh
  SUPABASE_TEST_URL=http://127.0.0.1:56321 SUPABASE_TEST_SERVICE_KEY=<local service key> \
    go test ./internal/crawl/ -run Live -v
  ```

- The web side: `yarn workspace @mtg/web tsx scripts/{archidekt,moxfield}-cron-check.ts`, which fake both the
  scheduler and the search API, and assert that a spoofed `vercel-cron` user agent and a spoofed schedule header are
  both refused.

## Not done yet

- **The daily trigger (T042).** The Vercel cron has started runs only sometimes. The VPS worker (T066) starts each
  source's run at `crawlHourUtc` unless one already started that day (UTC); the claim makes a second trigger harmless,
  so the cron stays as a backup until two days of worker-started runs, then goes.
- **Collation on hosted (T054).** `cli collate` resolves the raw decks into `corpus.decks` (the corpus rule:
  commander legality, colour identity, 100 cards, every card known) and `aggregate:corpus` reads that; built, and run
  by hand on hosted after release until the VPS worker (T066) schedules it. This stage stays the raw scrape.
- **A database role that is not `service_role` (T043).** The VPS holds a key that bypasses RLS across the whole database,
  `auth` included, in the same process that serves public read endpoints. The `crawl_*` functions narrow what the
  crawl *does*, not what the key *could* do. A proper fix is a Postgres role granted execute on those functions and
  nothing else, plus a JWT minted for it — Supabase's secret keys map to `service_role`.
- **Commander requests go through the crawl (T066, built; live once the worker is deployed).** The PC worker that
  served them was retired on 2026-10-05. Now `crawl_next_commanders` hands out a commander with an active lookup
  first (adding it to the queue if the seed list doesn't know it), the worker starts a run when none is going, and once
  the queue row says the commander was visited it collates, rebuilds the stats and closes the request. Lookups so obey
  the crawl's pace, claim and kill switch: a switched-off source fails them with its reason.
- **Moxfield (T044).** Blocked. Its list is still the site-wide update-ordered feed, so it needs a per-commander
  search before it is re-enabled. Its deck parser reads an embed whose shape is still unpinned, which is why it refuses
  anything that is not exactly 100 cards: a heuristic that reads half a deck produces a plausible, wrong list. If
  Moxfield ever grants an accessible path, pin the parsers against live fixtures before clearing `disabled`.
