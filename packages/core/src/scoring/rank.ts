import type {
  AddSuggestion,
  BuyAddSuggestion,
  BuySwapSuggestion,
  BuyValue,
  CardCategory,
  CardId,
  ComboRef,
  ComboSuggestion,
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
import { comboRef, type ComboFacts } from '../formats/commander/bracket';
import { cardCategory, roleGap, roleShortfalls } from './add';
import type { CorpusSettings, ScoringConfig } from './config';
import { commanderCorpusScore, commanderShare, corpusComponent, neutralCorpusValue, type CommanderCardRate } from './corpus';
import { deckAffinity, type DeckCardWeight, type PairLifts } from './affinity';
import { bracketExclusions, comboResultWeight, cutBracketMarks, overBracket, type DeckBracketFacts } from './combos';
import { scoreCuts, type RoleTarget } from './cut';
import {
  curveMeanManaValue,
  curveOverloaded,
  curveShortfall,
  curveTargets,
  deckCurve,
  isFrontLand,
  type Profile,
  type ProfilePrior,
} from './curve';
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
  /** Average nonland cards per deck at each mana value bucket (T062). */
  curveProfile: Profile;
  /** EDHREC's role and curve profile for these commanders, when they have a page (T062). */
  prior: ProfilePrior | null;
  /** Lands per deck, basics included, across the commanders' decks at their weights (T062); absent or null when unknown. */
  landCount?: number | null;
  /** Basic lands per deck, the same way. */
  basicLandCount?: number | null;
}

