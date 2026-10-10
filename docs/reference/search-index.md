# Search index

Typesense behind the search API, and its local commands. Back to [`CLAUDE.md`](../../CLAUDE.md).

## Search commands

```sh
docker compose -f docker-compose.search.yml up -d --build  # local Typesense (56325) + the search API (56326); the VPS runs deploy/typesense/ and deploy/search-api/ separately
cd services/search-api && go test ./...          # the search API (Go, Fiber); it fakes Typesense, so it needs nothing running
cd services/search-api && SUPABASE_TEST_URL=http://127.0.0.1:56321 SUPABASE_TEST_SERVICE_KEY=<service key> go test ./internal/crawl/ -run Live   # the crawl's store against a real PostgREST; skipped without both variables
```

### Search index (Typesense behind the search API, on the VPS)

The highest-volume reads are document lookups, which cost Postgres a heap visit each. `docs/roadmap/typesense-plan.md` says what moved and why; `docs/roadmap/typesense-ops.md` is the runbook; `services/search-api/README.md` is the service.

- **Nothing but `services/search-api` talks to Typesense.** Typesense publishes no port. Three secrets, each able to do less: `TYPESENSE_ADMIN_KEY` stays on the VPS; `SEARCH_API_ADMIN_TOKEN` (worker, sync workflow) reads and writes; `SEARCH_API_TOKEN` (Vercel) only reads. The two tokens must differ; the service refuses to start otherwise.
- **It is not a Typesense proxy.** Endpoints answer the project's questions ("these 500 cards", "does this slug have a page"), so chunking, paging and ranking live there. Documents are opaque to it: their shape is defined once in `@mtg/core/search`, and the Go service reads only `card_id` and `slug`.
- **It is an optimisation, never a dependency.** With `SEARCH_API_URL` unset (CI, a fresh checkout) every read takes its Postgres query; with the index slow or broken, `fromIndex` logs, returns null and the caller falls through to the same query. The contract did not change for it.
- **Liveness and readiness are different endpoints**: the container probe asks `/v1/health/live`, so a Typesense outage the app already falls back from doesn't restart-loop the API. `/v1/health` reports Typesense. `search-api healthcheck` is a mode of the same binary (distroless has no shell).
- **Deployed as two compose files** (`deploy/typesense/`, `deploy/search-api/`) on a hand-made external Docker network `mtg-search`, because the two have different lifecycles; `docker-compose.search.yml` runs both locally.
- **Four collections**: `cards`, `tags`, `commanders`, `commander_cards`.
  - Keyed by the stable surrogate id, never the slug (a rename changes a slug).
  - Colour identity is indexed as letters as well as the bitmask, since Typesense has no bitwise operators (`identityFilter`).
  - Timestamps are written in PostgREST's shape (`+00:00`) so an index read and a fallback read produce the same string.
  - `name_head` (first word of every name) carries the "starts with beats contains" tier, weighted above `name` and `names`. `name` and `names` match inside words (`infix`), as Postgres's `%bolt%` did; `name_head` does not.
  - `oracle_text` and `card_faces` are absent: only the card page needs them, and it is cached for days.
  - Card documents carry every tag, including disabled ones; the kill switch is applied at read time (`tagRefsFromDocument`), so turning a tag off needs no reindex.
- **Triggers write a queue; the worker drains it.** Every source table writes the document's stable key into `public.search_index_queue` (upsert-keyed, bounded by distinct documents). Nothing in Postgres talks to Typesense.
  - No "upsert or delete" column: the drain looks the key up, and gone or soft-deleted means remove.
  - The delete compares on `seq` (a bigint), never `enqueued_at`: postgres.js truncates timestamps to milliseconds, which once made the drain loop forever. The drain stops rather than repeat a batch it could not clear.
  - Changes with no cheap card list (tag hierarchy, functional allow/deny lists) enqueue a `'*'` sentinel that reindexes the collection.
  - Drains run after every successful sync, in the daily workflow, and via `cli sync:typesense` by hand. `.github/workflows/search-index.yml` rebuilds or drains on demand (`workflow_dispatch`; over the API the input is the string `"rebuild": "true"`).
- **A schema change needs `sync:typesense --rebuild`**; a drain cannot add a field. A rebuild builds a versioned collection and moves the alias only when complete, so it is always safe.
- **Still in Postgres, on purpose:** the recommendation reads (the serving tables, read with their scores in one round), `resolve_card_names` (parser correctness), `resolve_collection_rows` (printing-level, exact identifiers), and everything a user owns (an index has no row-level security).
