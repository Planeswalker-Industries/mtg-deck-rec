# Closed tasks

One sentence each, so the gaps in the numbering have a reason. Ticket ids are never reused. Git history has the full write-ups. Open work is in [`tasks_open.md`](tasks_open.md).

## Shipped without tickets

- **2026-09-22 (contract v11–v16):** deck journey (#84), deck originals (#85), owned first (#86), deckbuilder (#87), collection editing (#92) and every search on the index (#96).
- **2026-10-19 (released in #156):** a collection file picked before hydration is taken (#153), and Cut reaches 100 with a land step and a Low Land Count warning (#155).
- **2026-10-23 (released in #164, contract v29):** a clearer build view for collection decks (#160), refreshed homepage copy (#161) and shareable collections behind the "Public" toggle (#163).

## Tickets

- **T001** Remove local test seed data (2026-09-21): kept, because `seed.sql` refuses to run on a database with other accounts.
- **T002** Configure hosted Supabase Auth (2026-10-20): the dashboard steps are done; the email and kill-switch checks moved to T033.
- **T004** Privacy policy and account deletion (2026-09-21): `/privacy` and `delete_my_account()` shipped.
- **T005** WotC Fan Content Policy disclaimer (2026-09-21): the footer links to the policy.
- **T006** Wire votes into swap scoring (2026-10-20): merged into T014, which runs the eval first.
- **T007** Price as a scoring component (2026-10-07): superseded, because price ranks the buy list and the value fill, never the score.
- **T008** Swap pool caching across serverless instances (2026-10-07): moot, because requests read the precompute tables in one round (T055).
- **T009** Always-on commander request consumer (2026-10-20): merged into T066, since the VPS worker serves lookups.
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
- **T037** Tune the owned-first boost (2026-10-20): moot while the buy list is shelved; T069 keeps the owned-only default and the retune for when it returns.
- **T038** Start a collection by hand (2026-10-12): the empty collection offers adding cards by name.
- **T040** Drop the unused `rec_add_candidates(p_deck_count)` overload (2026-10-07): folded into T067.
- **T042** Make the daily crawl cron produce runs (2026-10-07): a run has started in the cron's hour every day since 2026-10-02.
- **T045** Design the deck analysis display (2026-10-20): Deck stats P1 released in PR #143 and signed off by the owner.
- **T046** Mana base analysis (2026-11-02): Deck stats' Colours group checks coloured sources against Frank Karsten's 2022 tables, with on-curve odds per card and mana by turn (contract v32).
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
- **T069** Scoring UI (2026-11-02): owned cards marked in the image corner where owned and unowned mix, combos as a second part of Add (Collection Ready Combos and priced Combo Upgrades, best result first by `app_config.scoring.combos`, contract v31) with combo pieces protected in Cut and Swap, Build card detail (score and origin), the build's bracket estimate and `build` accept-rate events, and coverage on saved decks; the `emptyReason` copy and Deck stats combos were already live. Hosted serves combos once the owner runs the local Spellbook sync file (collate and precompute output, kept outside the repo). When the buy list returns, the deck tool defaults to owned only and `app_config.ownership.firstBoost` (0.1) is retuned.
- **T070** Derived commander pairs (2026-10-20): released 2026-10-08, 1,056 pairs derived on hosted; the parity check and the cache were moot.
- **T071** Deck stats card types (2026-11-02): six type lines between Curve and Bracket (contract v30); hosted shows them once a full pass writes `commander_stats.type_profile`.
- **T072** Deck stats follow-ups (2026-11-02): sticky sheet handle, footer pointer capture and keyboard toggle, "Pick cuts" in Cut opens the list, "Find …" in Cut counts room after the pending cuts, and a raised bracket clears an over-bracket add; Finish's role comparison was already there (`RoundMoves`, since 2026-10-14).
- **T073** Deck journey UX overhaul follow-ups (2026-10-19): released in PRs #150–#152 (contract v28).
- **T076** Decks that stay under 100 (2026-11-02): collection builds fill to 99 where the collection allows, and Add running out offers Allow Singles, then basic lands for the holes, with a Deck Under 100 check before Cut (PR #170).
- **T080** Google-only sign-in until T033 (2026-11-08): `/sign-in` offers Continue with Google only (released in #187); the emailed-code form is commented out in `sign-in-form.tsx` rather than flagged (owner), and T033 uncomments it.
- **T082** Launch checks (2026-11-08): the owner walked paste → Add → Cut → Swap → Finish → save on a real iPhone and Android phone, and `yarn workspace @mtg/web smoke` runs a read-only Playwright check of production (pages, card images, Google-only sign-in, real 404s, sitemap), failing on any POST beyond the deck tool's signed-out session check.
- **T083** Gwenom journey fixes (2026-11-03): a commander counted once in the saved-deck editor's checks, swap marks read Popular / Rarely played with no price on owned cards, Keep is a button in Swap, too many lands or basics trade one for one in Swap (and in Cut at 100), Finish lists the Deck stats still off, and equal scores in Add and Build break on the staple score (migration `20261103000100`; as a weight it failed the eval both on every card and on unplayed cards only). eval:holdout holds one commander's model at a time. The 101-at-Finish report was not reproduced and is left out.
- **T084** Build a Commander fixes from the Gwen Stacy run (2026-11-04): the build summary on one line ("99 matches", "Bracket 3"), a tapped built card opens as a zoom with Why this card (listing only what counted), every section folds, Continue and Save for Later show they're opening, the build page grades the built deck with Deck stats so Build and Add agree on what is short (contract v33 drops `BuildFeasibility.roleShortfalls`), the Deck stats bar shows its level as an icon over a sheet with its own scroll, and a refresh after Continue offers the deck back with the round's choices.
- **T085** Fix engine (2026-11-11): Deck stats' bands moved out of the builder into `scoring/bands.ts` so the builder and Fix share them, and `journey/fix.ts` pairs one card in with one out until every line is in its band (`nextFixMove`, `planFixes`, `fixLines` with why a line has no move left; not-legal cards and the bracket first, skipped pairs, kept combo pieces and ignored lines honoured); `eval:holdout` reports a repair check (role cards swapped for basic lands, then Fix's plan).
- **T086** Fix on the server (2026-11-12): contract v35 and `POST /api/recs/fix` (its own `fix` request budget) hand the client Fix's pool, every main-deck card by how well it fits and each Deck stats line's best cards to bring in (`fixPool`, 16 a line: at 8 or 12 the pasted Gwen Stacy deck ended at 13/17 or 15/17), read in the round adds make; `RecContext.buyFor` opens a line to unowned cards in Owned only (listed for the line while it is short, never flagged NOT_OWNED, bought by a build once the owned cards run out, brought in by Fix after every owned card); `decks.stat_choices` and `save_deck(p_stat_choices)` keep the player's Ignore or Allow buying per line (migration `20261111000100`), and `gradeDeck` leaves an ignored line out of the score; `collectionGaps` names only lines left short; a collection build takes an owned land under the quality floor when basics alone would leave a colour short or sit over their band, so Fix has no move on a fresh build; `regress` runs Fix with a collection (Gwen Stacy 2.0 as pasted: 24 moves, 6/17 to 16/17; built from the ManaBox export: 17/17, no move). No new SQL for the pool.
