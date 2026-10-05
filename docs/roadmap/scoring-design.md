# Unified scoring design

Status: **design, for review** (2026-10-05). Nothing here is built yet; [`../tasks.md`](../tasks.md) tracks the slices as T053–T061.

**What it does.** One scoring engine serves every recommendation the app makes, across all four data sources: Archidekt decks, EDHREC statistics, Commander Spellbook combos, and our own corpus and players' decks. It covers three modes:

1. **Improve a deck with the player's collection.** This is the priority.
2. **Improve a deck with any card.**
3. **Build a 99 from a commander and a bracket,** against the player's collection.

**How it relates to the card graph.** [`card-graph-plan.md`](card-graph-plan.md) (T035) moves the corpus into Postgres and adds card-pair statistics. This document is the scoring layer on top of that. Where the two overlap, the plan owns the pipeline and this document owns the scoring.

## Owner decisions this rests on (2026-10-04/05)

| Topic | Decision |
|---|---|
| Priority | Collection-aware improvement comes first |
| Collection when improving | **Owned only, plus a separate "worth buying" list.** The collection is a filter. Price ranks the buy list and never the quality score. Supersedes the "owned first" default (T037) and reframes T007 |
| Collection when building | **Owned only.** If the collection can't support the commander, say what is short, then offer to fill the gaps with affordable cards |
| "Affordable" | **Best value**: score gained per dollar, with a running total. No hard cap |
| Deck skeleton (lands, roles, curve) | **Learned per commander** from our decks, then EDHREC, then generic targets |
| Combos | **Gated by bracket.** Suggest completing only combos the chosen bracket allows; flag combos above it and offer cuts |
| Bracket rules enforced | Game Changers; combos; mass land denial, extra turns and tutors; and power level by bracket |
| Bracket of a corpus deck | **Always estimated by us.** Author-declared brackets are not used for scoring |
| Availability | Basic lands are always available. An owned functional twin can stand in for a card. Cards in the player's other decks that are **marked built** are conflicts: they are tagged with that deck, and the player can ask for swaps there |
| EDHREC's role | **Pool and prior** for commanders with few decks of ours. It decides which cards are considered, not only their order. Our decks take over as they grow. Its numbers are never displayed |
| Measuring success | Offline holdout; agreement with EDHREC as a benchmark; **live accept rate**, recorded per visitor the same way swap votes are |

## Principles

- **One scorer, three modes.** Modes differ in their candidate pool, their constraints and what they return. They share the same component formulas and the same blend.
- **Every component is a number from 0 to 1, or null.** Null means unknown, not low. `blendScore` (`packages/core/src/scoring/swap.ts`) gives a null component zero weight and renormalises the rest. That rule stays.
- **Weights and thresholds live in `app_config`,** never in code. The repo is public (CLAUDE.md, Hard constraints). `app_config.scoring` holds the weights; `app_config.brackets` holds the bracket rules.
- **Ownership is a filter, and price is a tiebreak for buying.** Neither is a quality component, so the score a player sees always means "how good is this card here".
- **Hard rules are constraints, not penalties.** Colour identity, legality, singleton, bracket caps and availability all remove a card. A penalty could be outweighed, and a forbidden card must never be suggested.
- **Every weight change is gated by the offline evaluation** (see Evaluation).

## Data map

How each source arrives, how it is cleaned, where it lives, and what is wrong with it today.

