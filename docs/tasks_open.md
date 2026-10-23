# Open tasks

Open work in priority order, most important first. Each ticket holds what it takes to finish it; history is in git, and closed tickets are one line each in [`tasks_closed.md`](tasks_closed.md). Ids are never reused. The next new id is T083.

Everything above T033 comes before the soft launch to a playgroup (owner, 2026-10-23); the rest comes after.

State on **2026-10-23**: `main` at PR #164, contract v29, hosted migrations at `20261022000100` (current). Hosted `corpus.decks` 212,606, last collated and precomputed by hand 2026-10-21.

---

## T066: Deploy the VPS worker

**HIGH** · Worker / Ops · Released 2026-10-07, not deployed (hosted's `worker_status` heartbeat last moved 2026-09-16) · Absorbs T009

The container (`deploy/worker/`, `deploy/dokploy/worker.yml`, `cli serve`) runs on the `app_config.worker` schedule: deck lookups (a requested commander goes first in the crawl's queue, and the worker starts a crawl run when none is going), each source's daily crawl, `collate` (decks, Spellbook and EDHREC) with the precompute passes, the nightly baseline and a weekly `sync:edhrec`. Verified locally 2026-10-05. Without it the deck tool's commander lookup promises a wait that never ends (2 hosted `commander_requests` queued since 2026-09-19 and 2026-09-28), and every hosted refresh is a hand run.

- [ ] Claude writes the deploy checklist; the owner deploys on Dokploy with `DATABASE_URL` (session pooler), the search API tokens, `WEB_APP_URL` and `REVALIDATE_SECRET`, a container memory limit (about 2 GB; the VPS has 8 GB or more) and a Node heap flag before the first weekly global pair count
- [ ] Hosted `commander_requests` are consumed and the deck tool sees the heartbeat
- [ ] The worker's passes fill what hand runs would: Spellbook combos (`SPELLBOOK_SYNC_ENABLED` set 2026-10-23, so the daily sync loads `spellbook.*`), a first `sync:edhrec` (raw `edhrec.*` is empty), and every substitutes list recomputed once (its hash changed; the stored lists are already right)
- [ ] After two days of worker-triggered crawls, remove the Vercel cron (`apps/web/vercel.json`, `/api/cron/*-scrape`)

## T074: Archidekt answers the daily crawl with 429s

**HIGH** · Data / Ops · Slower pace (`requestIntervalMs` 1000 → 2000) on hosted since migration `20261020000100`

Runs 22–28 (2026-10-15 to 2026-10-21) failed on 429s, except run 25, that the fetcher's backoff (doubling up to `requestIntervalMaxMs`, 8 s, in `services/search-api/internal/crawl/fetcher.go`) did not outlast.

- [ ] Run 29 (2026-10-22, the first at the slower pace) reads `running` with a `finished_at`, and run 30 sits `queued`: find why, and close stale runs as failed
- [ ] Three daily runs in a row without a 429 failure; if they still fail, switch the source off and ask Archidekt's staff what rate they want
- [ ] Run 20 (2026-10-13, still `running`) closed as failed, and a redeploy that kills a run leaves it marked failed

## T071: Deck stats card types

**MEDIUM** · Database / Worker / Frontend · Option A approved (owner, 2026-10-08)

Add Creatures, Instants, Sorceries, Artifacts, Enchantments and Planeswalkers to Deck stats (`ok/total` 8 → 14): one `type_profile` jsonb column on `commander_stats`, written by the per-commander pass beside `curve_profile` (`apps/worker/src/lib/key-stats.ts`), with typical types from `typical_deck_profile()`. No new table or job.

- [ ] Migration: the column, and `typical_deck_profile()` returning types; written diff-only and filled on hosted by a full pass (the worker's, once T066 is up)
- [ ] Type targets on `StatTargets` (`stat-targets.ts`, contract bump) and counts in `deck-tally.ts`: front face only, an artifact creature counted as a creature as Add groups it
- [ ] A Types group between Curve and Bracket in `deck-stats-panel.tsx`
- [ ] A SQL check in `serving.sql`, tally tests extended, screens re-checked at 390×844

## T072: Deck stats follow-ups

**MEDIUM** · Frontend

- [ ] Finish (`review-phase.tsx`) compares role counts before and after
- [ ] Polish, each fixed or struck with a reason: the sheet's handle scrolls away (make it sticky); the footer has no pointer capture (`deck-stats-footer.tsx`); after a touch swipe the next Enter on the footer is swallowed once; "Pick cuts" does nothing while in Cut (`deck-tool.tsx` `statAction`); "Find …" in Cut counts slots open now, not after the pending cuts; an add that completed an over-bracket combo stays flagged after the bracket is raised (`use-deck-journey.ts` `overBracketIds`)

## T076: Decks that stay under 100

**HIGH** · Frontend / Scoring · Owner, 2026-10-23

A build from a commander, most often from a collection, can stop short of 99 cards; Add can then run out ("no cards left to recommend") with the deck still short, and the player can move on to Cut while under 100, where there is nothing to cut. A start (Add hides "Done adding" and the next bar until the deck is over 100, with the e2e step updated) sits uncommitted on the owner's machine.

- [ ] Find why the build stops short (pool size, `serving_limits` clamps, colour or role caps) and fill to 99 where the pool allows
- [ ] When Add runs out under 100: first offer unowned singles to finish the deck; if the player declines, widen the owned pool; if still short, a warning in as few words as possible (icon and label) offering high-impact singles or basic lands for the holes
- [ ] Leaving Add for Cut under 100 asks to continue, saying the deck is under 100
- [ ] e2e covers a short collection build, and the swipe buttons still fit at 390×844

## T069: Scoring UI

**MEDIUM** · Frontend · The data, scoring and contract are live

- [ ] Collection mode (T059): release the built control and whole-deck coverage; per-suggestion ownership labels; builder and saved-page coverage
- [ ] Swap with nothing owned: show `SwapResult.emptyReason` (`NOTHING_OWNED_FITS`, `NO_TAGS_ON_TARGET`, `NO_CANDIDATES`) in place of "No replacements do the same job"
- [ ] Combos and bracket (T060), in Deck stats, once hosted has combos (T066): the "complete a combo" group, `completesOverBracket`, `DeckAnalysis.combos`, `bracketSignals`; credit and link Commander Spellbook wherever combos show
- [ ] Build mode (T063): each card's score and origin, "complete a combo" entries, the build's bracket estimate, saving a build directly, accept-rate events as mode `build` (T065)
- [ ] Each checked at 390×844 within the swipe budget

The buy list and value fill are shelved (owner, 2026-10-12). When the buy list returns, the deck tool defaults to owned only, and `app_config.ownership.firstBoost` (0.1) is retuned then (closed T037).

## T046: Mana base analysis

**MEDIUM** · Core / Frontend · Placement: Deck stats · Display only; steering Add is T078

Can the lands cast the spells: coloured sources against Frank Karsten's thresholds for each card's pips and turn, the cards least likely to be cast on curve (worst first), and a plain "N sources short on black". Deterministic, no AI. `cards.produced_mana` is stored (T073; 2,711 cards on hosted) but not sent to the client.

- [ ] A contract field (or lookup) carrying it, with a version bump
- [ ] Source-count analysis beside `packages/core/src/journey/deck-stats.ts`, tested for hybrid and Phyrexian pips, MDFC lands and commander pips; the thresholds as a constants module that names its source
- [ ] Shown in Deck stats, labelled as an estimate

Sanity check, not ground truth: EDHcheck on the sample Liesa deck reaches 3 mana by T3 50%, T4 80%, T6 95%, wants 8 more black sources for Damn and puts Avacyn at 34.7% on curve; don't copy its advice text. A Monte Carlo goldfish (in a Web Worker) only if Deck stats needs it.

## T077: Feedback reports

**MEDIUM** · Database / Frontend · Owner, 2026-10-23 · Replaces the GitHub Report link until T003

- [ ] A reports table written through a security-definer function keyed on `auth.uid()` (signed-in only), validated by a zod schema, rate-limited in `app_config.rate_limits`; it stores the message, the page URL and the time
- [ ] "Send feedback" in the site footer or menu, and on deck pages in place of today's Report link (`apps/web/src/app/decks/[commander]/[code]/page.tsx`)
- [ ] An admin list beside `/admin/crawls` (`noindex`, `no-store`): newest first, mark resolved, filter to open; platform admins see an open-report count badge in the header
- [ ] `/privacy` says what a report stores and who reads it

## T080: Google-only sign-in until T033

**MEDIUM** · Auth · Owner, 2026-10-23

Supabase's built-in SMTP sends a couple of emails an hour, so an emailed code may never arrive.

- [ ] `/sign-in` offers Google only, with the email code behind a flag that T033 turns back on

## T068: Recommendation latency (PR #139 review)

**MEDIUM** · Backend / Performance

2026-10-07: adds 212/243 → 306/400 ms at p50/p95; card pairs cost most, `serving_deck_affinity` 174 ms and 253 KB for an add.

- [ ] Skip the card-pairs read for cuts while `affinity.lowAffinityCuts` is off, and for swaps while their `deck` weight is 0
- [ ] Skip `serving_commander_profile` while `skeleton.edhrecPrior` is off
- [ ] Send an add only the pairs that point at its pool and neighbours, each card's row once; or cache each card's corpus pairs for days

## T067: Drop the retired rec functions

**LOW** · Database · Unblocked: no rollback to the build before PR #140 is wanted (owner, 2026-10-23)

A migration drops `rec_add_candidates` (both overloads), `rec_swap_candidates`, `rec_card_roles`, `log_rec_timeout`, `rec_timeouts` and the `app_config.recs` row, and `supabase/tests/serving.sql` checks they're gone.

## T051: Local e2e failures with real data

**LOW** · Testing

- [ ] `analyzeDeck` in `deck-journey.spec.ts` waits for the recommendations or the lookup sheet before dismissing (Chulane has no local corpus, so the sheet opens late and blocks the page)
- [ ] The specs pass with `E2E_LOCAL_DATA=1` and in CI

## T082: Launch checks

**HIGH** · QA · Last before inviting anyone

- [ ] The owner walks paste → Add → Cut → Swap → Finish → save on a real iPhone (Safari) and Android phone
- [ ] A scripted, read-only smoke run against production (no sign-in, no writes)

---

## T033: Custom domain and SMTP

**HIGH** · DevOps / Auth · Absorbs T002, whose dashboard steps are done · No domain bought yet

Moxfield's whitelist also wants a production domain (T044).

1. Point a domain at the app. Move the URL settings to it: Supabase Site URL and redirect allow list, Vercel `NEXT_PUBLIC_SITE_URL`, the Google OAuth client's redirect URIs.
2. Resend (free tier) or equivalent: verify the sending domain, set it in Supabase → Authentication → SMTP, and raise Rate Limits → emails per hour.

- [ ] Sign-in emails arrive at a production rate on the domain, and the email code is back on `/sign-in` (T080)
- [ ] The share-link kill switch activates on 403/409 on hosted (`scripts/share-kill-switch-check.ts` covers it locally)

## T043: A crawl database role that is not `service_role`

**MEDIUM** · Security

The search API on the VPS holds `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS everywhere (`auth` included), in the process that serves public endpoints.

- [ ] A Postgres role with execute on the `crawl_*` functions only (`20260922000300_deck_crawl_corpus.sql`), and a JWT minted for it (Supabase's secret keys all map to `service_role`) replacing the key (`services/search-api/internal/config/config.go`)
- [ ] `TestLiveStoreRoundTrip` passes with the role, and a direct table read with it is refused
- [ ] The secrets table in `deploy/README.md` updated

## T028: Index public deck pages

**MEDIUM** · Product / SEO · Decided (owner, 2026-10-20): public decks are indexed, behind a name filter

Deck pages are `noindex` today (`robots` in `apps/web/src/app/decks/[commander]/[code]/page.tsx`) because deck names are user-written. Only public decks can be indexed: `loadDeckPage` returns null for missing and not-permitted decks alike, and `proxy.ts` 404s both.

- [ ] A name filter: a deck whose name fails it stays `noindex` and out of the sitemap
- [ ] Other public decks drop `noindex` and join `apps/web/src/app/sitemap.ts`, at today's `/decks/[commander]/[code]` URLs (owner, 2026-10-20)
- [ ] The sitemap's deck list stays off build-time queries that grow with the catalog

## T032: Search index checks

**MEDIUM** · Infrastructure · Live since 2026-09-23; runbook in `deploy/README.md`

- [ ] `apps/web/scripts/search-parity-check.ts` passes against hosted data (`commanders` and `commander_cards` have never run with real rows)
- [ ] RAM after the first build (`/metrics.json`) recorded in the runbook

## T081: Pipeline storage and evaluation (PR #139 review)

**MEDIUM** · Data / Ops · Split from T068

Evaluation:
- [ ] Once EDHREC is on hosted (T066), the evaluation on the time split with `--snapshot-month` set to it
- [ ] Estimator agreement with declared brackets in `eval:holdout`'s report (4,449 declared on hosted)

Storage (8 GB disk):
- [ ] `card_substitutes` is 1.15 GB (15.7M rows): one row per card with id and similarity arrays is about a tenth, and the depth (220) no longer binds
- [ ] `rec_events` retention: the owner picks a period, `/privacy` says it, a worker job purges
- [ ] The global pair count peaks at about 1.1 GB locally and grows with the corpus: count in row blocks with a bounded top list per card, or raise `globalMinDecks`

## T075: Evaluation gate fixes

**LOW** · Scoring · From PR #139's review (2026-10-07). Every scoring change must pass the gate, so these come before the next one

- [ ] The gate judges each bucket against the baseline's own interval, so a real drop in a small bucket can pass; judge it on the paired difference
- [ ] Cuts rank by the hand-weighted cut score, not m(c | D − c): move them and gate it (cut precision@10), or record that cuts keep `scoreCuts`
- [ ] The holdout hash (FNV-1a over sequential ids) clusters the split; every deck is ranked as bracket 3; cut precision counts only planted cards; collection recall and the buy list aren't gated; nothing checks the TypeScript copy of the precompute arithmetic against the stored tables
- [ ] The global pair lift barely shrinks rare cards (a third of kept pairs have under 10 decks) and isn't release-aware: fix it or record why
- [ ] Owned twins: copies a built deck holds are matched per card, not pooled across the twin group (`availability.ts`)
- [ ] The per-key pair pass picks keys by `commander_stats.computed_at`; drive it from the keys the commander pass merged

## T014: Swap votes: blind eval, then scoring

**MEDIUM** · Quality / Scoring · Absorbs T006

The `/rate` rater deals a card's top 6 replacements shuffled, our ranking hidden; votes land in `swap_votes` with their `VoteContext`. Nothing reads them: `rankSwaps` (`packages/core/src/scoring/rank.ts`) passes `votes: null` and `voteCount: 0`, though `app_config.scoring.weights.swap` gives votes 0.1.

- [ ] Recruit 2 raters, run 50 cases × 5 commanders, and record precision@5 and MRR here
- [ ] Then read vote counts per (target, replacement) into `rankSwaps` (`apps/web/src/lib/server/votes.ts` through `recs.ts`), check the ramp in `swap.ts` against the real votes, extend `scoring.test.ts`, and pass `eval:holdout`

## T049: Re-record the How it works clips

**LOW** · Content · Owner

The clips (`apps/web/public/add.png`, `cut_gif*.gif`, `swipe_gif*.gif`, last changed 2026-09-28) show the old UI and step order; the steps are now Add, Cut, Swap and Finish, in the blue palette.

- [ ] Add, Cut and Swap, one clip each at one pixel size (`StepMedia` in `components/home/how-it-works.tsx`), each with a `_hi` version for 1024 px and up; check the file sizes

## T039: Take votes off the Server Action queue

**LOW** · Frontend / Performance

Server Actions run one at a time per page, so every swipe's `castVote` and the 2 s `getCommanderRequest` poll delay Finish's Save.

- [ ] `POST /api/votes` with the `vote` rate-limit bucket and `castVoteInputSchema`, after `apps/web/src/lib/server/recs-route.ts`; `realActions.castVote` calls it (the contract doesn't change)
- [ ] Decide whether the lookup poll moves too
- [ ] Measure Finish's Save after a fast Swap sitting, before and after

## T034: Lazy rendering for large collections

**LOW** · Frontend / Performance · Tabled (owner, 2026-09-21) until real collections grow

`/collection` renders every card in every open group (`collection-view.tsx`, `pocket-grid.tsx`): 729 cards load in about 0.6 s.

- [ ] Measure a synthetic 10,000-card collection: load, a search keystroke, a colour toggle
- [ ] `content-visibility: auto` per group first; "Show N more" past about 100 cards a group if needed; virtualise only if that fails. Counts stay exact, collapsing works, `e2e/collection.spec.ts` passes

## T027: 10k-row collection import timing

**LOW** · Performance · The 1,000-row path was fixed 2026-09-20

- [ ] Re-run a 1,000-row import on hosted
- [ ] Time a 10,000-row import end to end locally, extending `apps/web/scripts/collection-resolve-check.ts`: per-batch resolve and commit times, no statement timeout, a responsive browser. Record the numbers beside `app_config.collections`

## T015: SQL tests for collection imports

**LOW** · Testing · Model: `supabase/tests/saved-decks.sql`

- [ ] An owner reads and deletes only their own collection rows
- [ ] `start_collection_import`, `save_collection_rows`, `commit_collection_import` (merge and replace)
- [ ] The limits `maxImportRows`, `maxEntries`, `maxOpenImports`

## T030: Invalid commander-pair keys

**LOW** · Data

Some `commander_keys` rows pair cards that aren't legal partners (companions, misfiled cards). Collation drops their decks (`isValidPartnerPair`), so those keys render empty commander pages.

- [ ] Find the keys that aren't a legal pair and have no `commander_stats` row; delete them, or mark them missing for pages and `proxy.ts`, writing only those rows
- [ ] `aggregate:corpus` (`apps/worker/src/jobs/aggregate-corpus.ts`) stops creating them

## T041: Reclaim dead space on hosted

**LOW** · Database

`vacuum full` on `printings` (166 MB against 56 MB locally) and `search_index_queue` (199 MB with no rows), run by the owner as superuser at a quiet time, since it locks the table. Record the sizes before and after here (database 3,305 MB on 2026-10-20).

## T044: Moxfield crawl access

**LOW** · Data · Blocked on Moxfield

The adapter (`services/search-api/internal/moxfield/`) is built and seeded disabled after Cloudflare's 403 from the VPS (2026-09-22). A block is obeyed, not worked around; the whitelist wants a production domain (T033).

- [ ] Moxfield grants a path, a VPS probe returns 2xx, the parsers are pinned to live fixtures, and `disabled` is cleared

## T003: Deck report link destination

**LOW** · Shelved until the public release (owner, 2026-10-19); don't raise it before then

The Report link on deck pages opens a prefilled GitHub issue until T077 replaces it. Pick the destination for the public release.

---

## Later

One line each; write a full ticket when one starts.

- **T078** Steer Add with the mana shortfall (T046): favour sources of the short colours, at weight 0 until `eval:holdout` passes (owner, 2026-10-23).
- **T079** Zero-deck label (owner, 2026-10-20): when every deck behind the targets is borrowed (own count 0), `stat-targets.ts` reads "First Tymna & Thrasios deck we've seen", with a (?) saying "Targets come from each partner's other decks. Be the first to build it!" "Estimated" stays on the bracket row.
- **T013** k6 load tests for swap, add and cut: p95 uncached swap under 800 ms, add and cut under 1 s at 50 rps.
- **T017** Favorite cards or decks for quick access.
- **T018** Precon import, after checking that MTGJSON's license allows it.
- **T021** Retune `app_config.corpus.partnerPoolWeight` (0.25, set on 4 pairs) when more pair data exists, through `eval:holdout`.
- **T022** Play rate lifts weak tag matches (Reliquary Tower tops Sea Gate Restoration's swaps at a 0.65 tag score): try a tag floor or play-rate dampening against the regression fixtures.
