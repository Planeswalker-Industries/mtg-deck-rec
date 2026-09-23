# Status (2026-09-23)

Where the project stands. Open work: [`../tasks.md`](../tasks.md). Architecture reference: [`../../CLAUDE.md`](../../CLAUDE.md).

## Phase Status

| Phase | State | Notes |
|---|---|---|
| 0 — Spike | Passed (go) | Blind swap-quality eval still open (needs 2 human raters) |
| 1 — Data foundation + public pages | Built | Not done: always-on Archidekt crawler, precon import |
| 2 — Deck tool | Built, then reworked as the deck journey | Not measured: k6 load targets |
| 3 — Accounts and collections | Built | Collection view, Archidekt share-link import and hand editing done. Not done: pgTAP tests, 10k-row timing |
| 4 — Votes, saved decks, export | Partially built (ahead of plan) | Export done. Votes recorded, not scored. Not started: favorites |

## Live Setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`)
- **Database:** Supabase **Pro** since 2026-09-21, `us-east-2`, 8 GB of storage, so size is no longer a constraint. Was 416 MB of the Free tier's 500 MB just before the upgrade.
- **Scryfall data:** Catalog 34,829 cards, 525,299 printings. `artist` and `keywords` fully populated on hosted.
- **Corpus on hosted:** 129 commanders have stats. Rebuilt from this PC with `cli:hosted aggregate:corpus`.
- **Contract version:** v16 (develop, 2026-09-22)
- **Search index:** live on the VPS behind the search API, read by Vercel, rebuilt after PR #96
- **Auth:** Google sign-in is live locally and on hosted (T025); the Supabase redirect allow list and sign-in email template are set (T002). Email delivery still runs on Supabase's built-in SMTP, which is not production-grade — a real provider and a domain are T033.

## Released to main 2026-09-17

PR #41, 21 commits, contract v5 to v9. Shipped:
- Saved decks + `/decks` list + `/decks/[commander]/[code]` + reopening in tool with auto-save
- `cards.keywords` + art backdrops
- Statement-timeout retry + `public.rec_timeouts`
- `cards_rec_pool` covering index
- Deck workspace layout (Cut/Add/Replace drill-down, section nav, top suggestions in rail)

## Released to main 2026-09-22