| Source | Arrives | Cleaned and resolved | Stored in | Refresh | Gaps today |
|---|---|---|---|---|---|
| Archidekt decks (deck lookups) | The VPS worker (`cli serve`) collects a requested commander's decks under the crawl's claim | `qualifyDeck` (100 cards, public, format 3, first category decides), then resolved by `crawl_upsert_decks` | `corpus.decks`, then the aggregates through `resolveDeck` (legal commanders and pair, identity, ≤ 3 unknown cards) | On request | Shares `corpus.decks` with the crawl |
| Archidekt decks (crawl) | Daily Go crawl on the VPS, started by the VPS worker | Qualified on the deck; resolved to card ids on write by `crawl_upsert_decks` | `corpus.decks` (`commander_card_ids`, `cards {id: qty}`, update times), aggregated by `aggregate:corpus` | Daily | No bracket, no views. Legality, identity and partner validity are checked at aggregation (`resolveDeck`) |
| Our players' decks | `save_deck` | Card ids resolved before saving | `decks`, `deck_cards` | On save | **Feeds no aggregate.** `include_in_corpus` checks per-card legality but not the 100-card count |
| EDHREC | `sync:edhrec` on the VPS worker: the commander sitemap, then each page as JSON | Printing id, then a unique name match. Every commander name must resolve | `external_commanders`, `external_commander_card_stats` | Weekly | Prior wired in but off (`externalPriorShare = 0`). It only re-ranks, never adds candidates. Lists are trimmed, so a missing row means "not published" |
| Commander Spellbook | `sync:combos`, daily export | Every piece resolved by oracle id, or the combo is skipped | `combos`, `combo_features` | Daily (GitHub Actions) | `service_role` only. Nothing reads it |
| Scryfall and Tagger | `sync:catalog`, `sync:printings`, `sync:tags` | Content-hash diffs | `cards`, `card_stats`, `printings`, `card_tags`, `tag_closure` | Daily | None for scoring |
| Collections | Import, link, or hand edit | `resolve_collection_rows` (Scryfall id → TCGplayer id → set+number → name) | `collection_items` (account) or IndexedDB (browser) | On edit | **Recommendations use card ids only; quantities are ignored** |

Discrepancies to fix along the way:
- The TS Archidekt client (deck lookups) keeps `edhBracket`; the Go crawl drops it. Owner decision: brackets are estimated, so the dropped field doesn't matter. Both now skip Archidekt's deleted card entries (`deletedAt`; the TS side fixed 2026-10-05).
- `targetDecks` means two unrelated things: 100 in `app_config.commander_requests` and 60 in `app_config.archidekt`.
- `estimateBracket` is never passed `hasMassLandDenial` (`apps/web/src/lib/server/deck.ts`).

## Scoring components

Notation:
- K: a commander key.
- n: K's eligible decks, release-aware and weighted across partner sources.
- x: K's decks running the card.
- p0: the card's colour baseline rate.
- e: EDHREC's inclusion rate for K, when K has a page.
- α: `shrinkAlpha`.