/** What deck affinity needs for one deck (T064): the pairs touching its cards and its cards' weights. */
export interface AffinityInput {
  lifts: PairLifts;
  weights: ReadonlyMap<number, DeckCardWeight>;
  /** Cards the deck's pairs point to most, best first: they join the add pool. */
  neighbours: readonly number[];
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
const NO_EXCLUSIONS: ReadonlySet<number> = new Set();

export const modeOf = (ctx: RecContext): RecMode => (ctx.ownership ? 'collection_aware' : 'collection_less');
/** The deck's main cards, once each. */
export const mainDeckIds = (ctx: RecContext): number[] => [
  ...new Set(ctx.deck.cards.filter((c) => c.section === 'main').map((c) => c.cardId)),
];

/**
 * Role targets for this deck: the generic targets, moved toward how many cards the commander's decks actually run in
 * each role as those decks gain weight. Liesa decks, for one, run far more removal than a generic deck.
 */
export function roleTargetsFor(generic: readonly RoleTarget[], corpus: RankCorpus, edhrecPrior = false): RoleTarget[] {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  // With the EDHREC prior on (T062), the generic targets first move toward the commander's EDHREC page by its decks.
  const prior = edhrecPrior ? corpus.prior : null;
  const priorShare = prior ? commanderShare(prior.evidence, corpus.settings) : 0;
  const base =
    prior && priorShare > 0
      ? generic.map((t) => {
          const typical = prior.roles[t.roleId];
          return typical === undefined ? t : { ...t, target: round1(priorShare * typical + (1 - priorShare) * t.target) };
        })
      : [...generic];
  const share = commanderShare(corpus.effectiveDeckCount, corpus.settings);
  if (share === 0) return base;
  return base.map((t) => {
    const typical = corpus.roleProfile[t.roleId];
    return typical === undefined ? t : { ...t, target: round1(share * typical + (1 - share) * t.target) };
  });
}

/** The curve a deck is measured against for these commanders (`curveTargets`), with the EDHREC prior when it is on. */
export const curveTargetsFor = (corpus: RankCorpus, scoring: ScoringConfig): Profile | null =>
  curveTargets(corpus.curveProfile, corpus.effectiveDeckCount, scoring.skeleton.edhrecPrior ? corpus.prior : null, corpus.settings);

/** A deck's nonland cards per curve bucket, from the cards the caller loaded. */
const deckCurveOf = (ids: readonly number[], cards: ReadonlyMap<number, RankCard>) =>
  deckCurve(ids.flatMap((id) => {
    const card = cards.get(id);
    return card ? [{ manaValue: card.summary.manaValue, isLand: isFrontLand(card.summary.typeLine) }] : [];
  }));

/** What a collection makes of a card in a suggestion. */
export interface Owning {
  /** The card to show: the card itself, or an owned twin standing in for it. */
  summary: CardSummary;
  owned: OwnedInfo | null;
  conflicts?: DeckConflict[];
  /** The collection supplies it: a copy is free, every copy is in a built deck, or it is a basic land. */
  supplied: boolean;
}

const unowned = (summary: CardSummary): Owning => ({ summary, owned: null, supplied: false });

export function owningOf(card: RankCard, availability: Availability | null, standIns: ReadonlyMap<number, RankCard>): Owning {
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

export const identityMaskOf = (ctx: RecContext, cards: ReadonlyMap<number, RankCard>) =>
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
  bracketFacts = null,
  affinity = null,
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
  /** The bracket rules and the deck's complete combos (T060); without them only Game Changers are checked. */
  bracketFacts?: DeckBracketFacts | null;
  /** Card pairs for the deck (T064): LOW_AFFINITY, once switched on, for commanders with enough decks of their own. */
  affinity?: AffinityInput | null;
  limit: number;
}): CutResult {
  const mainIds = mainDeckIds(context);
  const bracket = bracketFacts ? cutBracketMarks(bracketFacts, context.bracket, context.deck.commanders) : null;
  // The learned curve's cut rule (T062), once switched on: expensive means over this commander's curve, not a fixed cost.
  const curve = scoring.skeleton.curveCuts ? curveTargetsFor(corpus, scoring) : null;
  const curveMean = curve ? curveMeanManaValue(curve) : null;
  const deckBuckets = curve ? deckCurveOf(mainIds, cards) : null;
  const judgeAffinity = affinity && scoring.affinity.lowAffinityCuts && commanderShare(corpus.effectiveDeckCount, corpus.settings) > 0;
  const lowAffinity = (id: number) => {
    if (!judgeAffinity || !affinity) return {};
    const a = deckAffinity(id, mainIds, affinity.lifts, affinity.weights, scoring.affinity);
    return a ? { lowAffinity: a.value < scoring.affinity.lowAffinityScore } : {};
  };
  const highOnCurve = (manaValue: number) =>
    curve && deckBuckets && curveMean !== null
      ? { highOnCurve: manaValue >= curveMean && curveOverloaded(curve, deckBuckets, manaValue, scoring.skeleton.curveOverloadRatio) }
      : {};
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
          ...(bracket ? bracket.marks(id) : {}),
          ...highOnCurve(card.summary.manaValue),
          ...(card.isBasicLand ? {} : lowAffinity(id)),
        },
      ];
    }),
    {
      includeGameChangers: context.includeGameChangers,
      gameChangerLimit: gameChangerLimit(context.bracket),
      roleTargets: roleTargetsFor(roleTargets, corpus, scoring.skeleton.edhrecPrior),
      severeSynergyScore: corpus.settings.severeSynergyScore,
      scoring: scoring.cuts,
      ...(bracket ? bracket.options : {}),
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

/** Cards to add in display groups, in 'only' mode the cards worth buying, and the combos one card short. */
export interface AddRanking {
  groups: { category: CardCategory; suggestions: AddSuggestion[] }[];
  buyList?: BuyAddSuggestion[];
  combos?: ComboSuggestion[];
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
  bracketFacts = null,
  deckCards = NO_STAND_INS,
  affinity = null,
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
  /**
   * The bracket rules and the deck's combos (T060): mass land denial stays out below its bracket, and the combos one
   * card short make the "complete a combo" group. Their missing cards' rows and rates belong in `cards` and `rates`.
   */
  bracketFacts?: DeckBracketFacts | null;
  /** The deck's main cards, for its curve (T062); the curve component is left out without them. */
  deckCards?: ReadonlyMap<number, RankCard>;
  /** Card pairs for the deck (T064): the `deck` component, and the cards its pairs point to join the pool. */
  affinity?: AffinityInput | null;
  limitPerCategory: number;
}): AddRanking {
  const only = availability !== null && ownedOnly(context);
  const excluded = bracketExclusions(bracketFacts, context.bracket);
  const deckRoleCounts = new Map<string, number>();
  for (const id of mainDeckIds(context)) for (const role of roles.get(id) ?? []) deckRoleCounts.set(role, (deckRoleCounts.get(role) ?? 0) + 1);
  const shortfalls = roleShortfalls(deckRoleCounts, roleTargetsFor(roleTargets, corpus, scoring.skeleton.edhrecPrior));
  const curve = curveTargetsFor(corpus, scoring);
  const deckBuckets = curve ? deckCurveOf(mainDeckIds(context), deckCards) : null;
  /** The curve component (T062): null without a curve, and for lands, which the curve doesn't count. */
  const curveFor = (card: RankCard) =>
    curve && deckBuckets && !isFrontLand(card.summary.typeLine) ? round2(curveShortfall(curve, deckBuckets, card.summary.manaValue)) : null;
  const roleLabels = new Map(roleTargets.map((t) => [t.roleId, t.label]));

  const corpusOf = (cardId: number) => {
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
  };
  const inPool = new Set(poolIds);
  const poolWithNeighbours = [...poolIds, ...(affinity?.neighbours ?? []).filter((id) => !inPool.has(id) && cards.has(id))];
  const scoredPool = poolWithNeighbours.filter((id) => !excluded.has(id)).map(corpusOf);
  const mainIds = mainDeckIds(context);
  const affinityOf = (cardId: number) => (affinity ? deckAffinity(cardId, mainIds, affinity.lifts, affinity.weights, scoring.affinity) : null);
  // Cards too new for play data score like a typical candidate: not buried for being new, not promoted either.
  const neutralCorpus = neutralCorpusValue(
    scoredPool.flatMap((p) => (p.corpusScore ? [p.corpusScore.value] : [])),
    scoring.corpus,
  );

  // A card that would complete a combo above the bracket says so.
  const overCombos = new Map<number, ComboRef[]>();
  for (const c of bracketFacts?.combos ?? []) {
    if (c.missing === null || !bracketFacts || !overBracket(c, context.bracket, bracketFacts.rules)) continue;
    overCombos.set(c.missing, [...(overCombos.get(c.missing) ?? []), comboRef(c)]);
  }

  const scoreOne = ({ cardId, rates: r, corpusScore }: ReturnType<typeof corpusOf>) => {
    const card = cards.get(cardId);
    if (!card) return [];
    const { gap, roleIds } = roleGap([...(roles.get(cardId) ?? [])], shortfalls);
    const owning = owningOf(card, availability, standIns);
    const deck = affinityOf(cardId);
    const suggestion: AddSuggestion = {
      card: owning.summary,
      category: cardCategory(card.summary.typeLine),
      score: blendScore(
        {
          tag: null,
          manaValue: null,
          staple: null,
          corpus: round2(corpusScore?.value ?? neutralCorpus),
          votes: null,
          role: round2(gap),
          curve: curveFor(card),
          deck: deck ? round2(deck.value) : null,
        },
        scoring.weights.add,
      ),
      corpus: r?.evidence ?? null,
      fillsRoles: roleIds.flatMap((id): TagRef[] => {
        const tag = roleTags.get(id);
        return tag ? [{ ...tag, label: roleLabels.get(id) ?? tag.label }] : [];
      }),
      owned: owning.owned,
      ...(owning.conflicts ? { conflicts: owning.conflicts } : {}),
      ...(overCombos.has(cardId) ? { completesOverBracket: overCombos.get(cardId) } : {}),
      ...(deck && deck.pairedWith.length > 0 ? { pairedWith: deck.pairedWith.map((id) => id as CardId) } : {}),
    };
    return [{ suggestion, supplied: owning.supplied }];
  };
  const scored = scoredPool.flatMap(scoreOne);
  const listed = (only ? scored.filter((s) => s.supplied) : scored).map((s) => s.suggestion);
  const combos = bracketFacts ? completeACombo(bracketFacts, context.bracket, excluded, (id) => scoreOne(corpusOf(id))[0], only, scoring) : undefined;

  const groups = ADD_CATEGORIES.map((category) => ({
    category,
    suggestions: onceEach(
      listed
        .filter((s) => s.category === category)
        .sort((a, b) => rankKey(b.score.total, b.owned !== null, ownedBoost) - rankKey(a.score.total, a.owned !== null, ownedBoost)),
    ).slice(0, limitPerCategory),
  })).filter((g) => g.suggestions.length > 0);
  if (!only) return { groups, ...(combos ? { combos } : {}) };

  const best = new Map<CardCategory, number>();
  for (const s of listed) best.set(s.category, Math.max(best.get(s.category) ?? 0, s.score.total));
  const candidates = scored.filter((s) => !s.supplied).map((s) => s.suggestion);
  return { groups, buyList: buyList(candidates, (c) => best.get(c.category) ?? 0, scoring.collection), ...(combos ? { combos } : {}) };
}

