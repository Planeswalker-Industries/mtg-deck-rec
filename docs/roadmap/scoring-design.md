# Unified scoring design

Status: **design, revised 2026-10-05** after the owner's review; **built 2026-10-06 on `feat/scoring-pipeline`** (PR #139)
except where [`../tasks.md`](../tasks.md) (T053–T068) says otherwise. Two known gaps: cuts still rank by the
hand-weighted cut score (`cut.ts`), not by m(c | D − c), and the land count has no EDHREC step (T068).

**What it does.** One scoring engine serves every recommendation the app makes, across every data source: Archidekt
decks, EDHREC statistics, Commander Spellbook combos, and our players' decks. It covers three modes:

1. **Improve a deck with the player's collection.** This is the priority.
2. **Improve a deck with any card.**
3. **Build a 99 from a commander and a bracket,** against the player's collection.

**How it relates to the card graph.** [`card-graph-plan.md`](card-graph-plan.md) (T035) owns the pipeline: the data
layers, the collator and the precompute worker that build every input below. This document owns the scoring: the
formulas, the modes, the bracket rules and the evaluation.

## Owner decisions this rests on (2026-10-04/05)

| Topic | Decision |
|---|---|
| Priority | Collection-aware improvement comes first |
| Collection when improving | **Owned only, plus a separate "worth buying" list.** The collection is a filter. Price ranks the buy list and never the quality score. Supersedes the "owned first" default (T037) and reframes T007 |
| Collection when building | **Owned only.** If the collection can't support the commander, say what is short, then offer to fill the gaps with affordable cards |
| "Affordable" | **Best value**: score gained per dollar, with a running total. No hard cap |
| Deck skeleton (lands, roles, curve) | **Learned per commander** from our decks, then EDHREC, then generic targets |
| Combos | **Their own Add group, gated by bracket.** "Complete a combo" lists only combos the chosen bracket allows. A combo already in the deck above the bracket is flagged, with a cut offered |
| Bracket rules | Game Changers and mass land denial are hard limits. Two-card combos and chained extra turns are flagged. **No tutor limit**: WotC removed tutor limits from every bracket in October 2025, and the strongest tutors are Game Changers |
| Power level by bracket | **Dropped for now** (2026-10-05): no `bracket` score component. The raw deck table keeps each author's declared bracket to check our estimator. Revisit once the evaluation exists |
| Bracket of a corpus deck | Estimated by us when needed (the evaluation). Author-declared brackets never score |
| Availability | Basic lands are always available. An owned functional twin can stand in for a card. Cards in the player's other decks that are **marked built** are conflicts: they are tagged with that deck, and the player can ask for swaps there |
| EDHREC's role | **Pool and prior**, its weight set by its sample size, so our decks take over as they grow. Its numbers are never displayed |
| Deck thresholds | `minDecks` and `fullDecks` are both **50** |
| Speed | Everything that doesn't depend on the player's deck is **precomputed**; a request reads indexed rows ([`card-graph-plan.md`](card-graph-plan.md), "Precompute worker") |
| Measuring success | Offline holdout with a **fixed seed and bootstrapped tolerance**; agreement with EDHREC as a benchmark; **live accept rate**, recorded per visitor the same way swap votes are, explained on `/privacy` with no opt-out |
| The design's open questions | Answered 2026-10-05; see "Owner answers" at the end |

## Principles

- **One marginal-value function, every mode.** A card's value is what it adds to a given deck. Adds, cuts, swaps and
  builds all rank by it; modes differ only in their candidate pool, their constraints and what they return.
- **Every component is a number from 0 to 1, or null.** Null means unknown, not low. `blendScore`
  (`packages/core/src/scoring/swap.ts`) gives a null component zero weight and renormalises the rest. That rule stays.
- **Weights and thresholds live in `app_config`,** never in code. The repo is public (CLAUDE.md, Hard constraints).
  `app_config.scoring` holds the weights; `app_config.brackets` holds the bracket rules.
- **Ownership is a filter, and price is a tiebreak for buying.** Neither is a quality component, so the score a
  player sees always means "how good is this card here".
- **Hard rules remove cards.** Colour identity, legality, singleton, the Game Changer cap, mass land denial and
  availability all remove a card, because a penalty could be outweighed. **Guidelines flag cards.** Spellbook calls its
  bracket tags "a guideline … rather than a strict classification", so combo and extra-turn rules flag a card and
  offer a cut; they never silently drop it.
