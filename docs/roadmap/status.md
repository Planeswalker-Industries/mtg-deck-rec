# Status (2026-10-04)

Where the project stands, and why things are the way they are.

> **Keep the four project docs in step.** This file is the narrative. Open work is [`../tasks.md`](../tasks.md), repo-wide rules are [`../../CLAUDE.md`](../../CLAUDE.md), and web-app detail is [`../../apps/web/AGENTS.md`](../../apps/web/AGENTS.md). Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 — Spike | Passed (go) | Blind swap-quality eval still open (T014, needs 2 human raters) |
| 1 — Data foundation + public pages | Built | Daily Archidekt crawl built but not running daily (T042); precon import not started (T018) |
| 2 — Deck tool | Built, then reworked as the deck journey | k6 load targets not measured (T013) |
| 3 — Accounts and collections | Built | Collection view, Archidekt link import and hand editing done. Open: import SQL tests (T015), 10k-row timing (T027), starting a collection by hand (T038) |
| 4 — Votes, saved decks, export | Partly built | Saved decks and export done. Votes recorded, not scored (T006). Favorites not started (T017) |

## Live setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`)
- **Database:** Supabase Pro since 2026-09-21, `us-east-2`, 8 GB. 425 MB used on 2026-09-28.
- **Scryfall data:** 34,642 live cards on hosted (2026-09-28); printings are English only.
- **Corpus on hosted:** 129 commanders have stats, rebuilt from this PC with `cli:hosted aggregate:corpus`. The crawled corpus (`corpus.decks`) holds 666 decks that nothing aggregates yet.
- **EDHREC statistics:** loaded locally and on hosted (T035 slice 11; hosted 2026-09-30, 6,787 commanders); no code reads them yet.
- **Commander Spellbook combos:** loaded locally (2026-10-04, 113,013 combos); not yet on hosted, and no code reads them yet.
- **Contract version:** v19 on `main` and `develop`.
- **Migrations on hosted:** all applied (2026-09-30). The Supabase GitHub integration had come unlinked after `20260922000400`. It was relinked, and the backlog went in by `supabase db push`, after two hand-applied migrations were marked applied.
- **Search index:** live on the VPS behind the search API, read by Vercel.
- **Auth:** Google sign-in is live locally and on hosted. Email sign-in still runs on Supabase's built-in SMTP, which is not production-grade (T033).

## Releases to main

| Date | PRs | Contract | What shipped |
|---|---|---|---|
| 2026-09-17 | #41 | v5 → v9 | Saved decks, `/decks` and deck pages, reopening in the tool with auto-save; `cards.keywords`; statement-timeout retry and `rec_timeouts`; `cards_rec_pool` index |
| 2026-09-22 | #82, #89, #93, #97 | v9 → v16 | Collection view, deck export, admin tag and sync pages, Archidekt collection links, the search API (#82); deck journey (v11); deck originals (v12); owned first (v13); deckbuilder (v14); collection editing (v15); every search on the index and small grid images (v16); deck crawls (T036) |
| 2026-09-23 | #99, #103 | v16 | Saving a deck whose commander also appears in the main list; deckbuilder layout fixes; remembered deck restored without analyzing; mobile nav menu |
| 2026-09-24 – 27 | #104–#109 | v16 | Crawl preflight (502 instead of silent 202), deleted decks stepped over, `/admin/crawls`, swipe view given the phone screen |
| 2026-09-28 | #112 | v16 → v17 | Deck-flow audit (#110: stale state and wasted requests across the recommendation flow; `excludeCardIds`); EDHREC statistics (#111, T035 slice 11) |
| 2026-09-29 | #116 | v17 | Home page facelift (#114); the Kitchen Table design lane (#115) |
| 2026-09-30 | #118 | v17 → v19 | Deckbuilder redesign (#117): build from a commander, multi-select type and cost filters, decklist rows with cost symbols, punctuation-blind name search (T052) |

`develop` holds nothing that is not on `main`.

The Kitchen Table lane (PR #115) is the current design direction (walnut surfaces, one sleeve-blue accent, Bricolage Grotesque, the 12–60 px type scale, 44 px phone touch targets, one look per kind of control; journey steps shown as Cut, Add, Swap, Done), with a new home page pitch ("Make any commander compete", the "Sound familiar?" ribbon, Cut/Add/Swap steps). The spec is the UI section of `apps/web/AGENTS.md`. Left over: the How it works recordings (T049), starting from one commander (T050), local e2e failures (T051).

## Search index (Typesense behind a Go API)

A self-hosted Typesense serves the reads that cost Postgres the most: card documents by id (a swap pool is 220 cards, an add pool 400, a commander page 500), the header search and commander picker, card tags, the proxy's slug check on every card and commander page view, and the card-shaped part of `loadCardCorpus`. Nothing talks to Typesense but `services/search-api`, so the Typesense key never leaves the VPS, and what does leave is a read token and a write token.

Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md). Service: [`services/search-api/README.md`](../../services/search-api/README.md).

