# Open tasks

Open work, grouped by area. Each ticket holds what it takes to finish it; history is in git, and closed tickets are one line each in [`tasks_closed.md`](tasks_closed.md). Ids are never reused. The next new id is T076.

State on **2026-10-20**: `main` at PR #156, contract v28, hosted migrations at `20261014000100` (`20261020000100` waits for the next release).

## UI order

Owner, 2026-10-08, most important first:

1. **T071** Deck stats card types, then **T072** follow-ups.
2. **T069** collection mode: conflict tags, "stands in for", the swap's `emptyReason`, the built control.
3. **T069** combos and bracket signals, in Deck stats.
4. **T046** Mana base analysis.
5. **T039, T034:** performance, when measurements call for it.
6. **T049** Re-record the How it works clips, once the screens above settle.

---

## Pre-launch gates

### T033: Custom domain and SMTP

**HIGH** · DevOps / Auth · Absorbs T002, whose dashboard steps are done

Supabase's built-in SMTP sends a couple of emails an hour, so email-code sign-in can't be relied on; Google sign-in covers the owner meanwhile. Moxfield's whitelist also wants a production domain (T044).

1. Point a domain at the app. Move the URL settings to it: Supabase Site URL and redirect allow list, Vercel `NEXT_PUBLIC_SITE_URL`, the Google OAuth client's redirect URIs.
2. Resend (free tier) or equivalent: verify the sending domain, set it in Supabase → Authentication → SMTP, and raise Rate Limits → emails per hour.

- [ ] Sign-in emails arrive at a production rate on the domain
- [ ] The share-link kill switch activates on 403/409 on hosted (`scripts/share-kill-switch-check.ts` covers it locally)

### T028: Index public deck pages

**MEDIUM** · Product / SEO · Decided (owner, 2026-10-20): public decks are indexed, behind a name filter

Deck pages are `noindex` today (`robots` in `apps/web/src/app/decks/[commander]/[code]/page.tsx`) because deck names are user-written. Only public decks can be indexed: `loadDeckPage` returns null for missing and not-permitted decks alike, and `proxy.ts` 404s both.

- [ ] A name filter: a deck whose name fails it stays `noindex` and out of the sitemap
- [ ] Other public decks drop `noindex` and join `apps/web/src/app/sitemap.ts`, addressed by commander and deck code (owner's example: `liesa-forgotten-archangel-iJQ2zHq`; confirm with the owner whether that one slug replaces today's two segments)
- [ ] The sitemap's deck list stays off build-time queries that grow with the catalog

---

## Data pipeline and ops

### T066: Deploy the VPS worker

