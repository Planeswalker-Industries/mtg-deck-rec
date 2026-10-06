import type {
  AddSuggestion,
  BuyAddSuggestion,
  BuySwapSuggestion,
  BuyValue,
  CardCategory,
  CardSummary,
  CorpusConfidence,
  CorpusEvidence,
  CostDelta,
  CutResult,
  CutSuggestion,
  DeckConflict,
  OwnedInfo,
  RecContext,
  RecMode,
  ScoreBreakdown,
  SwapResult,
  SwapSuggestion,
  TagMatch,
  TagRef,
} from '../contract';
import { isOwnedStatus, type Availability } from '../collection/availability';
import { fitsIdentity, gameChangerLimit } from '../formats/commander';
import { cardCategory, roleGap, roleShortfalls } from './add';
import type { CorpusSettings, ScoringConfig } from './config';
import { commanderCorpusScore, commanderShare, corpusComponent, neutralCorpusValue, type CommanderCardRate } from './corpus';
import { scoreCuts, type RoleTarget } from './cut';
import { ownedOnly, rankKey } from './owned';
import { blendScore, manaValueProximity } from './swap';

/**
 * Ranking for adds, cuts and swaps (T057): pure functions over loaded rows, so the web app, the regression fixtures and
 * the offline evaluation all rank with the same code. Every weight and threshold comes from `ScoringConfig`.
 */

/** A card as ranking reads it: what is shown, plus the facts the rules check. */
export interface RankCard {
  summary: CardSummary;
  /** Colour identity bitmask. */
  colorIdentity: number;
  /** Legal in Commander. */
  legal: boolean;
  isBasicLand: boolean;
}

/** A card's play rates under the deck's commanders. */
export interface CardPlayRates {
  /** Share of eligible corpus decks (the card's colours allow it, updated since its release) that run it. */
  baseline: number;
  baselineDeckCount: number;
  /** The commander's decks that could have run the card (colours allow it, updated since its release), at their weights. */
  commanderDeckCount: number;
  /** The commander's decks, shrunk toward the prior; null when none could have run the card and there is no prior. */
  commanderRate: CommanderCardRate | null;
  /** An external source (EDHREC) publishes a rate for this card under this commander, and it shaped `commanderRate`. */
  hasExternalPrior: boolean;
  /** Marked limited when too few decks, anywhere, could have run the card. */
  evidence: CorpusEvidence;
}

/** What ranking needs to know about the deck's commanders' corpus. */
export interface RankCorpus {
  settings: CorpusSettings;
  confidence: CorpusConfidence;
  /** Own decks plus borrowed decks at their weight. */
  effectiveDeckCount: number;
  /** Average cards per deck in each tracked role (by role tag id). */
  roleProfile: Readonly<Record<string, number>>;
}

/** How many widely played candidates a request scores before grouping cards to add (the app and the evaluation). */
export const ADD_POOL_SIZE = 400;

/** Card-to-add groups in display order. */
export const ADD_CATEGORIES: readonly CardCategory[] = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'];

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const frontType = (typeLine: string) => typeLine.split(' // ')[0] ?? typeLine;

/** No owned twins loaded: a card only an owned twin could supply counts as unowned. */
const NO_STAND_INS: ReadonlyMap<number, RankCard> = new Map();

export const modeOf = (ctx: RecContext): RecMode => (ctx.ownership ? 'collection_aware' : 'collection_less');
/** The deck's main cards, once each. */
export const mainDeckIds = (ctx: RecContext): number[] => [
  ...new Set(ctx.deck.cards.filter((c) => c.section === 'main').map((c) => c.cardId)),
];

/**
 * Role targets for this deck: the generic targets, moved toward how many cards the commander's decks actually run in
 * each role as those decks gain weight. Liesa decks, for one, run far more removal than a generic deck.
 */
export function roleTargetsFor(generic: readonly RoleTarget[], corpus: RankCorpus): RoleTarget[] {
  const share = commanderShare(corpus.effectiveDeckCount, corpus.settings);
  if (share === 0) return [...generic];
  return generic.map((t) => {
    const typical = corpus.roleProfile[t.roleId];
    return typical === undefined ? t : { ...t, target: Math.round((share * typical + (1 - share) * t.target) * 10) / 10 };
  });
}

/** What a collection makes of a card in a suggestion. */
interface Owning {
  /** The card to show: the card itself, or an owned twin standing in for it. */
  summary: CardSummary;
  owned: OwnedInfo | null;
  conflicts?: DeckConflict[];
  /** The collection supplies it: a copy is free, every copy is in a built deck, or it is a basic land. */
  supplied: boolean;
}

