import type {
  AddSuggestion,
  BracketSignals,
  BuildBasics,
  BuildCard,
  BuildCost,
  BuildFeasibility,
  BuildFill,
  BuildOrigin,
  CardCategory,
  CardId,
  ComboSuggestion,
  IsoDateTime,
  RecContext,
  ScoreBreakdown,
  TagRef,
} from '../contract';
import type { Availability } from '../collection/availability';
import { COLOR_ORDER } from '../formats/commander/color-identity';
import { bracketSignals, estimateBracket, extraTurnLimit, gameChangerLimit, isCheckedComplete, type ComboFacts } from '../formats/commander/bracket';
import { COMMANDER_DECK_SIZE } from '../formats/commander/validate';
import { cardCategory, roleGap, roleShortfalls } from './add';
import { affinityTracker, deckAffinity, type DeckCardWeight, type PairLifts } from './affinity';
import type { ScoringConfig } from './config';
import { commanderShare, corpusComponent, neutralCorpusValue } from './corpus';
import { bracketExclusions, overBracket, type DeckBracketFacts } from './combos';
import type { RoleTarget } from './cut';
import { curveBucket, curveShortfall, deckCurve, isFrontLand } from './curve';
import {
  ADD_CATEGORIES,
  completeACombo,
  curveTargetsFor,
  identityMaskOf,
  mainDeckIds,
  owningOf,
  roleTargetsFor,
  type CardPlayRates,
  type RankCard,
  type RankCorpus,
} from './rank';
import { blendScore } from './swap';

/**
 * Build a deck from a commander and a bracket (T063; scoring-design.md, "Mode C"). A pure function over loaded rows, so
 * the app, the regression fixtures and the offline evaluation all build with the same code:
 *
 * 1. Skeleton: the land and basic land counts the commander's decks run (a typical count for its colours until they
 *    count, `app_config.scoring.build`), the role targets and the curve.
 * 2. Greedy fill of the nonland slots: each step picks the card with the highest m(c | picks), the add score
 *    (`weights.add`) against the deck so far, so role, curve and affinity needs move with every pick. A card that would
 *    break a bracket rule is skipped: here every rule is a limit, since the player asked for that bracket.
 * 3. Nonbasic lands the same way, leaving the basic land count; basics split by the spells' mana symbols.
 * 4. From a collection, picking stops once the best card left scores under `qualityFloor`: what stays open is the
 *    feasibility report, and `fill: 'value'` fills it with unowned cards by score above the floor per dollar.
 */

/** A basic land's colour: one of WUBRG, or C for Wastes. */
export type BasicColour = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

/** The basic land for each colour (Wastes for a colourless deck). */
export const BASIC_LAND_NAMES: Readonly<Record<BasicColour, string>> = {
  W: 'Plains',
  U: 'Island',
  B: 'Swamp',
  R: 'Mountain',
  G: 'Forest',
  C: 'Wastes',
};

const COLOURS = [...COLOR_ORDER] as ('W' | 'U' | 'B' | 'R' | 'G')[];
const MANA_SYMBOL = /\{([^}]+)\}/g;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Coloured mana symbols in a mana cost, per colour. A hybrid symbol splits evenly between its colours ({W/U} is half
 * each); a Phyrexian or two-generic symbol counts for its one colour ({W/P}, {2/W}); colourless and generic count for
 * nothing. A split card's halves both count.
 */
export function manaSymbols(manaCost: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const [, symbol] of manaCost.matchAll(MANA_SYMBOL)) {
    const colours = (symbol ?? '').split('/').filter((part) => COLOURS.includes(part as (typeof COLOURS)[number]));
    for (const colour of colours) out.set(colour, (out.get(colour) ?? 0) + 1 / colours.length);
  }
  return out;
}

/**
 * Basic lands per colour: each colour of the identity gets its share of the spells' coloured mana symbols, rounded by
 * largest remainder (ties in WUBRG order), so a colour no spell asks for gets none. Without any symbols the basics split
 * evenly; a colourless identity gets Wastes.
 */
export function splitBasics(count: number, identityMask: number, symbols: ReadonlyMap<string, number>): Map<BasicColour, number> {
  const colours = COLOURS.filter((_, i) => (identityMask & (1 << i)) !== 0);
  if (count <= 0) return new Map();
  if (colours.length === 0) return new Map([['C', count]]);
  const raw = colours.map((c) => symbols.get(c) ?? 0);
  const sum = raw.reduce((a, b) => a + b, 0);
  const weights = sum > 0 ? raw : colours.map(() => 1);
  const total = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (count * w) / total);
  const whole = exact.map(Math.floor);
  let left = count - whole.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    whole[i] = (whole[i] ?? 0) + 1;
    left--;
  }
  return new Map(colours.flatMap((c, i) => ((whole[i] ?? 0) > 0 ? [[c, whole[i] ?? 0] as const] : [])));
}

