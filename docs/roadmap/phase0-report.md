# Phase 0 report (2026-09-14)

Local only. This covers the Phase 0 spikes and what the numbers mean for the plan's go/no-go criteria.

## Decision: go

| Criterion (plan §8) | Kill threshold | Result | Verdict |
|---|---|---|---|
| Tag coverage | < 70% of Commander-legal non-land cards carry ≥ 1 tag | 99.4% (30,520 of 30,718); 99.9% of cards released in the last 180 days | Pass |
| Tag swap quality | < 60% of cases with ≥ 3/5 acceptable (blind raters) | Not measured. Two raters weren't available; a regression set of real-deck expectations stands in for now | Open |
| Corpus depth | > half of the top 50 commanders under 50 qualifying decks | 0 of 50 (all ≥ 290 decks) | Pass |
| Corpus throughput | < 20,000 qualifying decks per day | 49,900–53,300 per day at one request per 1.5 s, 0 retries | Pass |
| Ranking stability | Spearman ρ < 0.8 at n = 300 | Split-half median ρ over the top-50 synergy ranking: 0.70 at n = 50, 0.83 at n = 100 | Pass |

## Card tags (Scryfall Tagger, Oracle Tags bulk)

- 4,534 tags, 232,619 taggings over 36,092 oracle cards; hierarchy is 922 roots, max depth 7, no cycles.
- `weight` is a string and almost always "median" (232,006), so it carries little signal. The model uses idf and hierarchy distance instead (λ = 0.5 per step, depth ≤ 2).
- 548 parent tags have their own direct taggings, and many broad tags are trivia or meta ("alliteration", "triggered ability").
- "Does the same job" uses an allowlist of 107 functional root tags plus descendants, minus descendants of 10 denied trivia roots.
- Swap similarity: 0.5 × idf-weighted exact-tag match + 0.5 × shared functional roles, with a floor of 0.25.

## Deck corpus (Archidekt)

- **Access:**
  - Staff permit reading the API (forum thread 40353). The Terms of Use restrict use to personal, noncommercial access, so the project stays a noncommercial hobby until written permission exists.
  - Requests go one at a time with an honest User-Agent, 1.5 s apart. A 429 pauses the crawl for minutes and doubles the spacing.
- **Stored:** 15,247 qualifying 100-card decks as slim oracle-id records on X: (never in Postgres). There are 300 per commander for the top 50 commanders by update rate, plus Liesa, Forgotten Archangel. Decks were taken most viewed first.
- **Counted:** 15,037 decks. Excluded: 145 invalid commander pairs, 53 with too many commanders, 11 with cards outside identity, 1 illegal commander.
- **Recency:** 77% last updated in 2026, 13% in 2025. Most-viewed first did not make the corpus stale.
- **Brackets:** 61% unset; B3 2,727, B4 1,856, B2 954, B5 301, B1 31. Too thin for bracket-specific stats yet.
- **Rate-limit incident:** TaskStop killed shells but not their Node children, so two or three crawl processes ran at once (about 2–3 requests per second) and drew 429s. A single process at 1 request per second had none. Stopped tasks are now checked for leftover node.exe processes.

## Thresholds and scoring recorded (app_config and @mtg/core/scoring)

- **Corpus settings:** shrinkAlpha 20, minDecks 50, fullDecks 100 (the plan's prior was 300), maxUnresolvedCards 3.
- **Play rates:**
  - Each card counts only against decks updated in or after its first printing month. `cards.released_at` is the latest printing, which made Sol Ring look new.
  - Inclusion is shrunk toward the card's baseline over decks its colors allow; synergy = shrunk inclusion − baseline.
  - Commander play-rate score: 0.6·(0.5 + 0.5·clip(synergy/0.3)) + 0.4·√inclusion. Baseline-only score: √baseline at half weight.
  - The weight ramps from minDecks to fullDecks.
  - Cards too new to judge get the median of the other candidates' scores, neither buried nor promoted.
- **Swaps:** tag 0.4, mana value 0.1, staple 0.2, corpus 0.2, votes 0.1 (collection-less), renormalized over the components that have data.
- **Cards to add:** corpus 0.8, role gap 0.2. Grouped by the front face's card type.
- **Cuts:**
  - Rule problems score 1.
  - With commander data, a cut scores 0.5·(1 − play rate) + 0.3·role overload + 0.2·relative mana value. Low synergy is below 0.35.
  - Cards scoring ≥ 0.5 aren't flagged for cost or role overlap.
- **Role targets:** move from the generic targets toward the commander's own average per role. Liesa decks, for example, run 15.8 removal against a generic 9.

## Real-deck test: Liesa, Forgotten Archangel (user's deck)

Found and fixed:

1. **Decklist parsing.** A Moxfield "// COMMANDER" export put all 77 lines in the command zone.
2. **Swap sheet wording.** It credited color-wide play rates to the commander.
3. **New cards.** They were judged against decks built before they existed.
4. **Cards to add.** Role gaps lifted rarely played cards (3%) over staples (31%).
5. **Invalid commander pairs.** Companions filed as commanders created bogus keys.
6. **Removal and board wipes flagged redundant.** This came from generic role targets; 11 flags dropped to 0 with role profiles.

## Data sources

- **Outreach (updated 2026-09-14):** all three Phase 0 emails (Moxfield, Archidekt, Scryfall) have been sent by the user; replies pending.
- **Scryfall:** bulk data and CDN images.
- **Archidekt:** read access per staff; noncommercial until written permission (requested).
- **Moxfield:** needs a User-Agent whitelisted by support behind Cloudflare; whitelist requested, no access until it's granted.
- **EDHREC:** excluded. Its terms forbid automated queries, and the brief rules it out.

## Open items and risks

- **Tag swap quality:** blind-rater eval not run; the regression set is a partial stand-in.
- **Partner pairs fragment:** Rograkh is split across many pairs. Pairs below minDecks borrow each partner's solo decks.
- **Play rate can amplify a weak tag match:** Reliquary Tower tops Sea Gate Restoration swaps at 51% play rate after a 0.65 tag score.
- **The commander ranking favors recent sets:** it is based on update rate.
- **Swaps take about 1.5 s** with corpus lookups; collection-less results need caching before launch.
- **The sample deck's commander (Chulane) has no corpus decks,** so the in-app demo shows only fallbacks.
- **Invalid-pair commander_keys rows** remain without stats (ids are kept stable).

## Commits on phase0/scaffold

- 74f026c: Archidekt corpus spike crawler
- 21cce5c: corpus aggregation into commander play-rate stats
- 2f9fd5d: swaps ranked with deck play rates; stability thresholds
- cc0f5da: cards to add and cut from play rates; parser fix; evidence scope; named-commander crawl
- e57d04e: release-aware play rates, neutral score for new cards, add weights, partner-pair exclusion
- aaad31e: per-commander role profiles
