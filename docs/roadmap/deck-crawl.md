# Deck crawls

A daily crawl that collects public Commander decklists into a private `corpus` schema, so the recommendations have
play-rate evidence that does not depend on someone asking for a commander by hand.

Two sources share one engine. **Archidekt is active**; **Moxfield is built and switched off** — it answers
Cloudflare's hard WAF block to the app's honest User-Agent on a path its own robots.txt allows (probed 2026-09-22),
and the guardrails say a wall is obeyed, not worked around.

Tracked as T036. The aggregation that turns these decks into `commander_card_stats` is the follow-up milestone, and
the wider design they feed is [`card-graph-plan.md`](card-graph-plan.md).

## Why it exists

Play rates are the strongest signal the recommender has, and until now the corpus grew only when a visitor asked for
a commander nobody had looked up yet (`serve:commander-requests`, T009). That is demand-driven: the commanders
nobody browses stay empty, and the ones that are popular today stay frozen at whatever week they were collected.

A daily crawl of the update-ordered feed fixes both. It sees decks in the order they changed, so a run costs roughly
what changed since the last one rather than what exists, and the corpus tracks the format instead of a snapshot.

## The shape of it

```
Vercel cron (daily)
  └─ GET  /api/cron/{archidekt,moxfield}-scrape        apps/web — CRON_SECRET bearer
      └─ POST /cron/:source/scrape                     services/search-api — cron token, answers 202
          └─ crawl.Runner.Run (background goroutine)
              ├─ GET  archidekt.com/api/decks/v3/…     the feed, newest update first
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
site a deck came from. Adding a third source is those four methods, a `Defaults()` policy and a `crawl_state` row.

## What one run does

1. **Read the policy** from `app_config.<source>` and hand it to the fetcher.
2. **Read the state.** A disabled source stops here, having made no request.
3. **Open a run row**, then **claim the source**. The claim is the only thing that decides whether this run crawls;
   losing it means another crawl is live, which is a normal outcome, not a failure.
4. **Walk the feed**, page by page, newest update first.
5. For each page: **look up the content hashes** we already hold for exactly the ids that page listed, then fetch
   each deck and compare.
6. **Write only what changed.** Ten unchanged decks in a row ends the walk — the feed is update-ordered, so past
   that frontier everything is old.
7. **Close the run** and release the claim.

### Budget

`Budget(deckCount)` is `backfillDecks` (10,000) on an empty corpus and `maxDecksPerRun` (1,000 for Archidekt) after
that. It bounds decks *and* pages: a page costs one request, and the loop cannot run past the budget.

### What counts as a deck

The feed URL filters on Commander format and 100 cards, but **a filter is not a guarantee** — Archidekt's own browse
endpoint returns decks that are neither. So the adapter re-checks the deck itself, the same four rules as the
worker's `qualifyDeck`:

- Commander format (`deckFormat == 3`)
- public — not `private`, not `unlisted`
- at least one card in the `Commander` category
- exactly 100 cards, commander(s) included

A deck failing any of them is a `NotQualified`: counted in `crawl_runs.skipped_unqualified` and stepped over. Only a
page that stopped looking like itself is a `ShapeError`, which quarantines the whole run rather than guessing.

A deck that answers **404 or 410** is stepped over too, counted in `crawl_runs.skipped_missing`. The feed is
update-ordered and the loop runs at one request a second, so minutes pass between a deck being listed and being
fetched; in that window it can be deleted, made private or have its id retired. That is ordinary at this rate. It used
to fail the whole run — observed 2026-09-24, a crawl died on deck 26724957 after about a hundred decks, and because
the next run walks the same feed it would have died on the same id every night.

The two counters are separate on purpose: a rising `skipped_unqualified` says the browse filters admit decks the
corpus does not want, while a rising `skipped_missing` says the feed is stale or the crawl is falling behind
deletions.

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
- one request in flight at a time, spaced `requestIntervalMs` apart. Archidekt is 3 s: one a second drew 429s on
  2026-09-14.
- 429 and 5xx retry up to three times with exponential backoff, widened to `Retry-After` when the server sets one.
- **403 or a challenge is never retried.** It is a decision by the source, and the crawl honours it.

### The kill switch

One blocked response disables that source (`crawl_state.disabled`) and writes an `audit_log` row. There is
deliberately no "how many blocks" threshold: a wall is a wall.

```sql
select * from public.audit_log where action = 'crawl.disabled' order by created_at desc;
```

Re-enabling is a manual `update` — a human decides the source is reachable again, never the crawler.

A challenge is recognised by a `cf-mitigated: challenge` header, or by markers in a body the response *says* is
HTML. It is deliberately not a substring search of any body: the active source answers JSON, deck and card names are
user-written, and one false positive switches off the pipeline until someone notices.

## Single flight

`crawl_claim` takes the source's `crawl_state` row `for update`, so two triggers cannot both crawl — the loser closes
its own run row as failed and reports busy. There is no read-then-write fast path, because that is a check with a gap
in front of it.

**A claim untouched for `staleClaimSeconds` (6 h) can be taken over.** A container killed mid-crawl — a deploy, an
OOM — can never release its own claim, and without a takeover the source would be wedged until someone ran SQL. The
superseded run is closed as failed so the log says what became of it.

Shutdown tries not to need that. Background crawls share one cancellable context, the app's post-shutdown hook
cancels it and waits (20 s) for the run to record itself, and the run's closing writes are detached from that
context (`context.WithoutCancel`) so a cancelled crawl still finishes its bookkeeping. Fiber's own shutdown only
waits for in-flight *requests*, and the scrape's request ended at its 202 — hence the hook. The compose files set
`stop_grace_period: 60s`, because Docker's ten-second default would SIGKILL the drain.

## The data

Three tables in `corpus`, and nothing in the app reads them yet.

| Table | |
|---|---|
| `corpus.decks` | one row per scraped deck: `commanders text[]`, `cards jsonb` (`{oracle id: quantity}`), `deck_size`, `content_hash`, the update times |
| `corpus.crawl_runs` | one row per run, shaped like `sync_runs`: pages, decks listed/fetched/written, skipped unchanged, skipped unqualified, skipped missing, blocks, error |
| `corpus.crawl_state` | one row per source: cursor, claim, kill switch, probe |

`content_hash` is sha256 over **sorted** commanders and **sorted** card/quantity pairs. Sorted because the hash has
to describe the deck and not the order a site happened to list it in — an order-sensitive hash would rewrite every
row the first time a source reshuffled its output.

`crawl_upsert_decks` writes only rows whose hash differs (`where d.content_hash is distinct from excluded.…`), so
the project's diff-only rule is enforced by the database rather than trusted to the caller.

### Why functions, not tables

**The Go service never addresses a `corpus` table.** It calls ten security-definer functions in `public`, with
execute revoked from `public`, `anon` and `authenticated` and granted to `service_role` alone.

PostgREST can only address a table in a schema on its exposed list, so `/rest/v1/corpus.decks` is read as a table
*named* `corpus.decks` in `public` — `PGRST205`. Putting `corpus` on that list is exactly what a schema holding
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
| `crawl_deck_hashes(source, ids)` | hashes for one feed page's ids |
| `crawl_upsert_decks(source, rows)` | diff-only write, returns rows changed |
| `crawl_set_cursor(source, id)` | how far the feed got |
| `crawl_probe_ok(source)` | an honest fetch of an allowed path worked |
| `crawl_disable(source, reason)` | the kill switch, audited |

Hashes are read **per feed page**, not per run. The corpus is the one thing that grows without bound, and a daily
run only needs to know about the few hundred decks in front of it.

## Configuration

Pace and budget live in `app_config.<source>` — the repo is public, so anti-abuse thresholds belong in the database:

```json
{ "requestIntervalMs": 3000, "maxDecksPerRun": 1000, "backfillDecks": 10000,
  "backoffStartMs": 5000, "backoffMaxMs": 300000, "staleClaimSeconds": 21600 }
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
# {"disabled":false,"running":false,"lastDeckId":"26657848","deckCount":9134}
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
       skipped_unchanged, skipped_unqualified, skipped_missing, blocks, error
  from corpus.crawl_runs where source = 'archidekt' order by id desc limit 20;
