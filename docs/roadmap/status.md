# Status (2026-09-19)

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

## Released to main 2026-09-17

PR #41, 21 commits, contract v5 to v9. Shipped:
- Saved decks + `/decks` list + `/decks/[commander]/[code]` + reopening in tool with auto-save
- `cards.keywords` + art backdrops
- Statement-timeout retry + `public.rec_timeouts`
- `cards_rec_pool` covering index
- Deck workspace layout (Cut/Add/Replace drill-down, section nav, top suggestions in rail)

## Open Items (from tasks.md P0)

1. Hosted sign-in not set up (dashboard config, not code)
2. Deck report link points at GitHub issue
3. Public deck page indexing undecided
4. `seed.sql` and `dev-sign-in.ts` need to be deleted or proven unreachable

## Before Any Launch

- Delete `supabase/seed.sql` and `apps/web/scripts/dev-sign-in.ts`, or prove they cannot reach the hosted project
- Decide where deck reports go
- Decide whether public deck pages should be indexed
- Add `/auth/confirm` and `/auth/callback` to Supabase Auth redirect allow list
- Paste `supabase/templates/sign-in.html` into dashboard email templates
- Set `SUPABASE_SECRET_KEY` on Vercel

## Release Process Trap

Merging a migration to `develop` publishes a preview that still runs against **`main`'s** schema. A migration adding a column to a shared read path breaks the develop preview until `main` catches up. A column added to `content_hash` is empty on hosted until a sync rewrites the rows.