- **Never a dependency.** Unset `SEARCH_API_URL` and every path takes its Postgres query; configured-but-broken logs and falls back.
- **Recommendation ranking stays in SQL**, so the open blind eval still measures what it was built to measure.
- **Live since 2026-09-23** (two Dokploy stacks, Traefik with TLS). Open under T032: the hosted parity check, the RAM measurement, and confirming the daily drain.
- **Worker drains failed from about 2026-09-28 to 2026-09-30.** Dokploy gave the service a new generated domain, and only Vercel was updated, so the GitHub secret and `.env.hosted` hit the proxy's `404 page not found`. Both were fixed on 2026-09-30 and the index was rebuilt that day (runbook note in `typesense-ops.md`).
- **Timeouts:** `rec_timeouts` has had nothing new since 2026-09-18, before the index went live. The planned re-read around 2026-09-30 decides whether T008 needs code.

## Deck crawls — Archidekt deployed, Moxfield blocked

A daily Vercel cron calls the search API, which crawls Archidekt commander by commander (queue seeded from EDHREC's ~3,600 commanders, most played first; decks most viewed first; one page per commander on the first pass, one request every 2.5–3 s) for up to six hours and writes decklists into the private `corpus` schema. Rebuilt that way on 2026-10-01 because the earlier site-wide update-ordered walk only ever collected decks edited during the run. Full account and runbook: [`deck-crawl.md`](deck-crawl.md).

- **Archidekt** is configured on the VPS and writes decks when a run starts: runs on 2026-09-24 and 2026-09-27 wrote 666 decks. **None of those runs came from the daily cron** (none started in its 10:15 UTC hour, and 2026-09-28's hour produced no run), so the Vercel trigger is the open problem (T042). A further run on 2026-09-30 at 13:12 UTC succeeded, also outside the cron's hour. T036 closed on 2026-09-28 with its leftovers split out.
- **2026-10-03:** the cron started runs in its hour on 2026-10-02 (succeeded, 85 decks written) and 2026-10-03 (failed after 57 decks: an empty deck read as a changed page, now skipped as unqualified). The first per-commander run (run 8, 21:24 UTC) failed before any request: seeding the queue timed out, because decks stored oracle ids as text and the join read the whole `cards` table. Migration `20261003000200` stores decks by card id instead and skips decks naming a card the catalog doesn't have yet (`skipped_unresolved`); it has to be applied on hosted, before the search API built from the same change is deployed, for the queue to seed.
- **Moxfield** (T044) is built but seeded disabled: from the VPS, with the app's honest User-Agent, it answered Cloudflare's hard WAF block (403). Per the crawler guardrails a block switches the source off rather than being worked around; the right number of requests to a source that has said no is zero.
- The VPS reaches the database with the service-role key, which bypasses RLS; a role limited to the `crawl_*` functions is T043.
- Either source switches itself off on a 403 or a challenge, audited as `crawl.disabled` in `audit_log`; only a human re-enables it.
- The crawl reaches `corpus` only through the `public.crawl_*` security-definer functions, because exposing a schema of third-party decklists is what it exists to avoid.
- Nothing aggregates `corpus.decks` yet; that is T035 slice 2.

## EDHREC statistics (T035 slice 11)

On `main` since PR #118 and loaded on hosted (2026-09-30). A local script saved every EDHREC commander page; `import:edhrec` loaded ~6,800 commanders' published card counts into `external_commanders` and `external_commander_card_stats`. They are kept apart from our own deck counts because EDHREC aggregates the same Archidekt and Moxfield decks.

The holdout test (`spike:edhrec:prior`) says EDHREC is the better prior for commanders with few decks of our own: with no decks of ours, its top 50 matched the hidden answer 80% of the time against 6% for the colour baseline. Next: wire the prior into scoring.

## Commander Spellbook combos (T047, data half)

Built 2026-10-04, not yet on `main`. `sync:combos` reads Commander Spellbook's published daily export (one gzipped request of about 29 MB) and keeps every combo as the set of our card ids it needs, with its results and Spellbook's bracket tag. That gives the recommender card-to-card relationships that don't depend on how many decks a commander has. The first local load stored all 113,013 combos, and every card resolved against the catalog. `combos_for_cards` finds the combos a deck completes or is one card short of, in about 6 ms for a typical deck. The daily workflow runs it after the catalog sync. Next: combo detection in the bracket estimate (T047, after the T045 display design), and missing combo pieces as add candidates.

## Open decisions for the owner

1. Where deck reports go (T003)
2. Whether public deck pages get indexed (T028)
3. Whether "Owned first" supersedes the 2026-09-18 "collection is a hard filter" decision (T037, T007)
4. A domain and custom SMTP before launch (T033)
