# Status (2026-09-28)

Where the project stands, and why things are the way they are.

> **Keep the four project docs in step.** This file is the narrative. Open work is [`../tasks.md`](../tasks.md), repo-wide rules are [`../../CLAUDE.md`](../../CLAUDE.md), and web-app detail is [`../../apps/web/AGENTS.md`](../../apps/web/AGENTS.md). Any change to this file is checked against those three in the same edit. When they disagree, the code wins and every doc gets corrected.

## Phase status

| Phase | State | Notes |
|---|---|---|
| 0 — Spike | Passed (go) | Blind swap-quality eval still open (T014, needs 2 human raters) |
| 1 — Data foundation + public pages | Built | Daily Archidekt crawl built but not running daily (T036); precon import not started (T018) |
| 2 — Deck tool | Built, then reworked as the deck journey | k6 load targets not measured (T013) |
| 3 — Accounts and collections | Built | Collection view, Archidekt link import and hand editing done. Open: import SQL tests (T015), 10k-row timing (T027), starting a collection by hand (T038) |
| 4 — Votes, saved decks, export | Partly built | Saved decks and export done. Votes recorded, not scored (T006). Favorites not started (T017) |

## Live setup

- **Site:** https://mtg-app-psi.vercel.app, Vercel project `mtg-app` (root `apps/web`, functions in `cle1`)
- **Database:** Supabase Pro since 2026-09-21, `us-east-2`, 8 GB. 425 MB used on 2026-09-28.
- **Scryfall data:** 34,642 live cards on hosted (2026-09-28); printings are English only.
- **Corpus on hosted:** 129 commanders have stats, rebuilt from this PC with `cli:hosted aggregate:corpus`. The crawled corpus (`corpus.decks`) holds 666 decks that nothing aggregates yet.
- **EDHREC statistics:** loaded locally only (T035 slice 11, on `develop` since PR #111); not on hosted.
- **Contract version:** v16 on `main`, v17 on `develop`.
- **Search index:** live on the VPS behind the search API, read by Vercel.
- **Auth:** Google sign-in is live locally and on hosted. Email sign-in still runs on Supabase's built-in SMTP, which is not production-grade (T033).

## Releases to main

| Date | PRs | Contract | What shipped |
|---|---|---|---|
| 2026-09-17 | #41 | v5 → v9 | Saved decks, `/decks` and deck pages, reopening in the tool with auto-save; `cards.keywords`; statement-timeout retry and `rec_timeouts`; `cards_rec_pool` index |
| 2026-09-22 | #82, #89, #93, #97 | v9 → v16 | Collection view, deck export, admin tag and sync pages, Archidekt collection links, the search API (#82); deck journey (v11); deck originals (v12); owned first (v13); deckbuilder (v14); collection editing (v15); every search on the index and small grid images (v16); deck crawls (T036) |
| 2026-09-23 | #99, #103 | v16 | Saving a deck whose commander also appears in the main list; deckbuilder layout fixes; remembered deck restored without analyzing; mobile nav menu |
| 2026-09-24 – 27 | #104–#109 | v16 | Crawl preflight (502 instead of silent 202), deleted decks stepped over, `/admin/crawls`, swipe view given the phone screen |

On `develop`, not yet on `main`: #110, the deck-flow audit (stale state and wasted requests across the recommendation flow; `excludeCardIds`, contract v17), and #111, the EDHREC statistics (T035 slice 11).

## Search index (Typesense behind a Go API)

A self-hosted Typesense serves the reads that cost Postgres the most: card documents by id (a swap pool is 220 cards, an add pool 400, a commander page 500), the header search and commander picker, card tags, the proxy's slug check on every card and commander page view, and the card-shaped part of `loadCardCorpus`. Nothing talks to Typesense but `services/search-api`, so the Typesense key never leaves the VPS, and what does leave is a read token and a write token.

Plan: [`typesense-plan.md`](typesense-plan.md). Runbook: [`typesense-ops.md`](typesense-ops.md). Service: [`services/search-api/README.md`](../../services/search-api/README.md).

- **Never a dependency.** Unset `SEARCH_API_URL` and every path takes its Postgres query; configured-but-broken logs and falls back.
- **Recommendation ranking stays in SQL**, so the open blind eval still measures what it was built to measure.
- **Live since 2026-09-23** (two Dokploy stacks, Traefik with TLS). Open under T032: the hosted parity check, the RAM measurement, and confirming the daily drain.
- **Timeouts:** `rec_timeouts` has had nothing new since 2026-09-18, before the index went live. The planned re-read around 2026-09-30 decides whether T008 needs code.

## Deck crawls — Archidekt deployed, Moxfield blocked

A daily Vercel cron calls the search API, which crawls Archidekt's update-ordered feed and writes decklists into the private `corpus` schema. Full account and runbook: [`deck-crawl.md`](deck-crawl.md).

- **Archidekt** is configured on the VPS and writes decks when a run starts: runs on 2026-09-24 and 2026-09-27 wrote 666 decks. **None of those runs came from the daily cron** (none started in its 10:15 UTC hour), so the Vercel trigger is the open problem (T036).
- **Moxfield** is built but seeded disabled: from the VPS, with the app's honest User-Agent, it answered Cloudflare's hard WAF block (403). Per the crawler guardrails a block switches the source off rather than being worked around; the right number of requests to a source that has said no is zero.
- Either source switches itself off on a 403 or a challenge, audited as `crawl.disabled` in `audit_log`; only a human re-enables it.
- The crawl reaches `corpus` only through the `public.crawl_*` security-definer functions, because exposing a schema of third-party decklists is what it exists to avoid.
- Nothing aggregates `corpus.decks` yet; that is T035 slice 2.

## EDHREC statistics (T035 slice 11)

On `develop` since PR #111 (2026-09-28), not yet on `main`. A local script saved every EDHREC commander page; `import:edhrec` loaded ~6,800 commanders' published card counts into `external_commanders` and `external_commander_card_stats`. They are kept apart from our own deck counts because EDHREC aggregates the same Archidekt and Moxfield decks.

The holdout test (`spike:edhrec:prior`) says EDHREC is the better prior for commanders with few decks of our own: with no decks of ours, its top 50 matched the hidden answer 80% of the time against 6% for the colour baseline. Next: release to `main`, load hosted, and wire the prior into scoring.

## Open decisions for the owner

1. Where deck reports go (T003)
2. Whether public deck pages get indexed (T028)
3. Whether "Owned first" supersedes the 2026-09-18 "collection is a hard filter" decision (T037, T007)
4. A domain and custom SMTP before launch (T033)
