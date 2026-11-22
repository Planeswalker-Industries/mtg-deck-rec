# Open tasks

Open work in priority order, most important first. Each ticket holds what it takes to finish it; history is in git, and closed tickets are one line each in [`tasks_closed.md`](tasks_closed.md). Ids are never reused. The next new id is T102.

Everything above T033 comes before the soft launch to a playgroup (owner, 2026-10-23); the rest comes after.

State on **2026-10-23**: `main` at PR #164, contract v29, hosted migrations at `20261022000100` (current). Hosted `corpus.decks` 212,606, last collated and precomputed by hand 2026-10-21.

---

## T074: Archidekt answers the daily crawl with 429s

**HIGH** · Data / Ops · Slower pace (`requestIntervalMs` 1000 → 2000) on hosted since migration `20261020000100`; the 429s are solved, the run bookkeeping is not

Runs 22–28 (2026-10-15 to 2026-10-21) failed on 429s, except run 25, that the fetcher's backoff (doubling up to `requestIntervalMaxMs`, 8 s, in `services/search-api/internal/crawl/fetcher.go`) did not outlast.

Hosted `crawl.runs` on 2026-11-17, runs 29–54 (the slower pace) — 26 runs:

- 20 `succeeded`, each stopped by the 6-hour cap (10:46–16:46 UTC): about 800 commanders visited, 3,000–5,500 decks written, 35–220 throttles absorbed by the backoff.
- 1 failed on a 429: run 46 (2026-11-09).
- 2 failed with `context canceled`: runs 39 (2026-11-02) and 40 (2026-11-03). Their times do not match a merge to `main`, so a Dokploy redeploy is not the clear cause.
- 3 left `running` with a `finished_at`, never closed: runs 29 (2026-10-22), 43 (2026-11-06) and 50 (2026-11-13). Run 20 (2026-10-13) is still `running` too.
- No run on 2026-10-29.

- [x] Three daily runs in a row without a 429 failure: runs 30–38 (2026-10-23 to 2026-11-01), nine in a row
- [ ] Find why runs 29, 43 and 50 stopped without closing (process killed or crashed mid-run?) and what stopped runs 39 and 40; check the VPS host's restarts and container logs for those dates
- [ ] Close runs 20, 29, 43 and 50 as failed, and make a run killed by a redeploy or crash end up marked failed (on shutdown, or by the next run closing stale ones)
- [ ] Find why no run started on 2026-10-29

## T068: Recommendation latency (PR #139 review)

**MEDIUM** · Backend / Performance

2026-10-07: adds 212/243 → 306/400 ms at p50/p95; card pairs cost most, `serving_deck_affinity` 174 ms and 253 KB for an add.

- [ ] Skip the card-pairs read for cuts while `affinity.lowAffinityCuts` is off, and for swaps while their `deck` weight is 0
- [ ] After T086 reaches `main`: compare Fix's hosted p95 with Add's. Locally Fix runs within about 10% of Add (64–69 ms against 59–61 ms) and sends about 30 KB gzipped
- [ ] The deck tool still asks for cuts on every analysis; only a deck over 100 has a Cut step (T087), so a deck at or under 100 can skip that read
- [ ] Skip `serving_commander_profile` while `skeleton.edhrecPrior` is off
- [ ] The swap ladder's slot rung (T088) reads every legal card when there is no collection: about 300 ms locally for a card with no tags (Doc Ock, Sinister Scientist), cached for hours per card and commanders; Owned only takes about 36 ms. An index or a stored card category would bring it down
- [ ] Send an add only the pairs that point at its pool and neighbours, each card's row once; or cache each card's corpus pairs for days

## T067: Drop the retired rec functions

**LOW** · Database · Unblocked: no rollback to the build before PR #140 is wanted (owner, 2026-10-23)

A migration drops `rec_add_candidates` (both overloads), `rec_swap_candidates`, `rec_card_roles`, `log_rec_timeout`, `rec_timeouts` and the `app_config.recs` row, and `supabase/tests/serving.sql` checks they're gone.

## T051: Local e2e failures with real data

**LOW** · Testing

- [ ] `analyzeDeck` in `deck-journey.spec.ts` waits for the recommendations or the lookup sheet before dismissing (Chulane has no local corpus, so the sheet opens late and blocks the page)
- [ ] The specs pass with `E2E_LOCAL_DATA=1` and in CI