const unowned = (summary: CardSummary): Owning => ({ summary, owned: null, supplied: false });

function owningOf(card: RankCard, availability: Availability | null, standIns: ReadonlyMap<number, RankCard>): Owning {
  if (!availability) return unowned(card.summary);
  const a = availability.of(card.summary.id, card.isBasicLand);
  if (a.status === 'unowned') return unowned(card.summary);
  if (a.status === 'basic') return { summary: card.summary, owned: a.owned > 0 ? { quantity: a.owned } : null, supplied: true };
  let summary = card.summary;
  let owned: OwnedInfo = { quantity: a.owned };
  if (a.cardId !== card.summary.id) {
    // An owned twin stands in. Without its row there is nothing to show, so the card counts as unowned.
    const twin = standIns.get(a.cardId);
    if (!twin) return unowned(card.summary);
    summary = twin.summary;
    owned = { quantity: a.owned, standsInFor: { id: card.summary.id, name: card.summary.name } };
  }
  return a.status === 'conflict' ? { summary, owned, conflicts: a.decks, supplied: true } : { summary, owned, supplied: true };
}

/** Keeps each shown card once, at its first (best) place: a card and the twin standing in for it show as one. */
function onceEach<T extends { card: CardSummary }>(sorted: readonly T[]): T[] {
  const seen = new Set<number>();
  return sorted.filter((s) => !seen.has(s.card.id) && seen.add(s.card.id));
}

/**
 * The buy list (scoring-design.md, "Mode A"): unowned cards scoring at least `buyMargin` above the best card the
 * collection supplies for the same slot (0 when it supplies none), ranked by gain per dollar with prices under the floor
 * counted as the floor. Cards without a price come after priced ones, by gain.
 */
export function buyList<T extends { card: CardSummary; score: ScoreBreakdown }>(
  candidates: readonly T[],
  bestSupplied: (candidate: T) => number,
  settings: ScoringConfig['collection'],
): (T & BuyValue)[] {
  return candidates
    .flatMap((c): (T & BuyValue)[] => {
      const gain = round3(c.score.total - bestSupplied(c));
      if (gain < settings.buyMargin) return [];
      const usd = c.card.price?.usd;
      return [{ ...c, gain, valueScore: usd === undefined ? null : round3(gain / Math.max(usd, settings.priceFloorUsd)) }];
    })
    .sort((a, b) => {
      if ((a.valueScore === null) !== (b.valueScore === null)) return a.valueScore === null ? 1 : -1;
      return (b.valueScore ?? 0) - (a.valueScore ?? 0) || b.gain - a.gain || a.card.name.localeCompare(b.card.name);
    })
    .slice(0, settings.buyListSize);
}

/** Whether the collection holds the card (available, a conflict or a basic land); false without a collection. */
const ownsWith = (availability: Availability | null) => (cardId: number) =>
  availability !== null && isOwnedStatus(availability.of(cardId));

export function costDelta(target: CardSummary, replacement: CardSummary, owns: (cardId: number) => boolean): CostDelta {
  const targetUsd = target.price?.usd;
  const replacementUsd = replacement.price?.usd;
  const asOf = replacement.price?.asOf ?? target.price?.asOf ?? null;
  if (owns(replacement.id) && owns(target.id)) return { usd: 0, basis: 'both_owned', asOf };
  if (owns(replacement.id)) {
    return targetUsd === undefined
      ? { usd: null, basis: 'price_unavailable', asOf: null }
      : { usd: -targetUsd, basis: 'owned_replacement', asOf };
  }
  if (targetUsd === undefined || replacementUsd === undefined) return { usd: null, basis: 'price_unavailable', asOf: null };
  return { usd: round2(replacementUsd - targetUsd), basis: 'buy_replacement_vs_buy_target', asOf };
}

const identityMaskOf = (ctx: RecContext, cards: ReadonlyMap<number, RankCard>) =>
  ctx.deck.commanders.reduce((mask, id) => mask | (cards.get(id)?.colorIdentity ?? 0), 0);

