# Running the search index on the VPS

Companion to [`typesense-plan.md`](typesense-plan.md), which says *what* moves into the index and why. This is how to
stand it up and keep it running. Decided 2026-09-19: **self-hosted on the owner's VPS**, not Typesense Cloud.

## What it holds, and how big

Four collections, rebuilt from Postgres at any time by one command — nothing in the index is a source of truth, so
losing the whole machine costs a rebuild and nothing else.

| Collection | Documents (2026-09-19, local catalog) |
|---|---|
| `cards` | 34,760 |
| `tags` | 4,535 |
| `commanders` | one per `commander_keys` row (129 on hosted) |
| `commander_cards` | one per (commander, card) play rate |

Typesense keeps the search index in RAM and the raw documents on disk; the rule of thumb is **2–3× the size of the
indexed fields**. Ours are names, type lines, tag UUIDs and numerics, so **plan on a few hundred MB of RAM** and check
against the real thing after the first build (`/metrics.json`). `commander_cards` is the one collection that grows
with the corpus — recheck it at 500 commanders.

## Standing it up

**1. Run it.** `deploy/typesense/` is the whole deployment — copy that directory to the VPS (or check the repo out
there) and:

```sh
cd deploy/typesense
cp .env.example .env
openssl rand -base64 36          # put this in .env as TYPESENSE_ADMIN_KEY
docker compose up -d
docker compose ps                # wait for "healthy"
```

The compose file refuses to start without a key rather than booting an open index, keeps the data in `./data` beside
it, caps memory (`TYPESENSE_MEM_LIMIT`, default 1g) and rotates its logs. It publishes on **127.0.0.1:8108** only:
Typesense terminates no TLS of its own and its API key is the whole of its access control, so it goes behind the
reverse proxy that already holds the certificate.

```nginx
location / {
  proxy_pass http://127.0.0.1:8108;
  proxy_set_header Host $host;
}
```

Two things worth knowing about that container. Its healthcheck goes through `bash`'s `/dev/tcp` rather than `curl`,
because **the image ships neither curl nor wget** — the obvious healthcheck marks a perfectly working container
unhealthy forever. And there is no backup story on purpose: nothing in the index is a source of truth, so losing the
volume costs one `--rebuild` and restoring from Postgres is both faster and always correct.

**2. Make two keys, not one.** The admin key above can drop collections. The app must never hold it:

```sh
curl -X POST "https://<host>/keys" -H "X-TYPESENSE-API-KEY: $TYPESENSE_ADMIN_KEY" \
  -H 'content-type: application/json' \
  -d '{"description":"web app, search only","actions":["documents:search","documents:get"],"collections":["*"]}'
```

The response shows the key **once**. That is `TYPESENSE_SEARCH_KEY`.

Two actions, and no more. `documents:search` covers the header search, the card multi-gets, the tag pages and the
proxy's slug lookup; `documents:get` is there only so a future single-document read needs no new key. Nothing about
collections, aliases or writes, so the worst a leaked search key can do is read public card data the site already
serves — and it cannot drop a collection. Verify with `GET /keys` that the worker's key and the app's key are
different ones.

**3. Build it.**

```sh
TYPESENSE_URL=https://<host> TYPESENSE_ADMIN_KEY=... \
  yarn workspace @mtg/worker cli:hosted sync:typesense --rebuild
```

**4. Point things at it.**

| Where | Variables |
|---|---|
| Vercel (Production **and** Preview) | `TYPESENSE_URL`, `TYPESENSE_SEARCH_KEY` |
| GitHub Actions secrets (the daily sync) | `TYPESENSE_URL`, `TYPESENSE_ADMIN_KEY` |
| `apps/worker/.env.hosted` (this PC: corpus rebuilds, deck lookups) | `TYPESENSE_URL`, `TYPESENSE_ADMIN_KEY` |

Unset anywhere is a working configuration — that side just reads Postgres.

## Keeping it in step

Every table a document is built from has a trigger that writes the document's key into `public.search_index_queue`.
Three things drain it:

- **Each finished sync**, from `finishRun` — `sync:catalog`, `sync:printings`, `sync:tags`, `aggregate:corpus`.
- **The daily workflow**, as a final sweep (`.github/workflows/sync.yml`), which also catches a job that skipped as
  unchanged or a drain that failed.
- **By hand**: `yarn workspace @mtg/worker cli:hosted sync:typesense`.

Nothing in Postgres talks to Typesense, so the index's credentials never go near the database and a network hop can
never slow down or fail a sync transaction.

### What to do when

| Situation | Do |
|---|---|
| Queue is growing and not draining | `cli:hosted sync:typesense`, and read its error. It stops rather than looping. |
| Results look stale or wrong | `cli:hosted sync:typesense --rebuild`. Safe at any time: it builds a new versioned collection and moves the alias only when it is complete. |
| A schema field was added in `@mtg/core/search` | `--rebuild`. A new field needs a new collection; a plain drain cannot add one. |
| Disk or memory filling up | A `--rebuild` drops every stale version of each collection, not just the one the alias pointed at — a rebuild that died before moving its alias leaves a full copy behind, and Typesense loads every collection it has into memory at startup. `GET /collections` should show exactly four. |
| Upgrading Typesense | Bump the tag in `deploy/typesense/docker-compose.yml`, `docker compose up -d`, then `--rebuild`. |
| The VPS is down | Nothing breaks. Every read path falls back to Postgres and logs. Rebuild when it is back. |

### Checks

```sh
yarn workspace @mtg/web tsx scripts/search-index-check.ts                        # fallback survives a broken index (no DB, no index; runs in CI)
yarn workspace @mtg/web tsx --env-file=.env.local scripts/search-parity-check.ts # the index agrees with Postgres (needs both, local only)
```

## Local development

A separate compose file at the repo root, so the local one can be thrown away without touching the deployment:

```sh
docker compose -f docker-compose.typesense.yml up -d     # port 56325, beside Supabase's 56321-56324
yarn workspace @mtg/worker cli sync:typesense --rebuild
```

It uses a named volume and a fixed development key, where the deployment uses a bind mount and a real one.

Then in `apps/web/.env.local`:

```
TYPESENSE_URL=http://localhost:56325
TYPESENSE_SEARCH_KEY=mtg-local-dev-key
```

Leave them out to work the way CI does, against Postgres alone.

## Measured, so far

- A worst-case `sync:catalog --force` rewrites all 34,760 card rows: **1.57 s without the triggers, 2.99 s with** —
  about 41 µs per row to enqueue. The daily price update touches far fewer.
- A full rebuild of all four collections from the local catalog: **about 6 s**, 39,295 documents.
- A whole-collection sentinel (a tag-hierarchy change) reindexes 34,760 cards in **about 6 s**.
- The container reports healthy about 40 s after `up -d`, most of which is the 10 s `start_period`.
- Card rows rebuilt from documents are **byte-identical** to the same rows read from Postgres, across a 500-card
  sample (`search-parity-check.ts`).