---

## T033: Custom domain and SMTP

**HIGH** · DevOps / Auth · Absorbs T002, whose dashboard steps are done · `spellchasm.com` bought at Namecheap (owner, 2026-11-16); the app is renamed Spell Chasm

Moxfield's whitelist also wants a production domain (T044). `www.spellchasm.com` is canonical and the apex redirects to it (Vercel's default, kept by the owner on 2026-11-16).

- [x] Vercel (`mtg-app` → Domains) serves `www.spellchasm.com`, the apex redirects to it, and Namecheap DNS holds Vercel's records
- [x] Vercel `NEXT_PUBLIC_SITE_URL` = `https://www.spellchasm.com` (Production), then a redeploy: the value is baked in at build (on 2026-11-16 robots.txt still named `mtg-app-psi.vercel.app`)
- [x] Supabase → Authentication → URL Configuration: Site URL `https://www.spellchasm.com`, and both `https://www.spellchasm.com/**` and `https://spellchasm.com/**` in the redirect list
- [x] Google OAuth: consent screen name, home page, privacy link and authorized domain on `spellchasm.com` (owner, 2026-11-16)
- [ ] Google's account chooser says "Spell Chasm", not the Supabase project domain. Verify `spellchasm.com` in Google Search Console as a Domain property (DNS TXT record at Namecheap), signed in with the Google account that owns the Cloud project
- [ ] Google Cloud → Google Auth Platform → Branding: app name Spell Chasm, logo, home page and privacy policy URLs on `https://www.spellchasm.com`, authorized domain `spellchasm.com`; then submit the branding for verification
- [ ] Once Google approves the branding, signing in on `www.spellchasm.com` shows "to continue to Spell Chasm" in the chooser
- A Supabase custom domain (paid add-on) would also change the chooser's domain; considered and not chosen (owner, 2026-11-16)
- [ ] The VPS worker's `WEB_APP_URL` is `https://www.spellchasm.com`; Impact's property URL is the new domain; Archidekt is told the crawl's new User-Agent (`SpellChasm/0.1`)
- [x] `yarn workspace @mtg/web smoke` passes against `https://www.spellchasm.com` (14/14, 2026-11-16)
- [ ] Resend (free tier) or equivalent verifies the sending domain, Supabase → Authentication → SMTP uses it, and Rate Limits → emails per hour goes up; the hosted sign-in email template and subject say Spell Chasm
- [ ] Sign-in emails arrive at a production rate, and the emailed-code form in `apps/web/src/components/auth/sign-in-form.tsx` is uncommented (closed T080 commented it out)
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
- [ ] Once EDHREC is on hosted (a hand `sync:edhrec`), the evaluation on the time split with `--snapshot-month` set to it
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
- [ ] The evaluation builds decks from card rows without mana data (`produced_mana`, `fetchable_mana`), so the builder never sees a colour short of sources and its land picks go ungraded (found 2026-11-11; the repair check loads the mana fields for itself). Loading them moves the build numbers: do it as its own baseline change

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

## T066: Background jobs on the VPS

**HIGH** · Worker / Ops · Unshelved 2026-11-17; the worker runs on the owner's Contabo VPS since 2026-11-18 · Absorbs T009

**Plan (owner, 2026-11-17):** the Node worker runs as it is on the owner's own Contabo VPS (12 GB RAM), through `deploy/worker/docker-compose.yml` (no Dokploy). The search API, Typesense and the Archidekt crawl stay on the friend's VPS; the worker reaches the search API over its public URL (`SEARCH_API_URL`) with `SEARCH_API_CRON_TOKEN` and `SEARCH_API_ADMIN_TOKEN` from the host. No Go port. Why now (hosted, 2026-11-17): `corpus.decks` was last collated 2026-10-20, and 85,451 of the 304,157 raw `archidekt.decks` rows were fetched after that, so a month of crawling has not reached recommendations. Watch the load on hosted: the incremental passes go first, the full passes stay monthly at a quiet hour (the reason hand runs moved local on 2026-11-03).

