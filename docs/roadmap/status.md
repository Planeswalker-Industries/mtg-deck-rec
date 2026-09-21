# Status (2026-09-21)

Where the project stands. Open work: [`../tasks.md`](../tasks.md). Architecture reference: [`../../CLAUDE.md`](../../CLAUDE.md).

## Phase Status

| Phase | State | Notes |
|---|---|---|
| 0 — Spike | Passed (go) | Blind swap-quality eval still open (needs 2 human raters) |
| 1 — Data foundation + public pages | Built | Not done: always-on Archidekt crawler, precon import |
| 2 — Deck tool | Built | Not measured: k6 load targets |
| 3 — Accounts and collections | Partially built | Not done: pgTAP tests, 10k-row timing, share-link collection imports |
| 4 — Votes, saved decks, export | Partially built (ahead of plan) | Votes recorded, not scored. Not started: export, favorites |

## Live Setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`)
- **Database:** Supabase Free, `us-east-2`, **381 MB of 500 MB** (2026-09-17, post-keywords release)
- **Scryfall data:** Catalog 34,829 cards, 525,299 printings. `artist` and `keywords` fully populated on hosted.
- **Corpus on hosted:** 129 commanders have stats. Rebuilt from this PC with `cli:hosted aggregate:corpus`.
- **Contract version:** v9 (as of 2026-09-17 release)
- **Auth:** Google sign-in is live locally and on hosted (T025); the Supabase redirect allow list and sign-in email template are set (T002). Email delivery still runs on Supabase's built-in SMTP, which is not production-grade — a real provider and a domain are T033.

## Released to main 2026-09-17

PR #41, 21 commits, contract v5 to v9. Shipped:
- Saved decks + `/decks` list + `/decks/[commander]/[code]` + reopening in tool with auto-save
- `cards.keywords` + art backdrops
- Statement-timeout retry + `public.rec_timeouts`
- `cards_rec_pool` covering index
- Deck workspace layout (Cut/Add/Replace drill-down, section nav, top suggestions in rail)

## Search index (Typesense) — built 2026-09-19, not deployed

A self-hosted Typesense now serves the reads that cost Postgres the most: card documents by id (a swap pool is 220
cards, an add pool 400, a commander page 500), the header search and commander picker, card tags, the proxy's slug
check on every card and commander page view, and the card-shaped part of `loadCardCorpus` (five queries to one).
Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md).

- **Never a dependency.** Unset `TYPESENSE_URL` and every path takes the query it always took; configured-but-broken
  logs and falls back. Checked by `scripts/search-index-check.ts`.
- **Recommendation ranking is untouched.** `rec_swap_candidates` and `rec_add_candidates` stay in SQL so the open
  blind swap-quality eval still measures what it was built to measure.
- **Left to do is configuration, not code** — see T032. Nothing is live until the VPS is running.
- Measured: triggers add ~1.4 s to a worst-case full-catalog rewrite (1.57 s to 2.99 s, 34,760 rows); a full rebuild
  is ~6 s for 39,295 documents; card rows rebuilt from documents are byte-identical to Postgres across 500 cards.

## Open Items (from tasks.md P0)

1. Hosted sign-in configured; email deliverability (custom SMTP + domain) is T033
2. Deck report link points at GitHub issue
3. Public deck page indexing undecided
4. `seed.sql` and `dev-sign-in.ts` need to be deleted or proven unreachable

## Before Any Launch

- Delete `supabase/seed.sql` and `apps/web/scripts/dev-sign-in.ts`, or prove they cannot reach the hosted project
- Decide where deck reports go
- Decide whether public deck pages should be indexed
- Buy a domain and move hosted Auth to custom SMTP (T033)

## Release Process Trap

Merging a migration to `develop` publishes a preview that still runs against **`main`'s** schema. A migration adding a column to a shared read path breaks the develop preview until `main` catches up. A column added to `content_hash` is empty on hosted until a sync rewrites the rows.