/** Cuts for a deck: rule problems first, then the cards the commander's decks run least. */
export function rankCuts({
  context,
  cards,
  rates,
  roles,
  corpus,
  roleTargets,
  scoring,
  availability,
  limit,
}: {
  context: RecContext;
  /** The deck's main cards and its commanders. */
  cards: ReadonlyMap<number, RankCard>;
  rates: ReadonlyMap<number, CardPlayRates>;
  roles: ReadonlyMap<number, readonly string[]>;
  corpus: RankCorpus;
  /** The generic targets; the commander's role profile moves them (`roleTargetsFor`). */
  roleTargets: readonly RoleTarget[];
  scoring: ScoringConfig;
  /** The player's collection; null without one. */
  availability: Availability | null;
  limit: number;
}): CutResult {
  const mainIds = mainDeckIds(context);
  // Play rates judge a cut only once enough of the commander's decks could have run the card (updated since its
  // release); broad popularity says little about fit, and new cards aren't judged by older decks.
  const commanderRateFor = (id: number) => {
    const r = rates.get(id);
    return r?.commanderRate && commanderShare(r.commanderDeckCount, corpus.settings) > 0 ? r : null;
  };
  const identityMask = identityMaskOf(context, cards);
  const scored = scoreCuts(
    mainIds.flatMap((id) => {
      const card = cards.get(id);
      if (!card) return [];
      const rate = commanderRateFor(id)?.commanderRate;
      return [
        {
          cardId: card.summary.id,
          manaValue: card.summary.manaValue,
          isLand: /\bLand\b/.test(frontType(card.summary.typeLine)),
          isCommanderLegal: card.legal,
          withinIdentity: context.deck.commanders.length === 0 || fitsIdentity(card.colorIdentity, identityMask),
          gameChanger: card.summary.gameChanger,
          roleIds: [...(roles.get(id) ?? [])],
          // Basic lands aren't in the corpus stats, so they'd all look unplayed.
          corpusScore: rate && !card.isBasicLand ? commanderCorpusScore(rate, scoring.corpus) : null,
        },
      ];
    }),
    {
      includeGameChangers: context.includeGameChangers,
      gameChangerLimit: gameChangerLimit(context.bracket),
      roleTargets: roleTargetsFor(roleTargets, corpus),
      severeSynergyScore: corpus.settings.severeSynergyScore,
      scoring: scoring.cuts,
    },
  );

  const suggestions = scored.slice(0, limit).flatMap((s): CutSuggestion[] => {
    const card = cards.get(s.cardId);
    if (!card) return [];
    const a = availability?.of(s.cardId, card.isBasicLand) ?? null;
    // Only 'only' mode flags unowned cards: in 'first' mode the collection is a preference, not a rule. A basic land, or
    // a card an owned twin can stand in for, is never unowned.
    const notOwned = a?.status === 'unowned' && ownedOnly(context);
    const ownCopies = a && a.status !== 'unowned' && (a.status === 'basic' || a.cardId === s.cardId) ? a.owned : 0;
    return [
      {
        card: card.summary,
        cutScore: s.cutScore,
        reasons: notOwned ? [...s.reasons, 'NOT_OWNED'] : s.reasons,
        severity: s.severity,
        corpus: commanderRateFor(s.cardId)?.evidence ?? null,
        owned: ownCopies > 0 ? { quantity: ownCopies } : null,
      },
    ];
  });
  return { mode: modeOf(context), confidence: corpus.confidence, suggestions };
}

/** Cards to add in display groups, and in 'only' mode the cards worth buying. */
export interface AddRanking {
  groups: { category: CardCategory; suggestions: AddSuggestion[] }[];
  buyList?: BuyAddSuggestion[];
}

/**
 * Cards to add, grouped by type: what decks with this commander run, scored by play rate and by the roles the deck is
 * short on. In 'only' mode the groups hold what the collection supplies and the unowned cards that would do clearly
 * better go to the buy list; in 'first' mode owned cards move up by `ownedBoost`.
 */