```

Re-enable a source after a block, once you believe it is reachable:

```sql
update corpus.crawl_state
   set disabled = false, disabled_reason = null, disabled_at = null
 where source = 'archidekt';
```

Free a claim by hand (rarely needed — the stale window does this after six hours):

```sql
update corpus.crawl_state set running_run_id = null, client_id = null, claimed_at = null
 where source = 'archidekt';
```

## Testing

`go test ./...` runs everything below except the live check.

- Parsers are pinned against live fixtures in `internal/archidekt/testdata/`. Those fixtures are **trimmed** to a few
  card entries, so they pin the wire shape and cannot satisfy the 100-card rule — which is why the parse and the
  qualification are separate functions, each tested on its own.
- The run loop is tested against a fake store and a scripted fetcher: stale takeover, unqualified skips, per-page
  hash lookups, the caught-up rule, an exhausted feed, a block, and that a cancelled run still finishes and releases.
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

- **Aggregation.** Nothing reads `corpus.decks`. Turning it into `commander_card_stats` / `card_global_stats` is the
  next milestone, and is where legality, colour identity and `resolveDeck`'s filters apply — this stage is the raw
  scrape.
- **A database role that is not `service_role`.** The VPS holds a key that bypasses RLS across the whole database,
  `auth` included, in the same process that serves public read endpoints. The `crawl_*` functions narrow what the
  crawl *does*, not what the key *could* do. A proper fix is a Postgres role granted execute on those functions and
  nothing else, plus a JWT minted for it — Supabase's secret keys map to `service_role`.
- **Moxfield.** Blocked. Its deck parser reads an embed whose shape is still unpinned, which is why it refuses
  anything that is not exactly 100 cards: a heuristic that reads half a deck produces a plausible, wrong list. If
  Moxfield ever grants an accessible path, pin the parsers against live fixtures before clearing `disabled`.