**HIGH** · Worker / Ops · Released 2026-10-07, not deployed (hosted's `worker_status` heartbeat last moved 2026-09-16) · Absorbs T009

The container (`deploy/worker/`, `deploy/dokploy/worker.yml`, `cli serve`) runs on the `app_config.worker` schedule: deck lookups (a requested commander goes first in the crawl's queue, and the worker starts a crawl run when none is going), each source's daily crawl, `collate` with the precompute passes, the nightly baseline and `sync:edhrec`. Verified locally 2026-10-05.

- [ ] Deployed with `DATABASE_URL` (session pooler), the search API tokens, `WEB_APP_URL` and `REVALIDATE_SECRET`, plus a container memory limit and a Node heap flag before the first weekly global pair count
- [ ] Hosted `commander_requests` are consumed (2 queued since 2026-09-28) and the deck tool sees the heartbeat
- [ ] After two days of worker-triggered crawls, remove the Vercel cron (`apps/web/vercel.json`, `/api/cron/*-scrape`)

### T074: Archidekt answers the daily crawl with 429s

**HIGH** · Data / Ops · Slower pace in migration `20261020000100` (owner, 2026-10-20), not released

Five of the six daily runs from 2026-10-15 (`crawl.runs` 22–27) failed on a 429 that the fetcher's backoff (doubling up to `requestIntervalMaxMs`, 8 s, in `services/search-api/internal/crawl/fetcher.go`) did not outlast. The migration sets `app_config.archidekt.requestIntervalMs` 1000 → 2000.

- [ ] The migration on hosted (release, then `db-push.yml` if the integration doesn't apply it)
- [ ] Three daily runs in a row without a 429 failure; if they still fail, switch the source off and ask Archidekt's staff what rate they want
- [ ] Run 20 (2026-10-13, still `running`) closed as failed, and a redeploy that kills a run leaves it marked failed

### T068: Pipeline follow-ups (PR #139 review)

**HIGH** · Data / Ops

Running in production:
- [ ] The worker deployed (T066). Hosted has one hand-run collation (2026-10-06: `corpus.decks` 79,759 against 224,407 in `archidekt.decks` by 2026-10-20); the last precompute pass ran 2026-10-08
- [ ] Spellbook: set the repository variable `SPELLBOOK_SYNC_ENABLED`, then `collate --only spellbook` and `precompute --part combos` (hosted's combo tables are empty, so combo features answer nothing)
- [ ] A first hosted `sync:edhrec` (raw `edhrec.*` is empty), then the evaluation on the time split with `--snapshot-month` set to it
- [ ] Estimator agreement with declared brackets in `eval:holdout`'s report (4,449 declared on hosted)
- [ ] Every substitutes list recomputed once (its hash changed; the stored lists are already right): the worker's slices, or an off-peak `cli:hosted precompute --part substitutes` (about 90 minutes)

Latency (2026-10-07: adds 212/243 → 306/400 ms at p50/p95; card pairs cost most, `serving_deck_affinity` 174 ms and 253 KB for an add):
- [ ] Skip the card-pairs read for cuts while `affinity.lowAffinityCuts` is off, and for swaps while their `deck` weight is 0
- [ ] Skip `serving_commander_profile` while `skeleton.edhrecPrior` is off
- [ ] Send an add only the pairs that point at its pool and neighbours, each card's row once; or cache each card's corpus pairs for days

Storage (8 GB disk):
- [ ] `card_substitutes` is 1.15 GB (15.7M rows): one row per card with id and similarity arrays is about a tenth, and the depth (220) no longer binds
- [ ] `rec_events` retention: the owner picks a period, `/privacy` says it, a worker job purges
- [ ] The global pair count peaks at about 1.1 GB locally and grows with the corpus: count in row blocks with a bounded top list per card, or raise `globalMinDecks`

### T067: Drop the retired rec functions

**MEDIUM** · Database · Blocked by: the owner no longer wanting a rollback to the build before PR #140

A migration drops `rec_add_candidates` (both overloads), `rec_swap_candidates`, `rec_card_roles`, `log_rec_timeout`, `rec_timeouts` and the `app_config.recs` row, and `supabase/tests/serving.sql` checks they're gone.

### T032: Search index checks

**HIGH** · Infrastructure · Live since 2026-09-23; runbook in `deploy/README.md`

- [ ] `apps/web/scripts/search-parity-check.ts` passes against hosted data (`commanders` and `commander_cards` have never run with real rows)
- [ ] RAM after the first build (`/metrics.json`) recorded in the runbook

### T043: A crawl database role that is not `service_role`

**MEDIUM** · Security

The search API on the VPS holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS everywhere (`auth` included), in the process that serves public endpoints.

- [ ] A Postgres role with execute on the `crawl_*` functions only (`20260922000300_deck_crawl_corpus.sql`), and a JWT minted for it (Supabase's secret keys all map to `service_role`) replacing the key (`services/search-api/internal/config/config.go`)
- [ ] `TestLiveStoreRoundTrip` passes with the role, and a direct table read with it is refused
- [ ] The secrets table in `deploy/README.md` updated

### T030: Invalid commander-pair keys

**LOW** · Data

Some `commander_keys` rows pair cards that aren't legal partners (companions, misfiled cards). Collation drops their decks (`isValidPartnerPair`), so those keys render empty commander pages.

- [ ] Find the keys that aren't a legal pair and have no `commander_stats` row; delete them, or mark them missing for pages and `proxy.ts`, writing only those rows
- [ ] `aggregate:corpus` (`apps/worker/src/jobs/aggregate-corpus.ts`) stops creating them

### T041: Reclaim dead space on hosted

**LOW** · Database

`vacuum full` on `printings` (166 MB against 56 MB locally) and `search_index_queue` (199 MB with no rows), run by the owner as superuser at a quiet time, since it locks the table. Record the sizes before and after here (database 3,305 MB on 2026-10-20).

### T044: Moxfield crawl access

**LOW** · Data · Blocked on Moxfield

The adapter (`services/search-api/internal/moxfield/`) is built and seeded disabled after Cloudflare's 403 from the VPS (2026-09-22). A block is obeyed, not worked around; the whitelist wants a production domain (T033).

- [ ] Moxfield grants a path, a VPS probe returns 2xx, the parsers are pinned to live fixtures, and `disabled` is cleared

---

## Product and UI

### T071: Deck stats card types

**MEDIUM** · Database / Worker / Frontend · Option A approved (owner, 2026-10-08)

Add Creatures, Instants, Sorceries, Artifacts, Enchantments and Planeswalkers to Deck stats (`ok/total` 8 → 14): one `type_profile` jsonb column on `commander_stats`, written by the per-commander pass beside `curve_profile` (`apps/worker/src/lib/key-stats.ts`), with typical types from `typical_deck_profile()`. No new table or job.

- [ ] Migration: the column, and `typical_deck_profile()` returning types; written diff-only and filled on hosted by a full pass
- [ ] Type targets on `StatTargets` (`stat-targets.ts`, contract bump) and counts in `deck-tally.ts`: front face only, an artifact creature counted as a creature as Add groups it
- [ ] A Types group between Curve and Bracket in `deck-stats-panel.tsx`
- [ ] A SQL check in `serving.sql`, tally tests extended, screens re-checked at 390×844

### T072: Deck stats follow-ups

**LOW** · Frontend

- [ ] Zero-deck label (owner, 2026-10-20): when every deck behind the targets is borrowed (own count 0), `stat-targets.ts` reads "First Tymna & Thrasios deck we've seen", with a (?) saying "Targets come from each partner's other decks. Be the first to build it!" "Estimated" stays on the bracket row
- [ ] Finish (`review-phase.tsx`) compares role counts before and after
- [ ] Polish, each fixed or struck with a reason: the sheet's handle scrolls away (make it sticky); the footer has no pointer capture (`deck-stats-footer.tsx`); after a touch swipe the next Enter on the footer is swallowed once; "Pick cuts" does nothing while in Cut (`deck-tool.tsx` `statAction`); "Find …" in Cut counts slots open now, not after the pending cuts; an add that completed an over-bracket combo stays flagged after the bracket is raised (`use-deck-journey.ts` `overBracketIds`)

### T069: Scoring UI

**MEDIUM** · Frontend · Shelved during the data sprint (owner, 2026-10-06); the data, scoring and contract are live

- [ ] Collection mode (T059): release the built control and whole-deck coverage; per-suggestion ownership labels; builder and saved-page coverage
- [ ] Swap with nothing owned: show `SwapResult.emptyReason` (`NOTHING_OWNED_FITS`, `NO_TAGS_ON_TARGET`, `NO_CANDIDATES`) in place of "No replacements do the same job"
- [ ] Combos and bracket (T060), in Deck stats: the "complete a combo" group, `completesOverBracket`, `DeckAnalysis.combos`, `bracketSignals`; credit and link Commander Spellbook wherever combos show
- [ ] Build mode (T063): each card's score and origin, "complete a combo" entries, the build's bracket estimate, saving a build directly, accept-rate events as mode `build` (T065)
- [ ] Each checked at 390×844 within the swipe budget

The buy list and value fill are shelved (owner, 2026-10-12). When the buy list returns, the deck tool defaults to owned only, and `app_config.ownership.firstBoost` (0.1) is retuned then (closed T037).

### T046: Mana base analysis

**MEDIUM** · Core / Frontend · Placement: Deck stats

Can the lands cast the spells: coloured sources against Frank Karsten's thresholds for each card's pips and turn, the cards least likely to be cast on curve (worst first), and a plain "N sources short on black". Deterministic, no AI. `cards.produced_mana` is stored (T073; 2,711 cards on hosted) but not sent to the client.

- [ ] A contract field (or lookup) carrying it, with a version bump
- [ ] Source-count analysis beside `packages/core/src/journey/deck-stats.ts`, tested for hybrid and Phyrexian pips, MDFC lands and commander pips; the thresholds as a constants module that names its source
- [ ] Shown in Deck stats, labelled as an estimate
- [ ] Ask the owner whether Add should use the shortfall (a separate ticket if so)

Sanity check, not ground truth: EDHcheck on the sample Liesa deck reaches 3 mana by T3 50%, T4 80%, T6 95%, wants 8 more black sources for Damn and puts Avacyn at 34.7% on curve; don't copy its advice text. A Monte Carlo goldfish (in a Web Worker) only if Deck stats needs it.

### T049: Re-record the How it works clips

**LOW** · Content · Owner

The clips (`apps/web/public/add.png`, `cut_gif*.gif`, `swipe_gif*.gif`) show the old UI and step order; the steps are now Add, Cut, Swap and Finish, in the blue palette.

- [ ] Add, Cut and Swap, one clip each at one pixel size (`StepMedia` in `components/home/how-it-works.tsx`), each with a `_hi` version for 1024 px and up; check the file sizes

### T003: Deck report link destination

**LOW** · Shelved until the public release (owner, 2026-10-19); don't raise it before then

The Report link on deck pages (`apps/web/src/app/decks/[commander]/[code]/page.tsx`) opens a prefilled GitHub issue. Pick a real destination and update the link.

---

## Scoring and quality

### T014: Swap votes: blind eval, then scoring

**MEDIUM** · Quality / Scoring · Absorbs T006

The `/rate` rater deals a card's top 6 replacements shuffled, our ranking hidden; votes land in `swap_votes` with their `VoteContext`. Nothing reads them: `rankSwaps` (`packages/core/src/scoring/rank.ts`) passes `votes: null` and `voteCount: 0`, though `app_config.scoring.weights.swap` gives votes 0.1.

- [ ] Recruit 2 raters, run 50 cases × 5 commanders, and record precision@5 and MRR here
- [ ] Then read vote counts per (target, replacement) into `rankSwaps` (`apps/web/src/lib/server/votes.ts` through `recs.ts`), check the ramp in `swap.ts` against the real votes, extend `scoring.test.ts`, and pass `eval:holdout`

### T075: Evaluation gate fixes

**LOW** · Scoring · From PR #139's review (2026-10-07). Every scoring change must pass the gate, so these come before the next one

- [ ] The gate judges each bucket against the baseline's own interval, so a real drop in a small bucket can pass; judge it on the paired difference
- [ ] Cuts rank by the hand-weighted cut score, not m(c | D − c): move them and gate it (cut precision@10), or record that cuts keep `scoreCuts`
- [ ] The holdout hash (FNV-1a over sequential ids) clusters the split; every deck is ranked as bracket 3; cut precision counts only planted cards; collection recall and the buy list aren't gated; nothing checks the TypeScript copy of the precompute arithmetic against the stored tables
- [ ] The global pair lift barely shrinks rare cards (a third of kept pairs have under 10 decks) and isn't release-aware: fix it or record why
- [ ] Owned twins: copies a built deck holds are matched per card, not pooled across the twin group (`availability.ts`)
- [ ] The per-key pair pass picks keys by `commander_stats.computed_at`; drive it from the keys the commander pass merged

---

## Performance and tests

### T039: Take votes off the Server Action queue

**LOW** · Frontend / Performance

Server Actions run one at a time per page, so every swipe's `castVote` and the 2 s `getCommanderRequest` poll delay Finish's Save.

- [ ] `POST /api/votes` with the `vote` rate-limit bucket and `castVoteInputSchema`, after `apps/web/src/lib/server/recs-route.ts`; `realActions.castVote` calls it (the contract doesn't change)
- [ ] Decide whether the lookup poll moves too
- [ ] Measure Finish's Save after a fast Swap sitting, before and after

### T034: Lazy rendering for large collections

**LOW** · Frontend / Performance · Tabled (owner, 2026-09-21) until real collections grow

`/collection` renders every card in every open group (`collection-view.tsx`, `pocket-grid.tsx`): 729 cards load in about 0.6 s.

- [ ] Measure a synthetic 10,000-card collection: load, a search keystroke, a colour toggle
- [ ] `content-visibility: auto` per group first; "Show N more" past about 100 cards a group if needed; virtualise only if that fails. Counts stay exact, collapsing works, `e2e/collection.spec.ts` passes

### T027: 10k-row collection import timing

**LOW** · Performance · The 1,000-row path was fixed 2026-09-20

- [ ] Re-run a 1,000-row import on hosted
- [ ] Time a 10,000-row import end to end locally, extending `apps/web/scripts/collection-resolve-check.ts`: per-batch resolve and commit times, no statement timeout, a responsive browser. Record the numbers beside `app_config.collections`

### T015: SQL tests for collection imports

**LOW** · Testing · Model: `supabase/tests/saved-decks.sql`

- [ ] An owner reads and deletes only their own collection rows
- [ ] `start_collection_import`, `save_collection_rows`, `commit_collection_import` (merge and replace)
- [ ] The limits `maxImportRows`, `maxEntries`, `maxOpenImports`

### T051: Local e2e failures with real data

**LOW** · Testing

- [ ] `analyzeDeck` in `deck-journey.spec.ts` waits for the recommendations or the lookup sheet before dismissing (Chulane has no local corpus, so the sheet opens late and blocks the page)
- [ ] The specs pass with `E2E_LOCAL_DATA=1` and in CI

---

## Later

One line each; write a full ticket when one starts.

- **T013** k6 load tests for swap, add and cut: p95 uncached swap under 800 ms, add and cut under 1 s at 50 rps.
- **T017** Favorite cards or decks for quick access.
- **T018** Precon import, after checking that MTGJSON's license allows it.
- **T021** Retune `app_config.corpus.partnerPoolWeight` (0.25, set on 4 pairs) when more pair data exists, through `eval:holdout`.
- **T022** Play rate lifts weak tag matches (Reliquary Tower tops Sea Gate Restoration's swaps at a 0.65 tag score): try a tag floor or play-rate dampening against the regression fixtures.