- **Precomputed, not computed per request.** A request reads indexed rows and does small per-deck sums.
- **Displayed evidence is our own counts.** A score built mostly on EDHREC's numbers never shows them.
- **Every weight change is gated by the offline evaluation** (see Evaluation).

## Gaps to fix along the way

- `estimateBracket` is never passed `hasMassLandDenial` (`apps/web/src/lib/server/deck.ts`).
- `targetDecks` means two unrelated things: 100 in `app_config.commander_requests` and 60 in `app_config.archidekt`.
  Rename the first (`lookupDecks`).
- `include_in_corpus` checks per-card legality but not the 100-card count. The collator's one rule replaces it (T054).
- Recommendations use card ids only; collection quantities are ignored (T059).
- The Go crawl drops the author's declared bracket (`edhBracket`); the raw table has a column for it (T056).

## Scoring components

Notation:
- K: the deck's commander key.
- n: K's eligible decks for the card (release-aware, partners pooled as today); x: those running it.
- p0: the card's colour baseline rate.
- e: EDHREC's inclusion for the card under K (`decks_with / potential_decks`); N_e: its `potential_decks`.
- floor: the lowest inclusion K's EDHREC page lists; N_page: the page's deck count.
- α: `shrinkAlpha`; κcap: `edhrecPriorCap` (new, in `app_config.corpus`).

