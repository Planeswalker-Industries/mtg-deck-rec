# Status (2026-10-07)

Where the project stands, and why things are the way they are.

> **Keep the four project docs in step.** This file is the narrative. Open work is [`../tasks.md`](../tasks.md), repo-wide rules are [`../../CLAUDE.md`](../../CLAUDE.md), and web-app detail is [`../../apps/web/AGENTS.md`](../../apps/web/AGENTS.md). Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 — Spike | Passed (go) | Blind swap-quality eval still open (T014, needs 2 human raters) |
| 1 — Data foundation + public pages | Built | Precon import not started (T018) |
| 2 — Deck tool | Built, then reworked as the deck journey | k6 load targets not measured (T013) |
| 3 — Accounts and collections | Built | Open: import SQL tests (T015), 10k-row timing (T027), starting a collection by hand (T038) |
| 4 — Votes, saved decks, export | Partly built | Saved decks and export done. Votes recorded, not scored (T006). Favorites not started (T017) |
| 5 — Data pipeline and scoring | Released 2026-10-07 | Running by hand until the VPS worker is deployed (T066); follow-ups T067–T069 |

## Live setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`)
- **Database:** Supabase Pro, `us-east-2`, 8 GB disk, Small compute (2 GB RAM). 4.16 GB used after the 2026-10-07 release; reclaimable dead space is T041.
- **Contract version:** v25 on `main` and `develop`.
- **Migrations on hosted:** all applied up to `20261007000100` (2026-10-07, `db-push.yml` from `develop`, ahead of the code). The Supabase GitHub integration has failed to apply migrations since 2026-09-30, so `db-push.yml` is the way in.
- **Scryfall data:** 34,658 live cards; printings are English only.
- **Corpus on hosted:** 79,759 collated decks over 2,818 commander keys (collated and aggregated by hand on 2026-10-06/07). 5.82M score rows for 4,672 commander sets, EDHREC-only commanders included; 800,624 per-commander card pairs and 485,386 corpus-wide.
- **EDHREC statistics:** the 2026-09-30 import (6,787 commanders) in `corpus.edhrec_*`; raw `edhrec.*` is empty until the first hosted `sync:edhrec` (T068). The prior is on (cap 100).
- **Commander Spellbook combos:** not on hosted: the repo variable `SPELLBOOK_SYNC_ENABLED` isn't set, so "complete a combo" and the combo bracket rules answer nothing in production yet (T068).
- **Search index:** live on the VPS behind the search API, read by Vercel; the daily drain works.
- **VPS worker:** built and released, not deployed (T066). Collation, the precompute passes, EDHREC fetches and deck lookups run only by hand until it is.
- **Auth:** Google sign-in is live. Email sign-in still runs on Supabase's built-in SMTP, which is not production-grade (T033).

## Releases to main

| Date | PRs | Contract | What shipped |
|---|---|---|---|
| 2026-09-17 | #41 | v5 → v9 | Saved decks, `/decks` and deck pages, reopening in the tool with auto-save; `cards.keywords`; `cards_rec_pool` index |
| 2026-09-22 | #82, #89, #93, #97 | v9 → v16 | Collection view, deck export, admin tag and sync pages, Archidekt collection links, the search API; deck journey (v11); deck originals (v12); owned first (v13); deckbuilder (v14); collection editing (v15); every search on the index (v16); deck crawls |
| 2026-09-23 – 27 | #99, #103, #104–#109 | v16 | Deck save fixes, mobile nav, crawl preflight, `/admin/crawls`, the swipe view given the phone screen |
| 2026-09-28 | #112 | v16 → v17 | Deck-flow audit (`excludeCardIds`); EDHREC statistics |
| 2026-09-29 | #116 | v17 | Home page facelift; the Kitchen Table design lane |
| 2026-09-30 | #118 | v17 → v19 | Deckbuilder redesign: build from a commander, multi-select filters, decklist rows with cost symbols, punctuation-blind name search |
| 2026-10-01 | #121 | v19 | Journey memory, the resume prompt, rename |
| 2026-10-03 | #124, #126 | v19 | The crawl at 1 s with adaptive backoff and a queue ordered by need; crawled decks stored by card id |
| 2026-10-06 | #135, #138 | v19 | Data layers (T053), Spellbook's raw tables, the collator (T054), the VPS worker (T066), crawl growth (T056), the precompute worker and serving reads (T055), substitutes per colour identity |
| 2026-10-07 | #140 | v19 → v25 | The scoring pipeline (PR #139, T057–T065) with its review fixes |