| Component | Used by | Formula | Null when |
|---|---|---|---|
| `corpus` | all | Built from `shrunkInclusion`, `commanderShareWithPrior` and `commanderCorpusScore`; details below | Too few decks anywhere and no EDHREC page (today's rule) |
| `bracket` | all | Power fit to the chosen bracket; details below | No band data for the card |
| `combo` | add, build, swap | A bonus outside the blend; details below | — |
| `role` | add, build | Largest shortfall among the roles the card fills (`roleGap`), against **learned** targets | No tracked roles |
| `curve` | add, build | Shortfall in the card's mana value bucket against the commander's learned curve | No curve profile |
| `deck` | all | Deck affinity from pair PMI (card-graph-plan, "Deck affinity") | Until pair tables exist (T060) |
| `tag`, `manaValue`, `staple`, `votes` | swap | Unchanged (`swap.ts`); votes per T006 | As today |

**`corpus`** (exists; this design switches the prior on):
- The shrink target is EDHREC's rate when K has a page, otherwise p0. Synergy is always measured against p0:
  - `incl = (x + α·target)/(n + α)`, where target is e when present, else p0
  - `syn = incl − p0`
- The commander's weight is `share = max(commanderShare(n), externalPriorShare)` when e exists, otherwise `commanderShare(n)`.
- `corpus = share·commanderCorpusScore({incl, syn}) + (1 − share)·√p0`.
- `externalPriorShare` is set from the evaluation (T057), not by hand.

**`bracket`** (new): power fit.
- Every corpus deck gets an estimated bracket (see Bracket engine). Decks are grouped into **bands**: low (1–2), mid (3) and high (4–5).
- For each card and band b:
  - `r_b = (x_b + α·r)/(n_b + α)`, where r is the card's rate over all bands and both counts are identity- and release-aware.
  - `lean_b = ln(r_b / r)`.
  - `bracket = clamp01(0.5 + lean_b / (2·leanScale))`.
- A card that decks in the chosen band play more than average scores above 0.5; one they play less scores below.
- The per-commander lean replaces the global one as K's decks in band b grow: `w = n_{K,b}/(n_{K,b} + β)`.
- This is how "power level by bracket" shifts card choice without any hand-written power list.

**`combo`** (new): a **bonus**, not a blended component.
- `total = clamp01(blend + comboWeight·combo)`.
- A blended combo component would either drop out (null) for most cards or drag every non-combo card down with a zero; a bonus does neither.
- `combo(c)` is the highest `resultWeight` over the combos that adding c completes, counting only combos that:
  - the chosen bracket allows,
  - have their commander requirement met (`commander_card_ids`),
  - and, if they have template pieces, get `templateDiscount` (they can't be checked automatically).
- `resultWeight` by result, in `app_config.scoring`: "Win the game" > infinite mana, damage or turns > other standalone results > contextual results.
- A card that would complete a combo the bracket **forbids** is not penalised; it is removed (a constraint).

**`role`** (exists; targets extended):
- `roleTargetsFor` blends generic targets toward the commander's `role_profile` by `commanderShare`.
- New: a commander with an EDHREC page gets a role prior `profile_ext[role] = Σ e(c)` over the cards c on its page that fill that role. Summed inclusion is the expected number of such cards per deck. It undercounts a little, because EDHREC trims its lists.
- The blend becomes our profile → EDHREC prior → generic, by deck count.

**`curve`** (new):
- `commander_stats` gains `curve_profile`: average nonland cards per deck in each mana value bucket, 0–1 up to 7+ (`CURVE_TOP_MANA_VALUE` in `deck-stats.ts`).
- It also gains `land_count`: average lands per deck.
- `curve(c) = clamp01((h_K[b] − d[b]) / h_K[b])` for the card's bucket b, where d is the deck's current histogram. This is the same shape as `roleShortfalls`.
- EDHREC gives a prior: `Σ e(c)` per bucket.

**Starting weights.** These are moved into `app_config.scoring` as they are today (T053); new components only get weight once the evaluation shows they help.

| Mode | corpus | bracket | deck | role | curve | tag | manaValue | staple | votes | comboWeight |
|---|---|---|---|---|---|---|---|---|---|---|
| add (both improve modes) | 0.8 → evaluated | 0 → evaluated | 0 → evaluated | 0.2 | 0 → evaluated | — | — | — | — | 0 → evaluated |
| swap, any card | 0.2 | 0 → evaluated | 0 → evaluated | — | — | 0.4 | 0.1 | 0.2 | 0.1 | 0 → evaluated |
| swap, collection | 0.15 | 0 → evaluated | 0 → evaluated | — | — | 0.55 | 0.1 | 0.1 | 0.1 | 0 → evaluated |
| build (per pick) | as add | as add | as add | as add | as add | — | — | — | — | as add |

## Bracket engine

`estimateBracket` (`packages/core/src/formats/commander/bracket.ts`) today counts only Game Changers. It gains these signals (`BracketSignals`):

| Signal | Source | Rule shape (values in `app_config.brackets`) |
|---|---|---|
| Game Changers | `cards.game_changer` | 0 in 1–2, ≤ 3 in 3 (as `gameChangerLimit` today) |
| Combos | `combos_for_cards(deck, 0)`. Spellbook tag → bracket: R 4, S and P 3, O and C 2, E 1, B illegal | A combo whose tag maps above the chosen bracket is over the line |
| Mass land denial | Tagger tag UUIDs listed in `app_config.brackets` | None below 4 |
| Extra turns | Tagger tag UUIDs | Caps per bracket |
| Tutors | Tagger tag UUIDs | Caps per bracket |

- **Estimate:** the lowest bracket whose caps the deck fits.
- **Enforce:** every cap is a hard constraint on adds and builds. Each one is also a must-cut reason, extending `bracketMustCuts` (`packages/core/src/journey/bracket-check.ts`) with `OVER_BRACKET_COMBO` and `OVER_BRACKET_MLD`, `_EXTRA_TURNS` and `_TUTORS`.
- **Estimated for every corpus deck during aggregation.** This is what makes the `bracket` component possible. It needs the combos and tag lists in the worker; both are already in Postgres.
- **A combo piece is protected from `LOW_SYNERGY` cuts** while its combo is complete and allowed. Combo pieces often have low play rates individually.

## Candidate pools

The SQL decides which cards exist; the blend only orders them. So the pool must contain every card a mode could want.

| Pool source | When | Size |
|---|---|---|
| Top by corpus score (`rec_add_candidates`) | Always | 400 (today) |
| EDHREC's listed cards for the commander, ordered by `commanderCorpusScore({e, e − p0})` | Commanders below `minDecks` that have an EDHREC page | `edhrecPoolSize` |
| Missing pieces of combos the bracket allows (`combos_for_cards(deck, 1)`) | Adds and builds | Every match |
| Pair neighbours of the deck's cards | Once pairs exist (T060) | card-graph-plan |
| **All available owned cards** in the colour identity | Collection modes | The whole owned pool. A collection rarely holds more than a few thousand legal cards in an identity, so score them all rather than pre-ranking |

Hard filters apply in every pool: legal, inside the identity, not a basic land (lands are handled separately in builds), not already in the deck, Game Changers per bracket, and availability.

## Availability

```
available(card) = owned copies of the card and its functional twins (same equivalence_base_id)
                − copies used in the player's other decks marked built
basic lands     = always available
```

- **Quantities matter now.** Today only card ids reach recommendations. Accounts read quantities from `my_collection_entries()`, and browser collections already store them.
- **Built decks.** New column `decks.is_built`, which the player sets ("I've put this deck together"). Only built decks hold cards. A list still being brewed holds nothing.
- **Conflicts.** A card the player owns but whose copies are all in built decks is still suggested, tagged `inDeck: {deckId, name, code}`. Tapping it opens swaps for that card **in that other deck**, so the player can free it up. Conflicts never count as available when a build is checked for feasibility.
- **Twins.** If the player owns Terramorphic Expanse and the recommendation is Evolving Wilds, the suggestion is the owned twin.

## Mode A: improve with the collection (priority)

- **Adds, cuts and swaps** score only available cards. Cuts keep `NOT_OWNED` for unowned cards in the deck.
- **Buy list**, shown separately and labelled as such:
  - For each add category, or each swap target, let `s_A` be the best available card's score.
  - An unowned card c joins the buy list when `s(c) − s_A ≥ buyMargin`.
  - Buy-list cards are ranked by **value**: `(s(c) − s_A) / max(price(c), priceFloor)`.
  - Price comes from `card_stats.cheapest_usd` and is shown with `prices_checked_at()`.
- **Collection-mode swap weights:** `tag` 0.55 (today's `collection_aware`). An owned replacement has to do the same job, because the pool is smaller.
- **Default:** owned only, plus a buy list, whenever the player has a collection. "Owned first" stays available only if the evaluation or live data shows players want it (T037).

## Mode B: improve with any card

The same scorer and pools, with no availability filter and no buy list. This is today's collection-less path, plus the new components and EDHREC pools.

## Mode C: build from a commander and a bracket

**Inputs:** commander(s), bracket, the player's availability, and `fill` (`none`, or `value` to fill gaps with affordable cards).

1. **Skeleton.**
   - Land count is `land_count` (ours → EDHREC prior → generic in `app_config.scoring`).
   - Nonland slots = 99 − lands.
   - Role targets come from `roleTargetsFor` with the EDHREC prior; the curve comes from `curve_profile`.
   - Bracket caps come from `app_config.brackets`.
2. **Pool.** All available cards in the identity, plus the commander's corpus and EDHREC pools, intersected with availability.
3. **Greedy fill of the nonland slots.** Each step picks the card with the highest marginal score `m(c | picks)`:
   - `blend` here is `blendScore` over corpus, bracket and deck, with the deck component measured against the picks so far.
   - Each step skips any card that would break a hard constraint: singleton, the Game Changer cap, completing a forbidden combo, or the MLD, extra-turn and tutor caps.
   - Each pick updates the role and curve needs and the combos within reach.
   - Ties break on name, so builds are deterministic.
   - Filling stops when the best `m < qualityFloor`.

   ```
   m(c) = blend(c) + roleWeight·roleNeed(c | picks) + curveWeight·curveNeed(c | picks) + comboWeight·combo(c | picks)
   ```
4. **Lands.**
   - Nonbasic lands come first, ranked by corpus and bracket and capped so at least `minBasics` basics remain.
   - Basics are then split by each colour's share of pips in the chosen spells' `mana_cost`.
5. **Feasibility report.** When slots or role targets are still open, say so plainly: "Your collection fills 81 of 99. Ramp is 4 short and removal 3 short." Offer `fill: value`.
6. **Value fill (on request).** Rerun steps 3–4 for the open slots over unowned cards.
   - Pick by `(m(c) − qualityFloor) / max(price, priceFloor)`.
   - Show a running total of the prices, with their as-of date.
7. **Output:** the 99 grouped like Add, each card with its components and evidence. Also the combos included (with links to Spellbook, credited), the estimated bracket and its signals, and the feasibility report.

A local improvement pass may follow: try swapping each pick for the best unpicked card if the total rises. Add it only if the evaluation shows it helps.

The build engine runs as a pure function in `@mtg/core` over loaded rows, so the evaluation and the regression harness run it outside Next.js. The new `/deck` entry for it is T050's picker.

## Data and pipeline changes

| Change | Slice |
|---|---|
| `app_config.scoring` (weights, `buyMargin`, `qualityFloor`, `priceFloor`, `leanScale`, `resultWeight`, `templateDiscount`, `edhrecPoolSize`, generic land count, `minBasics`) and `app_config.brackets` | T053, T055 |
| Combos readable by the recommendation path: a security-definer `deck_combos(card_ids, max_missing, bracket)` executable by API roles, returning ids, missing pieces and results but **never `popularity`** | T055 |
| `decks.is_built`, plus card quantities in recommendation requests | T056 |
| EDHREC pool source in `rec_add_candidates` (repeat `enable_nestloop = off`), and the role and curve priors | T057 |
| Complete, legal user decks into the aggregate, and per-key incremental aggregation (card-graph slices 3–4; `aggregate:corpus` already reads `corpus.decks`) | T058 |
| A per-deck estimated bracket during aggregation; `card_bracket_stats (card_id, band, decks_with, eligible_decks)` and `commander_card_bracket_stats` (only bands with ≥ `minDecks` decks); `commander_stats.curve_profile` and `land_count` | T058 |
| Pair tables (card-graph slice 5) | T060 |
| `rec_events` (shown, accepted, declined), keyed like `swap_votes` | T061 |

Every write follows the existing rules: stage, sanity gate, diff-only merge, grants in the migration, and no materialized views.

## Contract changes (designed, not built)

One version bump per slice that touches the contract:
- `ScoreComponent` gains `bracket`, `deck`, `combo` and `curve`. `ScoreBreakdown` gains `bonus` for the combo bonus.
- `AddSuggestion` and `SwapSuggestion` gain `conflict?: {deckId, name, code}`.
- `AddResult` and `SwapResult` gain `buyList` (suggestions with `valueScore` and price).
- `OwnershipInput` carries quantities. `ownershipMode` defaults to `'only'` with a buy list.
- A new `BuildApi.build({commanderIds, bracket, ownership, fill})` returns `{deck, groups, combos, bracket, feasibility, fillCost?}`.
- `DeckAnalysis` gains `combos` (pieces, results, Spellbook link) and `bracketSignals`. Display per T045.

## Evaluation

Built on card-graph-plan slice 6 (`cli eval:holdout`, reports to `$MTG_DATA_DIR/reports` and the run's log), over `corpus.decks` through `loadCorpusDecks`.

| Test | Method | Metric |
|---|---|---|
| Improve (adds) | Split decks 90/10 by deck and build stats from the 90%. Hide 10 nonland cards from each held-out deck | recall@20, bucketed by commander size (≥ 300, 50–299, < 50: the last bucket tests the EDHREC pool and prior); "Sol Ring rate" (share of hits that are generic staples) |
| Cuts | Add 10 identity-legal cards taken from other commanders' decks | precision@10 of the cuts |
| Collection mode | Synthetic collection: the hidden cards plus a random sample of other cards drawn by global popularity | recall@20 of the hidden cards from owned-only adds; how many buy-list entries are hidden cards |
| Build | Build for the commander and band of each held-out deck, with every card available | mean overlap with held-out decks for the same commander and band; error in role counts and land count |
| Bracket estimator | Compare with author-declared brackets where a source shows one (the deck lookups' Archidekt client reads `edhBracket`) | Agreement matrix (a sanity check only, since scoring uses the estimate) |
| EDHREC agreement | The built 99 against the commander's EDHREC cards by inclusion | Overlap. Reported, never shown |
| Live accept rate | `rec_events` | Accepted ÷ shown per mode, rank and component mix. Watched after each release |

**Gate:** a weight or formula change ships only if recall@20 rises overall, falls in no size bucket, and the Sol Ring rate rises by no more than `solRingTolerance`. The regression fixtures (`yarn workspace @mtg/web regress`) still pass.

**`rec_events`:**
- One row per shown batch (the card ids in order, mode, commander ids and bracket), plus one row per accept or decline.
- Keyed by `auth.uid()` or the salted visitor hash, exactly like `swap_votes`.
- Written through a rate-limited security-definer function.
- RLS on, with no API reads.
- `/privacy` gains a line saying suggestions shown and accepted are recorded to improve recommendations.

## Roadmap

Each slice is one PR into `develop`, gated by the evaluation from T054 on. The priority mode comes first.

| # | Task | Slice | Needs | Done when |
|---|---|---|---|---|
| 1 | T053 | Weights and thresholds into `app_config.scoring`, read by TS and SQL (card-graph slice 1) | — | Regression fixtures unchanged |
| 2 | T054 | Offline evaluation on today's scoring (card-graph slice 6, extended with the tests above) | T053 | Baseline report recorded |
| 3 | T056 | **Collection mode:** quantities, twins, `decks.is_built`, conflicts, owned-only default, buy list | T053 | Collection-mode recall recorded; buy list shown with price and date |
| 4 | T055 | **Bracket engine and combos:** `app_config.brackets`, `estimateBracket` signals, `deck_combos`, the `combo` bonus, new must-cut reasons, `DeckAnalysis.combos` | T053; display per T045 | Estimator agreement reported; combo bonus passes the gate |
| 5 | T057 | **EDHREC pool and prior on:** pool source, `externalPriorShare` from the evaluation, role and curve priors | T054 | The < 50 bucket's recall rises |
| 6 | T058 | **Aggregation:** user decks, per-deck bracket, per-band stats, curve and land profiles | card-graph slices 3–4 | `bracket` and `curve` components pass the gate |
| 7 | T059 | **Build mode:** `BuildApi`, greedy fill, feasibility report, value fill | T055–T058 | Build overlap and role error reported; T050's picker lands in it |
| 8 | T060 | **Deck affinity:** pair tables and the `deck` component (card-graph slices 5, 7, 8) | T058 | Recall@20 beats the T054 baseline |
| 9 | T061 | **Live accept rate:** `rec_events`, `/privacy` line | — (can move earlier) | Accept rate per mode visible to admins |

Existing tasks this affects:
- **T007** is reframed: price ranks the buy list and value fill, and is not a score component.
- **T037** is resolved: owned only becomes the default.
- **T047** becomes T055's data source.
- **T006** (votes), **T020** (superseded by T060) and **T022** (play rate lifting weak tag matches; the gate's fixtures cover it) are unchanged.
- **T035** owns the pipeline slices.
- **T045–T048** own the analysis display.
- **T050** is the entry point for build mode.

## Open questions for the owner

1. **"Early" combos in bracket 3.** WotC allows no *early-game* two-card combos in bracket 3. Should that be Spellbook's R tag alone, or a combined mana value threshold?
2. **Caps per bracket** for tutors and extra turns, and which Tagger tags count. Proposal: the tags are listed in `app_config.brackets`, with WotC's published guidance as the starting values.
3. **Bracket bands.** Should 4 and 5 (cEDH) share a band until there are enough decks to split them?
4. **Starting values** for `buyMargin`, `qualityFloor`, `priceFloor` and `minBasics`. Proposal: set them from the evaluation rather than by hand.
5. **Accept events and consent.** Is a `/privacy` line enough, or should there be an opt-out?