/** Colours in an identity mask. */
const colourCount = (mask: number) => COLOURS.filter((_, i) => (mask & (1 << i)) !== 0).length;

/**
 * Lands and basic lands to aim for: the commanders' decks as they earn a share (`commanderShare`, as role targets
 * move), the typical count for the identity's colours (`app_config.scoring.build`) for the rest. Basics never exceed lands.
 */
export function landTargets(corpus: RankCorpus, identityMask: number, scoring: ScoringConfig): { lands: number; basics: number } {
  const colours = colourCount(identityMask);
  const share = commanderShare(corpus.effectiveDeckCount, corpus.settings);
  const blend = (ours: number | null | undefined, typical: number) =>
    Math.round(ours === null || ours === undefined ? typical : share * ours + (1 - share) * typical);
  const lands = blend(corpus.landCount, scoring.build.landCounts[colours] ?? 0);
  return { lands, basics: Math.min(lands, blend(corpus.basicLandCount, scoring.build.basicLandCounts[colours] ?? 0)) };
}

/** Pair data for a build: the pairs among its candidates and every candidate's weight. */
export interface BuildAffinity {
  lifts: PairLifts;
  weights: ReadonlyMap<number, DeckCardWeight>;
}

export interface BuildInput {
  /** The commanders, the bracket, Game Changers, the collection; its main cards are cards to keep. */
  context: RecContext;
  /** Candidates in pool order: the collection's pool with a collection, everyone's without one. */
  poolIds: readonly number[];
  /** The open pool, for `fill: 'value'`: candidates the collection doesn't supply. */
  fillIds?: readonly number[];
  /** Rows for the commanders, the kept cards, both pools and the missing pieces of the combos. */
  cards: ReadonlyMap<number, RankCard>;
  rates: ReadonlyMap<number, CardPlayRates>;
  roles: ReadonlyMap<number, readonly string[]>;
  corpus: RankCorpus;
  roleTargets: readonly RoleTarget[];
  roleTags: ReadonlyMap<string, TagRef>;
  scoring: ScoringConfig;
  availability: Availability | null;
  standIns?: ReadonlyMap<number, RankCard>;
  /**
   * The bracket rules and the combos among the candidates: complete ones (every named piece a candidate, a kept card or
   * a commander, commander pieces only as commanders) and those one card short of that, with the missing card's row.
   */
  bracketFacts: DeckBracketFacts;
  affinity: BuildAffinity | null;
  /** Each basic land's row by colour. */
  basics: ReadonlyMap<BasicColour, RankCard>;
  fill?: BuildFill;
}

export interface BuildRanking {
  groups: { category: CardCategory; cards: BuildCard[] }[];
  basics: BuildBasics[];
  landTarget: number;
  combos: ComboSuggestion[];
  estimatedBracket: RecContext['bracket'];
  bracketSignals: BracketSignals;
  feasibility: BuildFeasibility;
  fillCost?: BuildCost;
}

const NO_STAND_INS: ReadonlyMap<number, RankCard> = new Map();