/**
 * "Complete a combo" (scoring-design.md, "Combos"): the combos the deck is one named card short of that the bracket
 * allows, one entry per missing card (its best combo), ordered by what the combo does and then by the missing card's
 * score as an add. In 'only' mode the collection has to supply the missing card.
 */
export function completeACombo(
  facts: DeckBracketFacts,
  bracket: RecContext['bracket'],
  excluded: ReadonlySet<number>,
  score: (cardId: number) => { suggestion: AddSuggestion; supplied: boolean } | undefined,
  only: boolean,
  scoring: ScoringConfig,
): ComboSuggestion[] {
  const best = new Map<number, { combo: ComboFacts; weight: number }>();
  for (const c of facts.combos) {
    if (c.missing === null || excluded.has(c.missing) || overBracket(c, bracket, facts.rules)) continue;
    const weight = comboResultWeight(c, scoring.combos);
    const held = best.get(c.missing);
    if (!held || weight > held.weight || (weight === held.weight && c.pieces.length < held.combo.pieces.length)) best.set(c.missing, { combo: c, weight });
  }
  return [...best]
    .flatMap(([missing, { combo, weight }]) => {
      const scored = score(missing);
      if (!scored || (only && !scored.supplied)) return [];
      const { suggestion } = scored;
      const entry: ComboSuggestion = {
        ...comboRef(combo),
        card: suggestion.card,
        pieceIds: combo.pieces.filter((id) => id !== missing).map((id) => id as CardId),
        alsoNeeded: [...combo.templateNames],
        score: suggestion.score,
        owned: suggestion.owned,
        ...(suggestion.conflicts ? { conflicts: suggestion.conflicts } : {}),
      };
      return [{ entry, weight }];
    })
    .sort((a, b) => b.weight - a.weight || b.entry.score.total - a.entry.score.total || a.entry.card.name.localeCompare(b.entry.card.name))
    .slice(0, scoring.combos.maxSuggestions)
    .map((e) => e.entry);
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
    excluded = NO_EXCLUSIONS,
    affinity = null,
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
    /** Cards the bracket keeps out (`bracketExclusions`). */
    excluded?: ReadonlySet<number>;
    /** Card pairs for the deck (T064): a replacement's `deck` component, against the deck without the target. */
    affinity?: AffinityInput | null;
  },
): SwapResult {
  const only = availability !== null && ownedOnly(context);
  const mode = modeOf(context);
  const target = pool.target.summary;
  const inDeck = new Set<number>([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)]);
  const candidates = (only && buyPool ? mergeCandidates(pool.candidates, buyPool.candidates) : pool.candidates).filter(
    (c) => !inDeck.has(c.cardId) && !excluded.has(c.cardId) && c.tagSimilarity >= scoring.swap.tagSimilarityFloor,
  );
  const owns = ownsWith(availability);
  const deckWithoutTarget = mainDeckIds(context).filter((id) => id !== target.id);

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
    const deck = affinity ? deckAffinity(c.cardId, deckWithoutTarget, affinity.lifts, affinity.weights, scoring.affinity) : null;
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
      ...(deck && deck.pairedWith.length > 0 ? { pairedWith: deck.pairedWith.map((id) => id as CardId) } : {}),
      score: blendScore(
          {
            tag: round2(c.tagSimilarity),
            manaValue: round2(manaValueProximity(card.manaValue, target.manaValue, scoring.swap.manaValueFalloff)),
            staple: round2(c.stapleScore),
            corpus: corpusScore ? round2(corpusScore.value) : null,
            votes: null,
            role: null,
            deck: deck ? round2(deck.value) : null,
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
