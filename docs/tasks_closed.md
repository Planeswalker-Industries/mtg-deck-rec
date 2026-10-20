# Closed tasks

One sentence each, so the gaps in the numbering have a reason. Ticket ids are never reused. Git history has the full write-ups. Open work is in [`tasks_open.md`](tasks_open.md).

## Shipped without tickets

- **2026-09-22 (contract v11–v16):** deck journey (#84), deck originals (#85), owned first (#86), deckbuilder (#87), collection editing (#92) and every search on the index (#96).
- **2026-10-19 (released in #156):** a collection file picked before hydration is taken (#153), and Cut reaches 100 with a land step and a Low Land Count warning (#155).

## Tickets

- **T001** Remove local test seed data (2026-09-21): kept, because `seed.sql` refuses to run on a database with other accounts.
- **T004** Privacy policy and account deletion (2026-09-21): `/privacy` and `delete_my_account()` shipped.
- **T005** WotC Fan Content Policy disclaimer (2026-09-21): the footer links to the policy.
- **T007** Price as a scoring component (2026-10-07): superseded, because price ranks the buy list and the value fill, never the score.
- **T008** Swap pool caching across serverless instances (2026-10-07): moot, because requests read the precompute tables in one round (T055).
- **T010** Archidekt always-on crawler (2026-09-28): replaced by the daily crawl (T036).
- **T011** Monitor database growth (2026-09-21): hosted moved to Supabase Pro (8 GB).
- **T012** Parser test fixtures (2026-09-18): 63 parser tests.
- **T016** Deck export (2026-09-21): copy, text and CSV downloads on deck pages.
- **T019** Admin pages (2026-09-21): `/admin/tags` and `/admin/sync-runs` shipped.
- **T020** Deck-internal synergy scoring (2026-10-07): built as T064.
- **T023** `collections.maxEntries` limit review (2026-09-21): 100,000 stays on Pro.
- **T024** Invalidate the swap pool cache after corpus rebuilds (2026-09-18): already wired through `TAGS_BY_JOB`.
- **T025** Google sign-in credentials (2026-09-23): live locally and on hosted.
- **T026** Collection import from a share link (2026-09-21): shipped for Archidekt, the only source that publishes a usable link.
- **T031** Compare our synergy against EDHREC's (2026-10-07): `eval:holdout` reports EDHREC agreement on every run.
- **T035** Deck aggregation pipeline and card graph (2026-10-07): shipped as T053–T065 in PR #140.
- **T036** Deck crawls (2026-09-28): the crawl engine and the Archidekt source deployed.
- **T038** Start a collection by hand (2026-10-12): the empty collection offers adding cards by name.
- **T040** Drop the unused `rec_add_candidates(p_deck_count)` overload (2026-10-07): folded into T067.
- **T042** Make the daily crawl cron produce runs (2026-10-07): a run has started in the cron's hour every day since 2026-10-02.
- **T045** Design the deck analysis display (2026-10-20): Deck stats P1 released in PR #143 and signed off by the owner.
- **T047** Combo detection in the bracket estimate (2026-10-07): built as T060.
- **T048** Role counts against the commander's decks (2026-10-20): delivered by Deck stats P1.
- **T050** Start a deck from one commander (2026-10-12): `/deck?start=build` picks a commander and builds a deck for it.
- **T052** Release the deckbuilder redesign (2026-10-07): released 2026-09-30.
- **T053** Data layers (2026-10-07): released 2026-10-05.
- **T054** Collator (2026-10-07): released, and hosted was collated and aggregated on 2026-10-06.
- **T055** Precompute worker and the serving request path (2026-10-07): production reads the precompute tables.
- **T056** Crawl growth (2026-10-07): 23 commanders past 93 decks, and 4,449 declared brackets stored on hosted.
- **T057** Scoring weights into `app_config.scoring` (2026-10-07): released in PR #140 with unchanged outputs.
- **T058** Offline evaluation (2026-10-07): `eval:holdout` and its gate released.
- **T059** Collection mode (2026-10-07): data, scoring and contract v20 released.
- **T060** Bracket rules and combos (2026-10-07): released with contract v21.
- **T061** EDHREC prior by sample size (2026-10-07): on in production, raising adds recall@20 from 17.2% to 25.0%.
- **T062** Learned skeleton (2026-10-07): builds use learned curve and land counts.
- **T063** Build a deck from a commander and a bracket (2026-10-07): `POST /api/recs/build` live with contract v24.
- **T064** Deck affinity from card pairs (2026-10-07): card pairs built on hosted, and `deck` weighs 0.1 in adds.
- **T065** Live accept rate (2026-10-07): `rec_events` live, written by the server only.
- **T073** Deck journey UX overhaul follow-ups (2026-10-19): released in PRs #150–#152 (contract v28).