/** Builds a deck. Deterministic: ties break on name, then id. */
export function buildDeck(input: BuildInput): BuildRanking {
  const { context, cards, rates, roles, corpus, scoring, availability, bracketFacts, fill = 'none' } = input;
  const standIns = input.standIns ?? NO_STAND_INS;
  const bracket = context.bracket;
  const rules = bracketFacts.rules;
  const commanders = [...new Set(context.deck.commanders as number[])];
  const commanderSet = new Set(commanders);
  const slots = COMMANDER_DECK_SIZE - commanders.length;
  const mask = identityMaskOf(context, cards);
  const fromCollection = availability !== null;
  const floor = scoring.build.qualityFloor;
  const excluded = bracketExclusions(bracketFacts, bracket);
  const gcLimit = context.includeGameChangers ? gameChangerLimit(bracket) : 0;
  const turnLimit = extraTurnLimit(bracket, rules);
  const targets = roleTargetsFor(input.roleTargets, corpus, scoring.skeleton.edhrecPrior);
  const curve = curveTargetsFor(corpus, scoring);
  const roleLabels = new Map(targets.map((t) => [t.roleId, t.label]));
  const isLand = (id: number) => isFrontLand(cards.get(id)?.summary.typeLine ?? '');
  const isGameChanger = (id: number) => cards.get(id)?.summary.gameChanger ?? false;

  // The deck so far (kept cards and picks, never basics or commanders) and what the rules and scores track about it.
  const deck: number[] = [];
  const inDeck = new Set<number>();
  const shown = new Set<number>();
  const origins = new Map<number, BuildOrigin>();
  const pickScores = new Map<number, AddSuggestion>();
  const roleCounts = new Map<string, number>();
  const curveCounts = new Map<string, number>();
  let gameChangers = commanders.filter(isGameChanger).length;
  let extraTurns = commanders.filter((id) => bracketFacts.cards.extraTurns.has(id)).length;
  const tracker = input.affinity ? affinityTracker(input.affinity.lifts, input.affinity.weights, scoring.affinity) : null;

  // Combos by piece, for the over-bracket check: only those the build could complete and the rules can check.
  const checkable = bracketFacts.combos.filter((c) => c.templateNames.length === 0 && c.missing === null);
  const combosByCard = new Map<number, ComboFacts[]>();
  for (const c of checkable) for (const id of c.pieces) combosByCard.set(id, [...(combosByCard.get(id) ?? []), c]);
  const held = (id: number) => inDeck.has(id) || commanderSet.has(id);

  const corpusValues = new Map<number, number | null>();
  const corpusOf = (id: number): number | null => {
    if (!corpusValues.has(id)) {
      const r = rates.get(id);
      const value = r
        ? (corpusComponent(
            {
              commanderRate: r.commanderRate,
              commanderDeckCount: r.commanderDeckCount,
              baseline: r.baseline,
              baselineDeckCount: r.baselineDeckCount,
              hasExternalPrior: r.hasExternalPrior,
            },
            corpus.settings,
            scoring.corpus,
          )?.value ?? null)
        : null;
      corpusValues.set(id, value);
    }
    return corpusValues.get(id) ?? null;
  };
  // Cards too new for play data score like a typical candidate, as in adds.
  const neutralCorpus = neutralCorpusValue(
    input.poolIds.flatMap((id) => {
      const v = corpusOf(id);
      return v === null ? [] : [v];
    }),
    scoring.corpus,
  );

  /** m(c | deck): the add score against a deck's role shortfalls, curve and affinity. */
  const marginal = (id: number, affinity: ReturnType<typeof deckAffinity>, shortfalls: ReadonlyMap<string, number>, buckets: ReadonlyMap<string, number>) => {
    const card = cards.get(id) as RankCard;
    const { gap, roleIds } = roleGap([...(roles.get(id) ?? [])], shortfalls);
    const land = isFrontLand(card.summary.typeLine);
    const score: ScoreBreakdown = blendScore(
      {
        tag: null,
        manaValue: null,
        staple: null,
        corpus: round2(corpusOf(id) ?? neutralCorpus),
        votes: null,
        role: round2(gap),
        curve: curve && !land ? round2(curveShortfall(curve, buckets, card.summary.manaValue)) : null,
        deck: affinity ? round2(affinity.value) : null,
      },
      scoring.weights.add,
    );
    return { score, roleIds, pairedWith: affinity?.pairedWith ?? [] };
  };

  const suggestionOf = (id: number, scored: ReturnType<typeof marginal>): AddSuggestion => {
    const card = cards.get(id) as RankCard;
    const owning = owningOf(card, availability, standIns);
    return {
      card: owning.summary,
      category: cardCategory(card.summary.typeLine),
      score: scored.score,
      corpus: rates.get(id)?.evidence ?? null,
      fillsRoles: scored.roleIds.flatMap((roleId): TagRef[] => {
        const tag = input.roleTags.get(roleId);
        return tag ? [{ ...tag, label: roleLabels.get(roleId) ?? tag.label }] : [];
      }),
      owned: owning.owned,
      ...(owning.conflicts ? { conflicts: owning.conflicts } : {}),
      ...(scored.pairedWith.length > 0 ? { pairedWith: scored.pairedWith.map((p) => p as CardId) } : {}),
    };
  };

  const take = (id: number, origin: BuildOrigin) => {
    deck.push(id);
    inDeck.add(id);
    origins.set(id, origin);
    for (const role of roles.get(id) ?? []) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    const card = cards.get(id);
    if (card && !isFrontLand(card.summary.typeLine)) {
      const bucket = curveBucket(card.summary.manaValue);
      curveCounts.set(bucket, (curveCounts.get(bucket) ?? 0) + 1);
    }
    if (isGameChanger(id)) gameChangers++;
    if (bracketFacts.cards.extraTurns.has(id)) extraTurns++;
    tracker?.add(id);
  };

  // Kept cards first, in the order given; basic lands among them are left to the land step.
  for (const id of mainDeckIds(context)) {
    const card = cards.get(id);
    if (!card || card.isBasicLand || commanderSet.has(id) || inDeck.has(id)) continue;
    take(id, 'kept');
    shown.add(id);
  }

  /** Whether a card may join the deck now: the hard rules, and every bracket rule as a limit. */
  const allowed = (id: number) => {
    const card = cards.get(id);
    if (!card || held(id) || shown.has(id) || card.isBasicLand || !card.legal || (card.colorIdentity & ~mask) !== 0) return false;
    if (excluded.has(id)) return false;
    if (isGameChanger(id) && gameChangers >= gcLimit) return false;
    if (bracketFacts.cards.extraTurns.has(id) && extraTurns >= turnLimit) return false;
    return !(combosByCard.get(id) ?? []).some((c) => overBracket(c, bracket, rules) && c.pieces.every((p) => p === id || held(p)));
  };
  /** What the collection makes of a card: the card (or the twin standing in) when a copy is free. */
  const supplied = (id: number) => {
    if (!availability) return true;
    const owning = owningOf(cards.get(id) as RankCard, availability, standIns);
    return owning.owned !== null && !owning.conflicts && !shown.has(owning.summary.id);
  };

  /**
   * One greedy phase: while `room()` allows, the best allowed candidate by m(c | deck) (by score above the floor per
   * dollar for the value fill), stopping under `stopBelow`.
   */
  const phase = (candidates: readonly number[], room: () => boolean, origin: BuildOrigin, stopBelow: number | null) => {
    const live = [...new Set(candidates)].filter((id) => cards.has(id));
    while (room()) {
      let best: { id: number; key: number; scored: ReturnType<typeof marginal> } | null = null;
      const shortfalls = roleShortfalls(roleCounts, targets);
      for (const id of live) {
        if (!allowed(id)) continue;
        const scored = marginal(id, tracker?.of(id) ?? null, shortfalls, curveCounts);
        let key = scored.score.total;
        if (origin === 'fill') {
          const usd = cards.get(id)?.summary.price?.usd;
          if (usd === undefined || key <= floor) continue;
          key = (key - floor) / Math.max(usd, scoring.collection.priceFloorUsd);
        }
        const name = cards.get(id)?.summary.name ?? '';
        if (!best || key > best.key || (key === best.key && (name.localeCompare(cards.get(best.id)?.summary.name ?? '') || id - best.id) < 0)) {
          best = { id, key, scored };
        }
      }
      if (!best || (stopBelow !== null && best.scored.score.total < stopBelow)) return;
      const suggestion = suggestionOf(best.id, best.scored);
      pickScores.set(best.id, suggestion);
      shown.add(suggestion.card.id);
      take(best.id, origin);
    }
  };

  const { lands: landTarget, basics: basicTarget } = landTargets(corpus, mask, scoring);
  const nonlandSlots = slots - landTarget;
  const nonlandCount = () => deck.filter((id) => !isLand(id)).length;
  const landCount = () => deck.filter(isLand).length;
  const pool = input.poolIds.filter((id) => supplied(id));
  const stop = fromCollection ? floor : null;

  phase(
    pool.filter((id) => !isLand(id)),
    () => nonlandCount() < nonlandSlots && deck.length < slots,
    'pick',
    stop,
  );
  if (fill === 'value' && fromCollection) {
    const open = (input.fillIds ?? []).filter((id) => !isLand(id) && !supplied(id));
    phase(open, () => nonlandCount() < nonlandSlots && deck.length < slots, 'fill', null);
  }
  phase(
    pool.filter(isLand),
    () => landCount() < landTarget - basicTarget && deck.length < slots,
    'pick',
    stop,
  );

  // Basic lands make up the land count, split by the mana symbols of the spells and the commanders.
  const basicCount = Math.max(0, Math.min(landTarget - landCount(), slots - deck.length));
  const symbols = new Map<string, number>();
  for (const id of [...commanders, ...deck]) {
    if (isLand(id)) continue;
    for (const [colour, n] of manaSymbols(cards.get(id)?.summary.manaCost ?? '')) symbols.set(colour, (symbols.get(colour) ?? 0) + n);
  }
  const basics: BuildBasics[] = [...splitBasics(basicCount, mask, symbols)].flatMap(([colour, quantity]) => {
    const card = input.basics.get(colour);
    return card ? [{ card: card.summary, quantity }] : [];
  });
  const basicTotal = basics.reduce((sum, b) => sum + b.quantity, 0);

  // Kept cards are scored against the rest of the build, as cuts measure a card: m(c | deck − c).
  const finalCounts = new Map(roleCounts);
  for (const id of deck) {
    if (origins.get(id) !== 'kept') continue;
    const others = deck.filter((other) => other !== id);
    const counts = new Map(finalCounts);
    for (const role of roles.get(id) ?? []) counts.set(role, (counts.get(role) ?? 1) - 1);
    const buckets = deckCurve(others.flatMap((o) => (cards.has(o) ? [{ manaValue: cards.get(o)!.summary.manaValue, isLand: isLand(o) }] : [])));
    const affinity = input.affinity ? deckAffinity(id, others, input.affinity.lifts, input.affinity.weights, scoring.affinity) : null;
    pickScores.set(id, suggestionOf(id, marginal(id, affinity, roleShortfalls(counts, targets), buckets)));
  }

  const groups = ADD_CATEGORIES.map((category) => ({
    category,
    cards: deck
      .flatMap((id): BuildCard[] => {
        const s = pickScores.get(id);
        return s && s.category === category ? [{ ...s, origin: origins.get(id) ?? 'pick' }] : [];
      })
      .sort((a, b) => b.score.total - a.score.total || a.card.name.localeCompare(b.card.name)),
  })).filter((g) => g.cards.length > 0);

  // The finished build against the bracket rules, and the combos it is one card short of.
  const finalIds = [...commanders, ...deck, ...basics.map((b) => b.card.id as number)];
  const finalSet = new Set(finalIds);
  const complete = bracketFacts.combos.filter((c) => c.pieces.every((p) => finalSet.has(p))).map((c) => ({ ...c, missing: null }));
  const signals = bracketSignals(finalIds, isGameChanger, bracketFacts.cards, complete.filter(isCheckedComplete), rules);
  const oneShort = bracketFacts.combos.flatMap((c): ComboFacts[] => {
    const missing = c.pieces.filter((p) => !finalSet.has(p));
    return missing.length === 1 && cards.has(missing[0] ?? 0) ? [{ ...c, missing: missing[0] ?? null }] : [];
  });
  const combos = completeACombo(
    { ...bracketFacts, combos: oneShort },
    bracket,
    excluded,
    (id) => {
      const card = cards.get(id);
      if (!card) return undefined;
      const affinity = input.affinity ? deckAffinity(id, deck, input.affinity.lifts, input.affinity.weights, scoring.affinity) : null;
      const owning = owningOf(card, availability, standIns);
      return {
        suggestion: suggestionOf(id, marginal(id, affinity, roleShortfalls(roleCounts, targets), curveCounts)),
        supplied: !fromCollection || owning.owned !== null,
      };
    },
    fromCollection,
    scoring,
  );

  const filledByValue = deck.filter((id) => origins.get(id) === 'fill').length;
  const shortfalls = targets
    .map((t) => ({ t, short: Math.round(t.target - (roleCounts.get(t.roleId) ?? 0)) }))
    .filter(({ short }) => short >= 1)
    .sort((a, b) => b.short - a.short || a.t.label.localeCompare(b.t.label));
  const feasibility: BuildFeasibility = {
    slots,
    filled: deck.length - filledByValue + basicTotal,
    filledByValue,
    open: slots - deck.length - basicTotal,
    roleShortfalls: shortfalls.flatMap(({ t, short }) => {
      const tag = input.roleTags.get(t.roleId);
      return tag ? [{ role: { ...tag, label: t.label }, short }] : [];
    }),
  };

  const fillPrices = deck.filter((id) => origins.get(id) === 'fill').map((id) => cards.get(id)?.summary.price);
  const asOf = fillPrices.reduce<IsoDateTime | null>((latest, p) => (p && (latest === null || p.asOf > latest) ? p.asOf : latest), null);
  return {
    groups,
    basics,
    landTarget,
    combos,
    estimatedBracket: estimateBracket(signals, rules),
    bracketSignals: signals,
    feasibility,
    ...(fill === 'value' && fromCollection
      ? { fillCost: { usd: round2(fillPrices.reduce((sum, p) => sum + (p?.usd ?? 0), 0)), cards: filledByValue, asOf } }
      : {}),
  };
}
