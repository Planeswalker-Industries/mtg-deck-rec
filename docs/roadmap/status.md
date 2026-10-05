# Status (2026-10-05)

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
- **Database:** Supabase Pro since 2026-09-21, `us-east-2`, 8 GB. 705 MB used on 2026-10-05.
- **Scryfall data:** 34,642 live cards on hosted (2026-09-28); printings are English only.
- **Corpus on hosted:** 129 commanders have stats, from the 2026-09-15 run over the deck spike's 15,135 decks (rebuilt by hand with `cli:hosted aggregate:corpus`). The crawled corpus (`corpus.decks`) holds 68,763 decks over 3,235 commander keys (2026-10-05) that nothing aggregates yet; the first rebuild from it replaces the 2026-09-15 stats. The spike's deck files are stale and are not imported (owner decision 2026-10-05).
- **EDHREC statistics:** loaded locally and on hosted (T035 slice 11; hosted 2026-09-30, 6,787 commanders). The prior that reads them is wired and switched off (PR #123).
- **Commander Spellbook combos:** loaded raw locally (2026-10-05, 113,025 combos); not on hosted yet, and nothing reads them yet.
- **Contract version:** v19 on `main` and `develop`.
- **Migrations on hosted:** all applied and recorded up to `20261003000200`. On 2026-10-05 four of them (`20261001000100` to `20261003000200`) were found applied but unrecorded; the owner marked them applied with `supabase migration repair` the same day. (On 2026-09-30 the GitHub integration had come unlinked after `20260922000400`; it was relinked and the backlog pushed.)
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
| 2026-10-01 | #121 | v19 | Journey memory, the resume prompt, rename, deckbuilder fixes (#120) |
| 2026-10-03 | #124, #126 | v19 | The crawl at 1 s with adaptive backoff and a queue ordered by need, and the EDHREC prior switched off (#123); crawled decks stored by card id, empty decks skipped (#125) |

`develop` holds PR #129 (data layers, T053), not yet on `main`.

The Kitchen Table lane (PR #115) is the current design direction (walnut surfaces, one sleeve-blue accent, Bricolage Grotesque, the 12–60 px type scale, 44 px phone touch targets, one look per kind of control; journey steps shown as Cut, Add, Swap, Done), with a new home page pitch ("Make any commander compete", the "Sound familiar?" ribbon, Cut/Add/Swap steps). The spec is the UI section of `apps/web/AGENTS.md`. Left over: the How it works recordings (T049), starting from one commander (T050), local e2e failures (T051).

## Search index (Typesense behind a Go API)

A self-hosted Typesense serves the reads that cost Postgres the most: card documents by id (a swap pool is 220 cards, an add pool 400, a commander page 500), the header search and commander picker, card tags, the proxy's slug check on every card and commander page view, and the card-shaped part of `loadCardCorpus`. Nothing talks to Typesense but `services/search-api`, so the Typesense key never leaves the VPS, and what does leave is a read token and a write token.

Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md). Service: [`services/search-api/README.md`](../../services/search-api/README.md).

- **Never a dependency.** Unset `SEARCH_API_URL` and every path takes its Postgres query; configured-but-broken logs and falls back.
- **Recommendation ranking stays in SQL**, so the open blind eval still measures what it was built to measure.
- **Live since 2026-09-23** (two Dokploy stacks, Traefik with TLS). Open under T032: the hosted parity check, the RAM measurement, and confirming the daily drain.
- **Worker drains failed from about 2026-09-28 to 2026-09-30.** Dokploy gave the service a new generated domain, and only Vercel was updated, so the GitHub secret and `.env.hosted` hit the proxy's `404 page not found`. Both were fixed on 2026-09-30 and the index was rebuilt that day (runbook note in `typesense-ops.md`).
- **Timeouts:** `rec_timeouts` gained a swap row on 2026-09-30, and on 2026-10-05 calls to `rec_add_candidates` and `rec_swap_candidates` averaged 0.8–1.0 s with peaks at the 3 s timeout. The precompute worker (T055) replaces both functions with indexed reads, which closes T008.

## Deck crawls — Archidekt deployed, Moxfield blocked

A daily Vercel cron calls the search API, which crawls Archidekt commander by commander (queue seeded from EDHREC's ~3,600 commanders, most played first; decks most viewed first; one page per commander on the first pass, about one request a second with adaptive backoff) for up to six hours and writes decklists into the private `corpus` schema. Rebuilt that way on 2026-10-01 because the earlier site-wide update-ordered walk only ever collected decks edited during the run. Full account and runbook: [`deck-crawl.md`](deck-crawl.md).

- **Archidekt** is configured on the VPS and writes decks when a run starts: runs on 2026-09-24 and 2026-09-27 wrote 666 decks. **None of those runs came from the daily cron** (none started in its 10:15 UTC hour, and 2026-09-28's hour produced no run), so the Vercel trigger is the open problem (T042). A further run on 2026-09-30 at 13:12 UTC succeeded, also outside the cron's hour. T036 closed on 2026-09-28 with its leftovers split out.
- **2026-10-03:** the cron started runs in its hour on 2026-10-02 (succeeded, 85 decks written) and 2026-10-03 (failed after 57 decks: an empty deck read as a changed page, now skipped as unqualified). The first per-commander run (run 8, 21:24 UTC) failed before any request: seeding the queue timed out, because decks stored oracle ids as text and the join read the whole `cards` table. Migration `20261003000200` stores decks by card id instead and skips decks naming a card the catalog doesn't have yet (`skipped_unresolved`); it has to be applied on hosted, before the search API built from the same change is deployed, for the queue to seed.
- **Moxfield** (T044) is built but seeded disabled: from the VPS, with the app's honest User-Agent, it answered Cloudflare's hard WAF block (403). Per the crawler guardrails a block switches the source off rather than being worked around; the right number of requests to a source that has said no is zero.
- The VPS reaches the database with the service-role key, which bypasses RLS; a role limited to the `crawl_*` functions is T043.
- Either source switches itself off on a 403 or a challenge, audited as `crawl.disabled` in `audit_log`; only a human re-enables it.
- The crawl reaches `corpus` only through the `public.crawl_*` security-definer functions, because exposing a schema of third-party decklists is what it exists to avoid.
- **2026-10-05:** 12 runs since 2026-09-24 hold 68,763 decks over 3,235 commander keys; 947 keys have 50 or more decks, and none has more than 93, because revisits re-read page 1 only. T056 makes a revisit read on until 25 decks were new or changed (owner rule 2026-10-05).
- Nothing aggregates `corpus.decks` yet; the collator (T054) does, after the data layers move (T053).

## EDHREC statistics (T035 slice 11)

On `main` since PR #118 and loaded on hosted (2026-09-30). A local script saved every EDHREC commander page; `import:edhrec` loaded ~6,800 commanders' published card counts into `external_commanders` and `external_commander_card_stats` (now `corpus.edhrec_commanders` and `corpus.edhrec_commander_cards`). Both were retired on 2026-10-05: the saved pages are stale, and `sync:edhrec` (T054) refetches the pages into the raw `edhrec` schema, weekly once the VPS worker (T066) runs it. They are kept apart from our own deck counts because EDHREC aggregates the same Archidekt and Moxfield decks.

The holdout test (`spike:edhrec:prior`, since retired) says EDHREC is the better prior for commanders with few decks of our own: with no decks of ours, its top 50 matched the hidden answer 80% of the time against 6% for the colour baseline. The prior is wired and switched off (PR #123); T061 replaces its fixed share with weighting by sample size.

## Data layers and scoring (designed 2026-10-05)

The owner reviewed the open PRs #127 (Commander Spellbook combos) and #128 (the scoring design and a VPS worker) and set the direction:
- **Data layers.** Each source keeps its data in its own schema as published (`archidekt`, `edhrec`, `spellbook`); the crawler's machinery moves to `crawl`; a collator resolves everything into `corpus` with a source on every row; a precompute worker builds everything the app reads. Plan: [`card-graph-plan.md`](card-graph-plan.md).
- **Speed.** Requests become indexed reads of precomputed tables; the two rec SQL functions retire (T055).
- **Scoring.** EDHREC weighted by its sample size, combos as their own Add group, one marginal-value function for adds, cuts, swaps and builds, bracket rules updated (no tutor limit since WotC's October 2025 update), and a seeded bootstrap gate on every weight change. Design: [`scoring-design.md`](scoring-design.md).
- **Order:** T053 (with #127 reworked), T054 (with #128 reworked), T055, and the rest as the roadmap lists. The hosted migration history was repaired first.
- **T053 is built** (2026-10-05, migration `20261005000200_data_layers.sql`): the schemas exist, the crawl tables and EDHREC tables moved, and crawled decks are stored raw as oracle ids. Not on hosted yet.
- **The deck spike's code is retired** (2026-10-05): the spike crawler, its two measurement jobs, the tag profiler, the PC lookup worker, `import:edhrec` and the TypeScript Archidekt client. `aggregate:corpus` now reads only the collated `corpus.decks`, which the collator (T054) fills; until it runs on hosted, hosted's stats stay at the 2026-09-15 run, and deck lookups wait for the VPS worker (T066).
- **The design's open questions were answered the same day:** in bracket 3 only Spellbook's R combos flag; Tagger's mass land denial and extra-turn tags count, planeswalkers excluded, with at most 2 extra-turn cards in brackets 2–3; the buy list and build start from placeholder values the evaluation retunes, with basics learned per commander; accept events get a `/privacy` line and no opt-out.
- **T054, the collator, is built** (2026-10-05, not yet on `main`): `cli collate` resolves every raw source into `corpus` with one deck rule, only where something changed, and `sync:edhrec` fetches EDHREC's pages raw (from PR #128, rewritten). Locally, with hosted's 76,774 crawled decks copied in, collation took 18 s and 74,874 decks passed; the aggregate over them took 1 min 38 s for 2,716 commanders. On hosted it runs by hand after release (`sync:edhrec`, `collate`, `aggregate:corpus`) until the VPS worker (T066) schedules it. `minDecks` and `fullDecks` are both 50.

## Commander Spellbook combos (T047, data half)

Built 2026-10-04 (PR #127) and reworked 2026-10-05 into the raw `spellbook` schema; not yet on `main`. `sync:spellbook` reads Commander Spellbook's published daily export (one gzipped request of about 29 MB, about 10 s) and keeps every combo as Spellbook publishes it: the pieces as Scryfall oracle ids, its results and its bracket tag. That gives the recommender card-to-card relationships that don't depend on how many decks a commander has. The local load stored all 113,025 combos and 1,099 results, none malformed; a forced re-run of the same export wrote nothing. The daily workflow runs it once `SPELLBOOK_SYNC_ENABLED` is set, after the migration reaches hosted. Next: the collator resolves combos to our cards (T054), and bracket rules and the "complete a combo" Add group use them (T060).

## Open decisions for the owner

1. Where deck reports go (T003)
2. Whether public deck pages get indexed (T028)
3. A domain and custom SMTP before launch (T033)