Four releases (#82, #89, #93, #97), contract v9 to v16. #82 (v10) carried the collection view, deck export, the
admin tag and sync pages, Archidekt collection links and the search API. The rest shipped:
- **Deck journey** (v11): `/deck` opens in Upgrade mode, a guided Cut → Add → Replace → Review round. Cut deals rule
  problems and severe misfits, Add fills open slots and asks again after each accepted card, Replace pairs each soft
  cut with a replacement.
- **Deck originals** (v12): a save keeps the deck the player brought, once; the deck page shows what changed since
  and can restore it.
- **Owned first** (v13): the collection select gains "Owned first", which ranks owned cards as if they scored
  `app_config.ownership.firstBoost` higher without hiding the rest.
- **Deckbuilder** (v14): edit a deck by card type with search and filters; saved decks at
  `/decks/[commander]/[code]/edit` with auto-save, unsaved decks inline in `/deck`.
- **Collection editing** (v15): add, remove and change copies on `/collection` by hand.
- **Deck crawls** (T036): see below.
- **Search on the index** (v16, #96): every search, filtered deckbuilder search included, reads the index; a new
  search aborts the one it supersedes. Card grids load `small` images instead of `normal`: a page of 20 search
  results went from 1.83 MB to 0.26 MB, and the deckbuilder's deck list from 6.93 MB to 1.18 MB.
- The search API logs one line per request (#95), without query strings.

On develop, not yet on main: #98, saving a deck whose commander also appears in the main list.

## Search index (Typesense behind a Go API) — live

A self-hosted Typesense now serves the reads that cost Postgres the most: card documents by id (a swap pool is 220
cards, an add pool 400, a commander page 500), the header search and commander picker, card tags, the proxy's slug
check on every card and commander page view, and the card-shaped part of `loadCardCorpus` (five queries to one).
Since 2026-09-21 nothing talks to Typesense but `services/search-api` (Go, Fiber): the app reads through it, the
worker writes through it, and Typesense publishes no port at all. So the Typesense key never leaves the VPS, what
does leave is a read token and a write token, and there is one hostname to route and certify rather than a search
engine facing the internet.

Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md). The service:
[`services/search-api/README.md`](../../services/search-api/README.md).

- **Never a dependency.** Unset `SEARCH_API_URL` and every path takes the query it always took; configured-but-broken
  logs and falls back. Checked by `scripts/search-index-check.ts`.
- **Recommendation ranking is untouched.** `rec_swap_candidates` and `rec_add_candidates` stay in SQL so the open
  blind swap-quality eval still measures what it was built to measure.
- **Live (confirmed 2026-09-23):** Typesense and the search API run on the VPS as two Dokploy stacks, the API behind
  Traefik with TLS, Vercel reads through it, and the index was rebuilt for #96's schema (`card_category`, sortable
  and infix names). Still open under T032: the parity check against hosted data, the RAM measurement, and re-reading
  `rec_timeouts` a week in (T008).
- Since #96 every search reads the index, including the deckbuilder's filtered search and browse;
  `search_cards_filtered` stays as the fallback.
- Measured: triggers add ~1.4 s to a worst-case full-catalog rewrite (1.57 s to 2.99 s, 34,760 rows); a full rebuild
  is ~6 s for 39,295 documents; card rows rebuilt from documents are byte-identical to Postgres across 500 cards.

## Deck crawls — Archidekt active, Moxfield blocked (2026-09-22)

A daily deck crawl (Vercel cron → search API → private `corpus` schema, one shared engine in
`services/search-api/internal/crawl`) has two sources. Full account and runbook:
[`deck-crawl.md`](deck-crawl.md).
- **Archidekt** is **active**: its public API is reachable - the project's own worker has used it since 2026-09-14,
  and a VPS probe on 2026-09-22 returned 2xx - so the crawl is wired from the web cron. Parsers are pinned against
  live fixtures.
- **Moxfield** is built but **blocked**: probed from the VPS with the app's honest User-Agent, it answered
  Cloudflare's hard WAF block (403), and per the crawler guardrails a block switches the source off rather than
  being worked around.

Moxfield is **seeded disabled** in the migration rather than left to discover the block once a day: the right
number of requests to make to a source that has said no is zero. Either source switches itself off on a 403 or a
challenge, audited as `crawl.disabled` in `audit_log`, and only a human re-enables it. Deploying is safe.

The crawl reaches the private schema only through the `public.crawl_*` security-definer functions — PostgREST can
address a table only in an exposed schema, and exposing one holding third-party decklists is what it exists to
avoid. Nothing reads `corpus.decks` yet; aggregating it into `commander_card_stats` is the next milestone.

Left to do is configuration: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SEARCH_API_CRON_TOKEN` on the VPS,
`CRON_SECRET` + `SEARCH_API_URL` + `SEARCH_API_CRON_TOKEN` on Vercel, and the migration applied to the hosted
database. Tracked as T036.

## Open Items (from tasks.md P0)

1. Hosted sign-in configured; email deliverability (custom SMTP + domain) is T033
2. Deck report link points at GitHub issue
3. Public deck page indexing undecided

## Before Any Launch

- Decide where deck reports go
- Decide whether public deck pages should be indexed
- Buy a domain and move hosted Auth to custom SMTP (T033)

## Release Process Trap

Merging a migration to `develop` publishes a preview that still runs against **`main`'s** schema. A migration adding a column to a shared read path breaks the develop preview until `main` catches up. A column added to `content_hash` is empty on hosted until a sync rewrites the rows.