| Component | Used by | Formula | Null when |
|---|---|---|---|
| `corpus` | all | Below | Too few decks anywhere and no EDHREC page (today's rule) |
| `deck` | all | Deck affinity from pair PMI ([`card-graph-plan.md`](card-graph-plan.md)) | Until pair tables exist (T064) |
| `role` | add, cut, build | Largest shortfall among the roles the card fills (`roleGap`), against **learned** targets | No tracked roles |
| `curve` | add, cut, build | Shortfall in the card's mana value bucket against the commander's learned curve | No curve profile |
| `tag` | swap | Functional tag similarity to the card being replaced (`card_substitutes`) | — |
| `manaValue`, `staple`, `votes` | swap | Unchanged (`swap.ts`); votes per T006 | As today |

**`corpus`: one update, each source counted by its sample size.**

```
prior target t and strength s
  K's EDHREC page lists the card:           t = e                  s = min(N_e, κcap)
  K has a page that doesn't list it:        t = min(p0, floor)     s = min(N_page, κcap)
  K has no EDHREC page:                     t = p0                 s = α
incl     = (x + s·t) / (n + s)
syn      = incl − p0                         synergy is always against the colour baseline
evidence = n + s     with a page, else n
share    = commanderShare(evidence)          0 below minDecks, 1 from fullDecks (both 50)
corpus   = share·commanderCorpusScore({incl, syn}) + (1 − share)·√p0
```

- **It replaces `externalPriorShare` and the `max()` rule** with one shrinkage: each source counts in proportion to
  its decks, up to κcap for EDHREC.
- **Why sample size:** for the same commander EDHREC holds 91× our decks at the median (29× at the 10th percentile),
  and it still matched or beat 50 of our own decks in the 2026-09-28 test. A fixed share can't say "much more data".
- **Why κcap:** EDHREC counts many of the same decks, and our decks are newer and release-aware. Capping its weight
  lets our decks take over once n is well past κcap. κcap starts at 200 and is set by the evaluation (T061), not by
  hand.
- **Why the floor:** EDHREC lists about 270 cards per page whatever its size, so a card it leaves out is below that
  page's lowest listed rate (2.6–7.7% median, by size). Shrinking it toward p0 would overstate a card the
  commander's decks have mostly passed over.
- **Computed ahead** per commander and card by the precompute worker (`commander_card_scores`). A card with no row
  gets the same formula with x = 0, from `card_global_stats` and K's deck counts.
- **Displayed evidence** is x and n only.

**`role`** (exists; targets extended):
- `roleTargetsFor` blends generic targets toward the commander's `role_profile` by `commanderShare`.
- A commander with an EDHREC page gets a role prior: `profile_ext[role] = Σ e(c)` over the cards on its page that
  fill that role. Summed inclusion is the expected number of such cards per deck; it undercounts a little because
  pages are trimmed.
- The blend becomes our profile → EDHREC prior → generic, by evidence.

**`curve`** (new):
- `commander_stats` gains `curve_profile`: average nonland cards per deck in each mana value bucket, 0–1 up to 7+
  (`CURVE_TOP_MANA_VALUE` in `deck-stats.ts`). It also gains `land_count`: average lands per deck.
- `curve(c) = clamp01((h_K[b] − d[b]) / h_K[b])` for the card's bucket b, where d is the deck's current histogram.
  This is the same shape as `roleShortfalls`.
- EDHREC gives a prior: `Σ e(c)` per bucket.

### One marginal-value function

```
m(c | D) = blendScore( corpus(c), deck(c | D), role(c | D), curve(c | D) )      weights from app_config.scoring
```

- **Add:** rank the pool by m(c | D). Today's add score is exactly this with corpus 0.8, role 0.2 and no deck or curve
  terms (`ADD_WEIGHTS`), so adds change only as new components earn weight.
- **Build:** repeated adds. Pick the best m(c | picks), add it to the picks, repeat (Mode C).
- **Cut:** rank the deck's cards by m(c | D − c), lowest first: what the deck loses without the card.
  - Hard rules still come first as must-cuts: legality, identity, Game Changers over the cap, mass land denial below
    bracket 4.
  - Reasons come from the low components: `LOW_SYNERGY` (corpus below `lowSynergyScore`), `ROLE_REDUNDANT` (role need
    0 because its roles are overloaded), `HIGH_MANA_VALUE` (its bucket is above the commander's curve), and
    `LOW_AFFINITY` once pairs exist.
  - Checked against `scoreCuts`: today's optional cut score, 0.5·(1 − corpus) + 0.3·redundant + 0.2·relative mana
    value, is a hand-weighted form of the same three signals. The fixed "mana value 6 or more" rule becomes the learned
    curve, and the `WELL_PLAYED_SCORE` guard falls out because corpus dominates m. Cut precision@10 decides (T058).
- **Swap:** the pool is the target's `card_substitutes` (does the same job), ranked by a blend of `tag(r, t)` and
  m(r | D − t). "Does the same job" is the one thing a swap needs beyond a normal add; `manaValue`, `staple` and
  `votes` stay swap components until the evaluation says otherwise.
- Without play rates (corpus null), `blendScore` renormalises over the rest, as today's no-play-rate path does.

**Starting weights.** Moved into `app_config.scoring` as they are today (T057); new components only get weight once
the evaluation shows they help.

| Mode | corpus | deck | role | curve | tag | manaValue | staple | votes |
|---|---|---|---|---|---|---|---|---|
| add, cut, build | 0.8 | 0 → evaluated | 0.2 | 0 → evaluated | — | — | — | — |
| swap, any card | 0.2 | 0 → evaluated | — | — | 0.4 | 0.1 | 0.2 | 0.1 |
| swap, collection | 0.15 | 0 → evaluated | — | — | 0.55 | 0.1 | 0.1 | 0.1 |

### Combos: "Complete a combo"

A group of its own in Add results, not a score bonus. A bonus would saturate at the top of the scale and mix "how good
is this card here" with "what it unlocks".

- **Which combos:** from `spellbook_combo_pieces` for the deck's cards, the combos the deck is exactly one named card short of,
  whose commander requirement is met and whose minimum bracket is at or below the chosen one. Template pieces ("a
  Legendary Elemental Creature") can't be checked automatically, so they are listed as also needed.
- **Order:** by result (`app_config.scoring.comboResultWeight`: "Win the game" > infinite mana, damage or turns >
  other standalone results > contextual results), then by the missing card's m(c | D).
- **Each entry:** the missing card, the pieces already in the deck, the results, and a credited link to the combo's
  Spellbook page.
- **A combo piece is protected from `LOW_SYNERGY` cuts** while its combo is complete and allowed. Combo pieces often
  have low play rates on their own.

## Bracket rules

`estimateBracket` (`packages/core/src/formats/commander/bracket.ts`) today counts only Game Changers. It gains these
signals (`BracketSignals`):

| Signal | Source | Rule (values in `app_config.brackets`) | Kind |
|---|---|---|---|
| Game Changers | `cards.game_changer` | 0 in brackets 1–2, at most 3 in bracket 3 (`gameChangerLimit` today) | Hard |
| Mass land denial | Tagger's `mass-land-denial` tag, planeswalkers excluded (`app_config.brackets.massLandDenialTagIds`) | None below bracket 4 | Hard |
| Two-card combos | `spellbook_combo_pieces`; minimum bracket from Spellbook's tag: E 1, O 2, C 2, S 3, P 3, R 4; banned never | A combo whose minimum is above the chosen bracket is over the line. In bracket 3 that is exactly the R combos; no mana value rule | Flag, cut offered |
| Extra turns | Tagger's `extra-turn` tag, planeswalkers excluded (`extraTurnTagIds`); combos with an infinite-turns result | None in bracket 1; in brackets 2–3 at most `maxExtraTurnCards` (2), and no extra-turn loop | Flag, cut offered |
| Tutors | — | No limit (WotC, October 2025) | — |

- **Estimate:** the lowest bracket the deck fits, kept within 2–4 as today, because 1 against 2 and 4 against 5
  depend on intent.
- **Enforce:** hard rules remove candidates from adds and builds and are must-cut reasons. Flags show on the deck and
  in cuts (`OVER_BRACKET_COMBO`, `OVER_BRACKET_EXTRA_TURNS`). A suggested card that would complete a combo above the
  bracket says so.
- **Not estimated for every corpus deck.** With the `bracket` component dropped, only the evaluation needs a corpus
  deck's bracket, and it computes it there.

## Candidate pools

The pool decides which cards exist; the blend only orders them. So the pool must contain every card a mode could want.
Every source below is an indexed read of a serving table.

| Pool source | When | Size |
|---|---|---|
| Top by `corpus` score (`commander_card_scores`). EDHREC-listed cards are in it, since their scores come from the prior | Always | 400 (today) |
| Missing pieces of allowed combos (`spellbook_combo_pieces`) | Adds, builds | Every match |
| Pair neighbours of the deck's cards | Once pairs exist (T064) | [`card-graph-plan.md`](card-graph-plan.md) |
| **All available owned cards** in the colour identity | Collection modes | The whole owned pool; scoring them all is lookups, not a query |
| The target's `card_substitutes` | Swaps | The first 220 in every colour identity that can hold the card (T055: exactly today's swap lists) |

Hard filters apply in every pool: legal, inside the identity, not a basic land (lands are handled separately in
builds), not already in the deck, Game Changers and mass land denial per bracket, and availability.

## Availability

```
available(card) = owned copies of the card and its functional twins (same equivalence_base_id)
                − copies used in the player's other decks marked built
basic lands     = always available
```

- **Quantities matter now.** Today only card ids reach recommendations. Accounts read quantities from
  `my_collection_entries()`, and browser collections already store them.
- **Built decks.** New column `decks.is_built`, which the player sets ("I've put this deck together"). Only built
  decks hold cards. A list still being brewed holds nothing.
- **Conflicts.** A card the player owns but whose copies are all in built decks is still suggested, tagged
  `inDeck: {deckId, name, code}`. Tapping it opens swaps for that card **in that other deck**, so the player can free it
  up. Conflicts never count as available when a build is checked for feasibility.
- **Twins.** If the player owns Terramorphic Expanse and the recommendation is Evolving Wilds, the suggestion is the
  owned twin.

## Mode A: improve with the collection (priority)

- **Adds, cuts and swaps** score only available cards. Cuts keep `NOT_OWNED` for unowned cards in the deck.
- **Buy list**, shown separately and labelled as such:
  - For each add category, or each swap target, let `s_A` be the best available card's score.
  - An unowned card c joins the buy list when `s(c) − s_A ≥ buyMargin` (0.05 to start).
  - Buy-list cards are ranked by **value**: `(s(c) − s_A) / max(price(c), priceFloor)`, with `priceFloor` $0.25 to
    start.
  - Price comes from `card_stats.cheapest_usd` and is shown with `prices_checked_at()`.
- **Collection-mode swap weights:** `tag` 0.55 (today's `collection_aware`). An owned replacement has to do the same
  job, because the pool is smaller.
- **Default:** owned only, plus a buy list, whenever the player has a collection. "Owned first" stays available only
  if the evaluation or live data shows players want it (T037).

## Mode B: improve with any card

The same scorer and pools, with no availability filter and no buy list. This is today's collection-less path, plus
the new components and the EDHREC prior.

## Mode C: build from a commander and a bracket

**Inputs:** commander(s), bracket, the player's availability, and `fill` (`none`, or `value` to fill gaps with
affordable cards).

1. **Skeleton.**
   - Land count is `land_count` (ours → EDHREC prior → generic in `app_config.scoring`), and the basic land count is
     `basic_land_count` (ours → a generic count by colours in `app_config.scoring`; EDHREC's lists leave basics out).
   - Nonland slots = 99 − lands.
   - Role targets come from `roleTargetsFor` with the EDHREC prior; the curve comes from `curve_profile`.
   - Bracket limits come from `app_config.brackets`.
2. **Pool.** All available cards in the identity, plus the commander's corpus pool, intersected with availability.
3. **Greedy fill of the nonland slots.** Each step picks the card with the highest m(c | picks):
   - Each step skips any card that would break a hard rule: singleton, the Game Changer cap, mass land denial.
   - A card that would complete a combo or an extra-turn chain above the bracket is skipped too; a build is the one
     place a flag becomes a limit, since the player asked for that bracket.
   - Each pick updates the deck, so role, curve and affinity needs change with it.
   - Ties break on name, so builds are deterministic.
   - Filling stops when the best m falls below `qualityFloor` (0.35 to start).
4. **Lands.**
   - Nonbasic lands come first, ranked by corpus score and capped so the commander's learned basic land count
     remains.
   - Basics are then split by each colour's share of pips in the chosen spells' `mana_cost`.
5. **Feasibility report.** When slots or role targets are still open, say so plainly: "Your collection fills 81 of 99.
   Ramp is 4 short and removal 3 short." Offer `fill: value`.
6. **Value fill (on request).** Rerun steps 3–4 for the open slots over unowned cards.
   - Pick by `(m(c) − qualityFloor) / max(price, priceFloor)`.
   - Show a running total of the prices, with their as-of date.
7. **Output:** the 99 grouped like Add, each card with its components and evidence; the estimated bracket and its
   signals; the feasibility report; and "complete a combo" entries the build is one card short of, credited to
   Spellbook.

A local improvement pass may follow: try swapping each pick for the best unpicked card if the total rises. Add it only
if the evaluation shows it helps.

The build engine runs as a pure function in `@mtg/core` over loaded rows, so the evaluation and the regression harness
run it outside Next.js. The new `/deck` entry for it is T050's picker.

## Config and data this needs

| Change | Task |
|---|---|
| `app_config.scoring`: weights, `buyMargin` (0.05), `qualityFloor` (0.35), `priceFloor` (0.25), `comboResultWeight`, generic land and basic land counts by colours, `evalSeed`, `solRingTolerance`. `app_config.corpus.edhrecPriorCap` (200) | T057, T061 |
| `app_config.brackets`: Game Changer limits, `massLandDenialTagIds`, `extraTurnTagIds`, planeswalkers excluded, `maxExtraTurnCards` (0 in bracket 1, 2 in brackets 2–3) | T060 |
| Serving tables (`commander_card_scores`, `card_substitutes`, `card_roles`, `spellbook_combo_pieces`) and the request path | T055 ([`card-graph-plan.md`](card-graph-plan.md)) |
| `decks.is_built`, plus card quantities in recommendation requests | T059 |
| `commander_stats.curve_profile`, `land_count` and `basic_land_count`; EDHREC role and curve priors | T062 |
| Pair tables | T064 |
| `rec_events` (shown, accepted, declined), keyed like `swap_votes` | T065 |

Every write follows the existing rules: stage, sanity gate, diff-only merge, grants in the migration, and no
materialized views.

## Contract changes (designed, not built)

One version bump per task that touches the contract:
- `ScoreComponent` gains `deck` and `curve`.
- `CutReason` gains `OVER_BRACKET_COMBO`, `OVER_BRACKET_EXTRA_TURNS`, `OVER_BRACKET_MLD` and `LOW_AFFINITY`.
- `AddResult` gains `combos`: the "complete a combo" entries (missing card, pieces held, results, Spellbook link).
- `AddSuggestion` and `SwapSuggestion` gain `conflict?: {deckId, name, code}`.
- `AddResult` and `SwapResult` gain `buyList` (suggestions with `valueScore` and price).
- `OwnershipInput` carries quantities. `ownershipMode` defaults to `'only'` with a buy list.
- A new `BuildApi.build({commanderIds, bracket, ownership, fill})` returns
  `{deck, groups, combos, bracket, feasibility, fillCost?}`. Built as `RecsApi.build` (contract v24, T063): it shares the
  recommendation routes' transport and takes their `RecContext`.
- `DeckAnalysis` gains `combos` (pieces, results, Spellbook link) and `bracketSignals`. Display per T045.

## Evaluation

Built on `cli eval:holdout` (T058), over the collated `corpus.decks`. Reports go to `$MTG_DATA_DIR/reports` and the
run's log.

**Built 2026-10-06** (T058, `apps/worker/src/jobs/eval-holdout.ts`; settings in `app_config.scoring.eval`). The baseline
and what each test does are in [`../tasks.md`](../tasks.md) (T058). The time split for the EDHREC prior comes with T061.

- **Split** `corpus.decks` 90/10 **by deck** with a fixed seed (`app_config.scoring.evalSeed`), and build the stats from
  the 90% only.
- **Time split for anything EDHREC touches.** EDHREC's numbers already include many of our decks, so tests of the
  prior hold out only decks updated after the EDHREC snapshot.
- **Size buckets** by the commander's training decks: 50 and up, 10–49, under 10. The last two test the prior. A
  holdout can't test a commander that has five decks, so the small buckets are simulated, as `spike:edhrec:prior`
  did: commanders with plenty of decks keep only 0, 5, 10 or 20 of their training decks. (300 and up can't occur at
  today's crawl depth.)

| Test | Method | Metric |
|---|---|---|
| Improve (adds) | Hide 10 nonland cards from each held-out deck | recall@20 by size bucket; "Sol Ring rate" (share of hits that are generic staples) |
| Cuts | Add 10 identity-legal cards taken from other commanders' decks | precision@10 of the cuts |
| Collection mode | Synthetic collection: the hidden cards plus a random sample of other cards drawn by global popularity | recall@20 of the hidden cards from owned-only adds; how many buy-list entries are hidden cards |
| Build | Build for the commander and estimated bracket of each held-out deck, with every card available | Mean overlap with held-out decks for the same commander; error in role counts and land count |
| Bracket estimator | Compare with the declared bracket in `archidekt.decks` | Agreement matrix (a sanity check only; declared brackets never score) |
| EDHREC agreement | The built 99 against the commander's EDHREC cards by inclusion | Overlap. Reported, never shown |
| Live accept rate | `rec_events` | Accepted ÷ shown per mode, rank and component mix. Watched after each release |

**Gate.** A weight or formula change ships only if all of these hold:
1. Overall recall@20 rises, and the 95% bootstrap interval of the change (1,000 resamples over commanders, fixed seed)
   lies above zero.
2. No size bucket falls by more than its own bootstrap half-width.
3. The Sol Ring rate rises by no more than `solRingTolerance`.
4. The regression fixtures (`yarn workspace @mtg/web regress`) still pass.

**`rec_events`:**
- One row per shown batch (the card ids in order, mode, commander ids and bracket), plus one row per accept or decline.
- Keyed by `auth.uid()` or the salted visitor hash, exactly like `swap_votes`.
- Written through a rate-limited security-definer function.
- RLS on, with no API reads.
- `/privacy` gains a line saying suggestions shown and accepted are recorded to improve recommendations. There is no
  opt-out, the same as swap votes (owner, 2026-10-05).

## Roadmap

Each task is one PR into `develop`, gated by the evaluation from T058 on. Speed comes first, then the priority mode.

| # | Task | What | Needs | Done when |
|---|---|---|---|---|
| 1 | T053 | **Data layers:** schemas and table moves; PR #127 reworked into `spellbook` | Hosted migration history repaired | Migrations apply from scratch; the crawl runs unchanged |
| 2 | T054 | **Collator**, every source including complete user decks; `sync:edhrec` into raw (from PR #128) | T053 | `corpus.decks` holds every raw deck that passes the rule; `aggregate:corpus` reads it |
| 3 | T055 | **Precompute worker and request path**; the rec SQL functions retire | T054 | Same add and swap lists as before; p95 add latency down on hosted; T008 closed |
| 4 | T057 | Weights and thresholds into `app_config.scoring` | — | Regression fixtures unchanged |
| 5 | T058 | Offline evaluation with the seeded bootstrap gate | T054, T057 | Baseline report recorded |
| 6 | T061 | **EDHREC prior by sample size**, κcap from the evaluation | T055, T058 | The 10–49 and under-10 buckets rise; none falls |
| 7 | T059 | **Collection mode:** quantities, twins, `decks.is_built`, conflicts, owned-only default, buy list | T055, T057 | Collection-mode recall recorded; buy list shown with price and date |
| 8 | T060 | **Bracket rules and combos:** `app_config.brackets`, `estimateBracket` signals, the combo group, new cut reasons, `DeckAnalysis.combos` | T053, T055; display per T045 | Estimator agreement reported; combo group credited and linked |
| 9 | T062 | **Learned skeleton:** curve and land profiles, EDHREC role and curve priors | T055, T058 | `curve` passes the gate |
| 10 | T064 | **Deck affinity:** pair tables and the `deck` component | T055, T058 | Recall@20 beats the T058 baseline |
| 11 | T063 | **Build mode:** `BuildApi`, greedy fill, feasibility report, value fill | T059, T060, T062 | Build overlap and role error reported; T050's picker lands in it |
| — | T056 | **Crawl growth:** revisits read on until 25 decks were new or changed; declared brackets in raw | — | Anytime |
| — | T065 | **Live accept rate:** `rec_events`, `/privacy` line | — | Anytime |

Existing tasks this affects:
- **T007** is reframed: price ranks the buy list and value fill, and is not a score component.
- **T037** is resolved: owned only becomes the default.
- **T047** becomes T060's data source.
- **T008** closes with T055, and **T040** becomes moot (both rec SQL functions retire).
- **T006** (votes) and **T022** (play rate lifting weak tag matches; the gate's fixtures cover it) are unchanged.
  **T020** is superseded by T064.
- **T035** owns the pipeline; **T045–T048** own the analysis display; **T050** is the entry point for build mode.

## Owner answers (2026-10-05)

The design's open questions, answered:

1. **Early combos in bracket 3: Spellbook's R tag alone.** Spellbook tags a "probably very fast" two-card combo R
   (Ruthless) and a "slow but relevant" one P (Powerful), which is WotC's early-against-late line already, so no mana
   value rule is added. The general rule (flag a combo whose minimum bracket is above the chosen one) flags exactly the
   R combos in bracket 3.
2. **Mass land denial and extra turns: Tagger's tags, planeswalkers excluded; at most 2 extra-turn cards in brackets
   2–3.**
   - Tags: `mass-land-denial` (`cd12a44c-1aee-4ece-b8ea-3eb118ef0230`, 112 cards) and `extra-turn`
     (`03b17ebf-f5d3-4063-bfd4-1ae156a16a8f`, 60 cards). Neither has child tags today.
   - Planeswalkers are left out because their land denial or extra turn is an ultimate: Liliana of the Veil, Liliana,
     Dreadhorde General, Dovin Baan, Ajani Vengeant, and Gideon, Champion of Justice on the land denial side.
   - Limits follow WotC: no mass land denial in brackets 1–3; no extra-turn cards in bracket 1; in brackets 2–3, "low
     quantities" becomes at most 2 and never chained or looped.
   - Measured on about 73,000 crawled decks (2026-10-05, planeswalkers excluded): 5.6% hold a mass land denial card, 11.5%
     hold an extra-turn card, and 1.1% hold three or more extra-turn cards.
3. **Starting values: placeholders the evaluation retunes.** `buyMargin` 0.05 (an unowned card must beat the best
   owned one by 5 points), `qualityFloor` 0.35 (where cuts call a card low synergy) and `priceFloor` $0.25 (bulk).
   There is no fixed `minBasics`: each commander's basic land count is learned from its decks like its land count, with
   a generic count by colours for commanders without decks. T058's evaluation retunes them all.
4. **Accept events: a `/privacy` line, no opt-out**, the same as swap votes.