The Kitchen Table lane (PR #115) is the current design direction (walnut surfaces, one sleeve-blue accent, Bricolage Grotesque, the 12–60 px type scale, 44 px phone touch targets, one look per kind of control; journey steps shown as Cut, Add, Swap, Done). The spec is the UI section of `apps/web/AGENTS.md`. Left over: the How it works recordings (T049), starting from one commander (T050), local e2e failures (T051).

## Data pipeline and scoring (released 2026-10-07)

Designed 2026-10-05 after the owner's review of PRs #127 and #128: [`card-graph-plan.md`](card-graph-plan.md) (data), [`scoring-design.md`](scoring-design.md) (scoring). CLAUDE.md ("Data pipeline") holds the rules.

- **Layers.** Each source keeps its data in its own schema as published (`archidekt`, `edhrec`, `spellbook`); the crawler's machinery is `crawl`; the collator resolves everything into `corpus` with one deck rule; the precompute worker builds the serving tables the app reads.
- **Requests read precomputed tables in one round** and rank in TypeScript (`@mtg/core/scoring` `rank.ts`). The per-request SQL scoring (0.8–1.0 s on average, peaks at the 3 s timeout) left the request path when `servingReads` went on (2026-10-07); its functions leave the database with T067.
- **Scoring:** every weight in `app_config.scoring`; the EDHREC prior by sample size (adds recall@20 17.2% → 25.0% on the time split); collection mode with built decks, owned twins and a buy list; bracket rules with combos; a learned curve and land counts (used by builds; as add and cut scores they failed the evaluation and stay off); card pairs and deck affinity (`deck` 0.1 in adds, recall@20 25.0% → 25.5%); builds from a commander and a bracket (38.6% overlap with held-out decks); the live accept rate (`rec_events`).
- **Every weight change goes through the offline evaluation** (`cli eval:holdout`, the four-part gate). Its known weaknesses are listed in T068.
- **The review before release (2026-10-07)** fixed owned-twin bugs in collection mode and builds, made accept-rate events server-only, clamped what anonymous reads may ask for, stopped diff-only merges from locking every unchanged row, fixed a pairs recount that ran every 30 minutes, and pinned the evaluation's time split (migration `20261007000100`). The release went migrations first, then code, so `main`'s old code kept working in between.
- **Latency after release:** one round still, but the new reads made adds about 90 ms slower at p50 (212 → 306 ms, the previous and new builds interleaved), cuts 65 ms and swaps 31 ms. Card pairs cost most of it; the fixes are listed in T068.
- **Storage:** within budget today (4.16 GB of 8), not at the plan's full crawl: projected about 8.4 GB at six times today's decks, mostly score rows for commander pairs that borrow their partners' decks. The redesign is in T068.
- **UI** for collection mode, combos and builds was shelved during the sprint (owner, 2026-10-06) and is T069.

## Search index (Typesense behind a Go API)

A self-hosted Typesense serves the reads that cost Postgres the most: card documents by id, the header search and commander picker, card tags, and the proxy's slug check on every card and commander page view. Nothing talks to Typesense but `services/search-api`, so the Typesense key never leaves the VPS. Recommendation reads stay in Postgres, which returns cards with their scores in the same round.

Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md). Service: [`services/search-api/README.md`](../../services/search-api/README.md).

- **Never a dependency.** Unset `SEARCH_API_URL` and every path takes its Postgres query; configured-but-broken logs and falls back.
- **Live since 2026-09-23** (two Dokploy stacks, Traefik with TLS). Open under T032: the hosted parity check and the RAM measurement.

## Deck crawls — Archidekt running daily, Moxfield blocked

A daily Vercel cron calls the search API, which crawls Archidekt commander by commander (queue seeded from EDHREC's ~3,600 commanders, ordered by need; decks most viewed first; about one request a second with adaptive backoff) for up to six hours and writes decklists raw into `archidekt.decks`. Full account and runbook: [`deck-crawl.md`](deck-crawl.md).

- **Archidekt:** a run has started in the cron's hour every day since 2026-10-02; the VPS worker takes over the trigger once deployed (T066). Hosted holds 100,994 raw decks (2026-10-07). Revisits read on until 25 decks were new or changed (T056): 23 commanders have passed the old ceiling of 93 decks (the most 190), and 4,449 decks carry their author's declared bracket.
- **Moxfield** (T044) is built but seeded disabled: from the VPS, with the app's honest User-Agent, it answered Cloudflare's hard WAF block (403). A block switches the source off rather than being worked around.
- The VPS reaches the database with the service-role key, which bypasses RLS; a role limited to the `crawl_*` functions is T043.
- Either source switches itself off on a 403 or a challenge, audited as `crawl.disabled` in `audit_log`; only a human re-enables it.

## Open decisions for the owner

1. Where deck reports go (T003)
2. Whether public deck pages get indexed (T028)
3. A domain and custom SMTP before launch (T033)
4. How long to keep `rec_events`, and the `/privacy` line that says so (T068)
5. When to drop the retired rec functions, which ends rollback to the pre-release build (T067)