Before the plan above, the Node worker (`apps/worker` `cli serve`, `deploy/dokploy/worker.yml`, memory limits from PR #166) is built and released but not deployed: the VPS host would rather run background jobs in the Go search API than host a second kind of service. Until the owner says otherwise, they run by hand every sync no deployed service runs: `collate`, the precompute passes, the global pair count and `sync:edhrec`. The daily GitHub Actions sync (catalog, printings, tags and, since 2026-10-23, Spellbook) and the Go API's daily crawl keep running. Deck lookups stay unserved meanwhile: 2 hosted `commander_requests` queued since 2026-09-19 and 2026-09-28, and the deck tool shows the collector offline.

What a replacement has to cover, from `apps/worker/src/jobs/serve.ts`:

- The `app_config.worker` schedule, read from the database so a restart neither repeats nor skips work, and the `worker_status` heartbeat (`commander-requests`) the deck tool reads (offline after 30 s).
- Deck lookups (`lookups.ts`): a requested commander goes first in the crawl's queue, a crawl run starts when none is going, and after the visit the commander is collated, precomputed and its request closed.
- Each source's daily crawl, started by the Vercel cron before the worker took it over.
- Incremental collation (`collate.ts`) about every 30 minutes, then the per-commander precompute passes for the commanders whose decks changed.
- The heavy full passes (owner, 2026-10-23: monthly, since big swings come with new sets): every substitute list (2 h 41 min on 2026-10-21), the global pair count and the baseline. EDHREC stays weekly.
- Parity: the precompute's formulas live in `@mtg/core/scoring`, which the web app (`cardPrior`, `servedCardRates`, `commanderShare`, `pickCorpusSources`) and `eval:holdout` also run. A port to Go needs a check that its tables match the TypeScript jobs' on the same corpus.
- Memory (2026-10-24): the global pair count over 212,606 decks needs about 1.3 GB of Node heap, plus a 1 GB count of card pairs (22,583 cards in 50 or more decks) that grows with the square of the card count.

- [x] The design is picked: the Node worker on the owner's own VPS (2026-11-17)
- [x] The Contabo VPS is provisioned and hardened (2026-11-18): Ubuntu 24.04, 12 GB RAM, New Jersey; SSH by key only, `ufw` 22/80/443, unattended-upgrades, fail2ban. Contabo's image ships Dokploy, so the worker runs as a Dokploy Compose app (`deploy/dokploy/worker.yml`, branch `main`, deployed by hand). TCP connect to the `us-east-2` session pooler: 38–55 ms
- [x] The Dokploy panel gets a domain with TLS (`ops.spellchasm.com`), and port 3000 closes (Docker-published ports bypass `ufw`) (2026-11-19)
- [x] The worker runs there with `DATABASE_URL` (session pooler), `SEARCH_API_URL` (PR #212), both search API tokens, `WEB_APP_URL` and `REVALIDATE_SECRET` (in single quotes: Compose expands `$` in an unquoted value); the first collation (86,754 decks) and precompute finished on 2026-11-18 without straining hosted
- [x] Hosted `commander_requests` are consumed and the deck tool sees the heartbeat (both requests `done`, 2026-11-18)
- [ ] The new jobs fill what hand runs do now, on the owner's cadence
- [x] The Vercel cron (`/api/cron/*-scrape`) is off: the owner disabled it in the Vercel dashboard on 2026-11-18, and the worker starts the daily crawl at `crawlHourUtc` (10:00 UTC); its entries left `apps/web/vercel.json` on 2026-11-19
- [x] The worker started the 2026-11-19 and 2026-11-20 crawls (`crawl.runs` 56 at 10:00:03 and 57 at 10:00:06 UTC; 57 succeeded at 16:00 UTC)
- [x] Pushes to `main` redeploy the worker (2026-11-18): the Dokploy `worker` app has Auto Deploy on and Watch Paths empty, its Webhook URL is the `DOKPLOY_WORKER_WEBHOOK_URL` repository secret, and a manual run of `.github/workflows/worker-deploy.yml` got Dokploy's "Compose deployed successfully"

## T003: Deck report link destination

**LOW** · Shelved until the public release (owner, 2026-10-19); don't raise it before then

Since T077 the Report link on deck pages opens the signed-in `/feedback` form. Decide whether signed-out visitors need another way to report a deck for the public release.

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