export function rankAdds({
  context,
  poolIds,
  cards,
  rates,
  roles,
  corpus,
  roleTargets,
  roleTags,
  ownedBoost,
  scoring,
  availability,
  standIns = NO_STAND_INS,
  limitPerCategory,
}: {
  context: RecContext;
  /** The pool's card ids: in 'only' mode the collection's pool and the open pool together, for the buy list. */
  poolIds: readonly number[];
  /** The pool's cards. */
  cards: ReadonlyMap<number, RankCard>;
  rates: ReadonlyMap<number, CardPlayRates>;
  /** The deck's main cards' roles and the pool's. */
  roles: ReadonlyMap<number, readonly string[]>;
  corpus: RankCorpus;
  roleTargets: readonly RoleTarget[];
  /** The tracked roles' tags, for naming the roles a card fills. */
  roleTags: ReadonlyMap<string, TagRef>;
  ownedBoost: number;
  scoring: ScoringConfig;
  /** The player's collection; null without one. */
  availability: Availability | null;
  /** Rows for owned cards that may stand in for a twin (`Availability.standInIds`). */
  standIns?: ReadonlyMap<number, RankCard>;
  limitPerCategory: number;
}): AddRanking {
  const only = availability !== null && ownedOnly(context);
  const deckRoleCounts = new Map<string, number>();
  for (const id of mainDeckIds(context)) for (const role of roles.get(id) ?? []) deckRoleCounts.set(role, (deckRoleCounts.get(role) ?? 0) + 1);
  const shortfalls = roleShortfalls(deckRoleCounts, roleTargetsFor(roleTargets, corpus));
  const roleLabels = new Map(roleTargets.map((t) => [t.roleId, t.label]));

  const scoredPool = poolIds.map((cardId) => {
    const r = rates.get(cardId);
    const corpusScore = corpusComponent(
      {
        commanderRate: r?.commanderRate ?? null,
        commanderDeckCount: r?.commanderDeckCount ?? 0,
        baseline: r?.baseline ?? 0,
        baselineDeckCount: r?.baselineDeckCount ?? 0,
        hasExternalPrior: r?.hasExternalPrior ?? false,
      },
      corpus.settings,
      scoring.corpus,
    );
    return { cardId, rates: r, corpusScore };
  });
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue(
    scoredPool.flatMap((p) => (p.corpusScore ? [p.corpusScore.value] : [])),
    scoring.corpus,
  );

  const scored = scoredPool.flatMap(({ cardId, rates: r, corpusScore }) => {
    const card = cards.get(cardId);
    if (!card) return [];
    const { gap, roleIds } = roleGap([...(roles.get(cardId) ?? [])], shortfalls);
    const owning = owningOf(card, availability, standIns);
    const suggestion: AddSuggestion = {
      card: owning.summary,
      category: cardCategory(card.summary.typeLine),
      score: blendScore(
        { tag: null, manaValue: null, staple: null, corpus: round2(corpusScore?.value ?? neutralCorpus), votes: null, role: round2(gap) },
        scoring.weights.add,
      ),
      corpus: r?.evidence ?? null,
      fillsRoles: roleIds.flatMap((id): TagRef[] => {
        const tag = roleTags.get(id);
        return tag ? [{ ...tag, label: roleLabels.get(id) ?? tag.label }] : [];
      }),
      owned: owning.owned,
      ...(owning.conflicts ? { conflicts: owning.conflicts } : {}),
    };
    return [{ suggestion, supplied: owning.supplied }];
  });
  const listed = (only ? scored.filter((s) => s.supplied) : scored).map((s) => s.suggestion);

  const groups = ADD_CATEGORIES.map((category) => ({
    category,
    suggestions: onceEach(
      listed
        .filter((s) => s.category === category)
        .sort((a, b) => rankKey(b.score.total, b.owned !== null, ownedBoost) - rankKey(a.score.total, a.owned !== null, ownedBoost)),
    ).slice(0, limitPerCategory),
  })).filter((g) => g.suggestions.length > 0);
  if (!only) return { groups };

  const best = new Map<CardCategory, number>();
  for (const s of listed) best.set(s.category, Math.max(best.get(s.category) ?? 0, s.score.total));
  const candidates = scored.filter((s) => !s.supplied).map((s) => s.suggestion);
  return { groups, buyList: buyList(candidates, (c) => best.get(c.category) ?? 0, scoring.collection) };
}

export interface SwapPoolCandidate {
  cardId: number;
  card: RankCard;
  tagSimilarity: number;
  stapleScore: number;
  functionalTwin: boolean;
  matchedTags: TagMatch[];
  rates: CardPlayRates | null;
}

/** Everything a swap needs that doesn't depend on the rest of the deck, so it can be shared across decks and cached. */
export interface SwapPool {
  target: RankCard;
  tagCount: number;
  corpus: RankCorpus;
  candidates: SwapPoolCandidate[];
}

/** Each card once, the first pool's row first. */
function mergeCandidates(first: readonly SwapPoolCandidate[], second: readonly SwapPoolCandidate[]): SwapPoolCandidate[] {
  const ids = new Set(first.map((c) => c.cardId));
  return [...first, ...second.filter((c) => !ids.has(c.cardId))];
}

/**
 * Ranks a swap pool for one deck: leaves out the deck's own cards, then blends scores. In 'only' mode the suggestions
 * are what the collection supplies (the pool read for it) and the unowned cards of `buyPool` (the pool everyone gets)
 * that would do clearly better go to the buy list; in 'first' mode owned cards move up by `ownedBoost`.
 */
export function rankSwaps(
  pool: SwapPool,
  {
    context,
    limit,
    ownedBoost,
    scoring,
    availability = null,
    standIns = NO_STAND_INS,
    buyPool = null,
  }: {
    context: RecContext;
    limit: number;
    ownedBoost: number;
    scoring: ScoringConfig;
    /** The player's collection; null without one. */
    availability?: Availability | null;
    /** Rows for owned cards that may stand in for a twin (`Availability.standInIds`). */
    standIns?: ReadonlyMap<number, RankCard>;
    /** 'only' mode: the unfiltered pool the buy list is drawn from. */
    buyPool?: SwapPool | null;
  },
): SwapResult {
  const only = availability !== null && ownedOnly(context);
  const mode = modeOf(context);
  const target = pool.target.summary;
  const inDeck = new Set<number>([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)]);
  const candidates = (only && buyPool ? mergeCandidates(pool.candidates, buyPool.candidates) : pool.candidates).filter(
    (c) => !inDeck.has(c.cardId) && c.tagSimilarity >= scoring.swap.tagSimilarityFloor,
  );
  const owns = ownsWith(availability);

  // undefined: no corpus loaded at all. null: too new to judge by play rates.
  const corpusScores = new Map(
    candidates.map((c) => {
      const score = c.rates
        ? corpusComponent(
            {
              commanderRate: c.rates.commanderRate,
              commanderDeckCount: c.rates.commanderDeckCount,
              baseline: c.rates.baseline,
              baselineDeckCount: c.rates.baselineDeckCount,
              hasExternalPrior: c.rates.hasExternalPrior,
            },
            pool.corpus.settings,
            scoring.corpus,
          )
        : undefined;
      return [c.cardId, score] as const;
    }),
  );
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue(
    [...corpusScores.values()].flatMap((s) => (s ? [s.value] : [])),
    scoring.corpus,
  );
  // The collection-aware weights are for choosing among owned cards alone. 'first' ranks every card, so it keeps the
  // everyday weights and differs from a collection-less ranking only by the owned boost.
  const baseWeights = scoring.weights.swap[only ? 'collection_aware' : 'collection_less'];

  const scored = candidates.map((c) => {
    const card = c.card.summary;
    const owning = owningOf(c.card, availability, standIns);
    const known = corpusScores.get(c.cardId);
    const corpusScore = known === null ? { value: neutralCorpus, weightScale: scoring.corpus.baselineWeight } : (known ?? null);
    const suggestion: SwapSuggestion = {
      card: owning.summary,
      functionalTwin: c.functionalTwin,
      matchedTags: c.matchedTags,
      corpus: c.rates?.evidence ?? null,
      votes: { score: 0.5, voteCount: 0, myVote: null },
      costDelta: costDelta(target, owning.summary, owns),
      owned: owning.owned,
      ...(owning.conflicts ? { conflicts: owning.conflicts } : {}),
      score: blendScore(
          {
            tag: round2(c.tagSimilarity),
            manaValue: round2(manaValueProximity(card.manaValue, target.manaValue, scoring.swap.manaValueFalloff)),
            staple: round2(c.stapleScore),
            corpus: corpusScore ? round2(corpusScore.value) : null,
            votes: null,
            role: null,
          },
          corpusScore ? { ...baseWeights, corpus: baseWeights.corpus * corpusScore.weightScale } : baseWeights,
        ),
    };
    return { suggestion, supplied: owning.supplied };
  });
  const listed = (only ? scored.filter((s) => s.supplied) : scored).map((s) => s.suggestion);
  const suggestions = onceEach(
    listed.sort((a, b) => rankKey(b.score.total, b.owned !== null, ownedBoost) - rankKey(a.score.total, a.owned !== null, ownedBoost)),
  ).slice(0, limit);

  const result: SwapResult = { mode, target, confidence: pool.corpus.confidence, suggestions };
  if (only) {
    const best = listed.reduce((max, s) => Math.max(max, s.score.total), 0);
    const unowned: SwapSuggestion[] = scored.filter((s) => !s.supplied).map((s) => s.suggestion);
    const list: BuySwapSuggestion[] = buyList(unowned, () => best, scoring.collection);
    result.buyList = list;
  }
  if (suggestions.length === 0) {
    result.emptyReason = pool.tagCount === 0 ? 'NO_TAGS_ON_TARGET' : only ? 'NOTHING_OWNED_FITS' : 'NO_CANDIDATES';
  }
  return result;
}
