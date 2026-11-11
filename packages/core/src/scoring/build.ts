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
  StatTargets,
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
import { curveBucket, curveShortfall, deckCurve, isFrontLand, statCardType } from './curve';
import { STAT_TOLERANCE_MIN_CARDS, STAT_TOLERANCE_SHARE } from '../journey/deck-tally';
import { colourTarget, creditedSources, manaBase, manaLetters, sourceCredit, type ManaCard, type ManaEntry } from '../journey/mana-base';
import {
  ADD_CATEGORIES,
  completeACombo,
  curveTargetsFor,
  identityMaskOf,
  mainDeckIds,
  owningOf,
  byStaple,
  stapleOf,
  roleTargetsFor,
  type CardPlayRates,
  type RankCard,
  type RankCorpus,
} from './rank';
import { blendScore } from './swap';

/**
 * Build a deck from a commander and a bracket (T063). A pure function over loaded rows, so
 * the app, the regression fixtures and the offline evaluation all build with the same code:
 *
 * 1. Skeleton: the land and basic land counts the commander's decks run (a typical count for its colours until they
 *    count, `app_config.scoring.build`), the role targets and the curve, and with `statTargets` the card types and
 *    curve Deck stats grades the deck against, so a build passes the check the player sees next.
 * 2. Role quotas: while a role is under its target, the best card by m(c | picks) among those filling it. Then card
 *    types and curve bars under the low edge of their band, the same way, without pushing another line over its own.
 * 3. Greedy fill of the remaining nonland slots: each step picks the card with the highest m(c | picks), the add score
 *    (`weights.add`) against the deck so far, so role, curve and affinity needs move with every pick, among the cards
 *    that keep every role, card type and curve bar inside its band (any card when none does: a weak card beats an empty
 *    slot). A card that would break a bracket rule is skipped: here every rule is a limit, since the player asked for
 *    that bracket.
 * 4. Nonbasic lands, those making a colour still short of its source target first (Karsten's number, capped by
 *    `colourSourceCaps`), leaving the basic land count; each basic goes to the colour furthest under its target, the
 *    rest split by the spells' mana symbols.
 * 5. From a collection, nonland picks go on while the collection has cards left (a weak owned card beats an empty slot),
 *    but nonbasic lands stop once the best one left scores under `qualityFloor`, leaving those slots to basics. What
 *    stays open is the feasibility report, with the Deck stats lines the collection couldn't bring in line, and
 *    `fill: 'value'` fills the open slots with unowned cards by score above the floor per dollar.
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

/** How far a line may sit from its target and still be in line: Deck stats' band (`withinTolerance`). */
const tolerance = (target: number) => Math.max(target * STAT_TOLERANCE_SHARE, STAT_TOLERANCE_MIN_CARDS);
/** The most a line may hold and stay in its band. */
const upperEdge = (target: number) => target + tolerance(target);
/** The fewest a line may hold and stay in its band. */
const lowerEdge = (target: number) => target - tolerance(target);

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
  /** Each card's global staple score (`card_stats`), 0..1 (T083): breaks ties between equal scores (`stapleOf`). */
  staples?: ReadonlyMap<number, number> | null;
  /**
   * Deck stats' targets for these commanders: the build keeps its card types and curve inside their bands. Null or
   * absent (the offline evaluation): roles only.
   */
  statTargets?: StatTargets | null;
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

/** Builds a deck. Deterministic: ties break on the staple score (T083), then name, then id. */
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
  const roleTargetOf = new Map(targets.map((t) => [t.roleId, t.target]));
  const typeTargets = new Map((input.statTargets?.types ?? []).map((t) => [t.cardType, t.target]));
  // Deck stats' curve, bar by mana value; the skeleton's own curve (above) still scores the picks.
  const curveBars = input.statTargets?.curve ?? null;
  const colourCap = scoring.build.colourSourceCaps[colourCount(mask)] ?? null;
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
  const typeCounts = new Map<string, number>();
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
        staple: stapleOf(input.staples, id),
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
      const type = statCardType(card.summary.typeLine);
      if (type) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }
    if (isGameChanger(id)) gameChangers++;
    if (bracketFacts.cards.extraTurns.has(id)) extraTurns++;
    tracker?.add(id);
  };

  // Kept cards first, in the order given; basic lands among them are left to the land step. A kept card no Commander
  // deck under these commanders may hold (not legal, outside their colours) stays out: the build is a legal 99.
  for (const id of mainDeckIds(context)) {
    const card = cards.get(id);
    if (!card || card.isBasicLand || commanderSet.has(id) || inDeck.has(id)) continue;
    if (!card.legal || (card.colorIdentity & ~mask) !== 0) continue;
    take(id, 'kept');
    shown.add(id);
  }

  /**
   * Whether a card may join the deck now: the hard rules, and every bracket rule as a limit. An owned twin standing in
   * is the card that goes in the deck, so it is checked too: one copy can't fill two slots, and a twin can't carry a
   * rule its stand-in breaks.
   */
  const allowed = (id: number) => {
    const card = cards.get(id);
    if (!card || card.isBasicLand || !card.legal || (card.colorIdentity & ~mask) !== 0) return false;
    const shownId = availability ? owningOf(card, availability, standIns).summary.id : id;
    const ids = shownId === id ? [id] : [id, shownId];
    return ids.every((x) => {
      if (held(x) || shown.has(x) || excluded.has(x)) return false;
      if (isGameChanger(x) && gameChangers >= gcLimit) return false;
      if (bracketFacts.cards.extraTurns.has(x) && extraTurns >= turnLimit) return false;
      return !(combosByCard.get(x) ?? []).some((c) => overBracket(c, bracket, rules) && c.pieces.every((p) => p === x || held(p)));
    });
  };
  /** What the collection makes of a card: the card (or the twin standing in) when a copy is free. */
  const supplied = (id: number) => {
    if (!availability) return true;
    const owning = owningOf(cards.get(id) as RankCard, availability, standIns);
    return owning.owned !== null && !owning.conflicts && !shown.has(owning.summary.id);
  };

  /**
   * How many lines a card would push above the top of their band: its roles (a cycling land draws cards too), and for a
   * nonland its card type and its curve bar.
   */
  const bandsBroken = (id: number) => {
    const card = cards.get(id);
    if (!card) return 0;
    const over = (held: number, target: number | undefined) => (target !== undefined && held + 1 > upperEdge(target) ? 1 : 0);
    const broken = (roles.get(id) ?? []).reduce((n, role) => n + over(roleCounts.get(role) ?? 0, roleTargetOf.get(role)), 0);
    if (isFrontLand(card.summary.typeLine)) return broken;
    const type = statCardType(card.summary.typeLine);
    const bucket = curveBucket(card.summary.manaValue);
    return (
      broken +
      (type ? over(typeCounts.get(type) ?? 0, typeTargets.get(type)) : 0) +
      (curveBars !== null ? over(curveCounts.get(bucket) ?? 0, curveBars[Number(bucket)]) : 0)
    );
  };

  /**
   * How a phase chooses: only cards passing `only`; inside every band first, and with `anyBand`, when none is, the card
   * breaking the fewest bands.
   */
  interface PhaseRule {
    only?: (id: number) => boolean;
    anyBand: boolean;
  }
  type Pick = { id: number; key: number; broken: number; scored: ReturnType<typeof marginal> };
  /** Whether a candidate goes ahead of the best so far: fewer bands broken, higher key, then staple score, name and id. */
  const ahead = (best: Pick | null, id: number, key: number, broken: number, scored: Pick['scored']) => {
    if (!best) return true;
    if (broken !== best.broken) return broken < best.broken;
    if (key !== best.key) return key > best.key;
    const name = cards.get(id)?.summary.name ?? '';
    return (byStaple(scored.score, best.scored.score) || name.localeCompare(cards.get(best.id)?.summary.name ?? '') || id - best.id) < 0;
  };

  /**
   * One greedy phase: while `room()` allows, the best allowed candidate by m(c | deck) (by score above the floor per
   * dollar for the value fill), stopping under `stopBelow`. Cards that keep every line inside its band come first.
   */
  const phase = (candidates: readonly number[], room: () => boolean, origin: BuildOrigin, stopBelow: number | null, rule: PhaseRule) => {
    const live = [...new Set(candidates)].filter((id) => cards.has(id) && (rule.only?.(id) ?? true));
    while (room()) {
      let best: Pick | null = null;
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
        const broken = bandsBroken(id);
        if (broken > 0 && !rule.anyBand) continue;
        if (ahead(best, id, key, broken, scored)) best = { id, key, broken, scored };
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
  // Only nonbasic lands stop at the floor: a basic is a fine land, while an empty spell slot is a hole in the deck.
  const landStop = fromCollection ? floor : null;

  const nonlandRoom = () => nonlandCount() < nonlandSlots && deck.length < slots;
  const nonlandPool = pool.filter((id) => !isLand(id));

  // Role quotas, the role furthest under its target first; a role nothing left can fill is done.
  const done = new Set<string>();
  for (;;) {
    const filled = (t: RoleTarget) => (roleCounts.get(t.roleId) ?? 0) / t.target;
    const short = targets
      .filter((t) => t.target > 0 && !done.has(t.roleId) && (roleCounts.get(t.roleId) ?? 0) < Math.round(t.target))
      .sort((a, b) => filled(a) - filled(b) || a.roleId.localeCompare(b.roleId));
    const role = short[0];
    if (!role || !nonlandRoom()) break;
    const before = deck.length;
    // A role matters more than a card type's band: an over-band card still fills it when nothing else can.
    phase(nonlandPool, () => nonlandRoom() && deck.length === before, 'pick', null, {
      only: (id) => (roles.get(id) ?? []).includes(role.roleId),
      anyBand: true,
    });
    if (deck.length === before) done.add(role.roleId);
  }
  // Card types up to the low edge of their bands, without pushing anything over its own.
  for (const [type, target] of typeTargets) {
    const aim = Math.ceil(lowerEdge(target));
    phase(nonlandPool, () => nonlandRoom() && (typeCounts.get(type) ?? 0) < aim, 'pick', null, {
      only: (id) => statCardType(cards.get(id)?.summary.typeLine ?? '') === type,
      anyBand: false,
    });
  }
  // Curve bars up to the low edge of theirs, the same way.
  (curveBars ?? []).forEach((target, bar) => {
    const bucket = curveBucket(bar);
    const aim = Math.ceil(lowerEdge(target));
    phase(nonlandPool, () => nonlandRoom() && (curveCounts.get(bucket) ?? 0) < aim, 'pick', null, {
      only: (id) => curveBucket(cards.get(id)?.summary.manaValue ?? -1) === bucket,
      anyBand: false,
    });
  });
  phase(nonlandPool, nonlandRoom, 'pick', null, { anyBand: true });
  if (fill === 'value' && fromCollection) {
    const open = (input.fillIds ?? []).filter((id) => !isLand(id) && !supplied(id));
    phase(open, nonlandRoom, 'fill', null, { anyBand: true });
  }

  // The mana base: each colour's source target is its hardest card's Karsten number, capped for the colour count.
  const deckColours = manaLetters(COLOURS.filter((_, i) => (mask & (1 << i)) !== 0));
  const manaCard = (id: number): ManaCard | null => (cards.get(id)?.summary as ManaCard | undefined) ?? null;
  const commanderMana = commanders.flatMap((id) => manaCard(id) ?? []);
  const mainEntries = (extra: readonly ManaEntry[] = []): ManaEntry[] => [
    ...deck.flatMap((id) => {
      const card = manaCard(id);
      return card ? [{ card, quantity: 1 }] : [];
    }),
    ...extra,
  ];
  const needs = manaBase(mainEntries(), commanderMana, deckColours)
    .colours.filter((n) => deckColours.includes(n.colour))
    .map((n) => ({ colour: n.colour, manaValue: n.manaValue, target: colourTarget(n.needed, colourCap) }));
  /** Each colour's sources short of its target, with `extra` (basics so far) in the deck. */
  const deficits = (extra: readonly ManaEntry[] = []) => {
    const main = mainEntries(extra);
    return new Map(needs.map((n) => [n.colour, n.target - creditedSources(main, n.colour, n.manaValue, deckColours)]));
  };
  /** Whether a land makes (or finds) a colour still short of its target. */
  const fixesShortColour = (id: number, short: ReadonlyMap<string, number>) => {
    const card = manaCard(id);
    return card !== null && needs.some((n) => (short.get(n.colour) ?? 0) > 0 && sourceCredit(card, n.colour, n.manaValue, deckColours) > 0);
  };

  // Nonbasic lands: while a colour is short, the best land that helps it; then the best land. A land that would push
  // a role over its band (a cycling land once card draw is full) leaves its slot to a basic.
  const landPool = pool.filter(isLand);
  const landRoom = () => landCount() < landTarget - basicTarget && deck.length < slots;
  while (landRoom()) {
    const short = deficits();
    const before = deck.length;
    const once = () => landRoom() && deck.length === before;
    if ([...short.values()].some((d) => d > 0)) {
      phase(landPool, once, 'pick', landStop, { only: (id) => fixesShortColour(id, short), anyBand: false });
    }
    if (deck.length === before) phase(landPool, once, 'pick', landStop, { anyBand: false });
    if (deck.length === before) break;
  }

  // Basic lands make up the land count: each to the colour furthest under its source target, the rest split by the
  // mana symbols of the spells and the commanders.
  const basicCount = Math.max(0, Math.min(landTarget - landCount(), slots - deck.length));
  const symbols = new Map<string, number>();
  for (const id of [...commanders, ...deck]) {
    if (isLand(id)) continue;
    for (const [colour, n] of manaSymbols(cards.get(id)?.summary.manaCost ?? '')) symbols.set(colour, (symbols.get(colour) ?? 0) + n);
  }
  const colourOrder = (c: string) => COLOURS.indexOf(c as (typeof COLOURS)[number]);
  const toDeficit = new Map<BasicColour, number>();
  const basicEntries = (counts: ReadonlyMap<BasicColour, number>) =>
    [...counts].flatMap(([colour, quantity]): ManaEntry[] => {
      const card = input.basics.get(colour);
      return card && quantity > 0 ? [{ card: card.summary as ManaCard, quantity }] : [];
    });
  let unplaced = basicCount;
  while (unplaced > 0) {
    const short = deficits(basicEntries(toDeficit));
    const worst = needs
      .filter((n) => input.basics.has(n.colour as BasicColour) && (short.get(n.colour) ?? 0) > 0)
      .sort((a, b) => (short.get(b.colour) ?? 0) - (short.get(a.colour) ?? 0) || colourOrder(a.colour) - colourOrder(b.colour))[0];
    if (!worst) break;
    const colour = worst.colour as BasicColour;
    toDeficit.set(colour, (toDeficit.get(colour) ?? 0) + 1);
    unplaced--;
  }
  const split = new Map(toDeficit);
  for (const [colour, n] of splitBasics(unplaced, mask, symbols)) split.set(colour, (split.get(colour) ?? 0) + n);
  const basics: BuildBasics[] = [...split]
    .sort(([a], [b]) => colourOrder(a) - colourOrder(b))
    .flatMap(([colour, quantity]) => {
      const card = input.basics.get(colour);
      return card && quantity > 0 ? [{ card: card.summary, quantity }] : [];
    });
  const basicTotal = basics.reduce((sum, b) => sum + b.quantity, 0);

  // A collection build names the Deck stats lines it couldn't bring in line: the collection had nothing more for them.
  const collectionGaps: string[] = [];
  if (fromCollection) {
    const outOfBand = (held: number, target: number) => Math.abs(held - target) > tolerance(target);
    for (const t of targets) if (outOfBand(roleCounts.get(t.roleId) ?? 0, t.target)) collectionGaps.push(t.roleId);
    for (const [type, target] of typeTargets) if (outOfBand(typeCounts.get(type) ?? 0, target)) collectionGaps.push(type);
    if (curveBars?.some((target, bar) => outOfBand(curveCounts.get(curveBucket(bar)) ?? 0, target))) collectionGaps.push('curve');
    if (basicTotal > upperEdge(basicTarget)) collectionGaps.push('basicLands');
    const finalShort = deficits(basicEntries(split));
    for (const n of needs) if ((finalShort.get(n.colour) ?? 0) > 0) collectionGaps.push(`sources:${n.colour}`);
  }

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
      .sort((a, b) => b.score.total - a.score.total || byStaple(a.score, b.score) || a.card.name.localeCompare(b.card.name)),
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
  const feasibility: BuildFeasibility = {
    slots,
    filled: deck.length - filledByValue + basicTotal,
    filledByValue,
    open: slots - deck.length - basicTotal,
    collectionGaps,
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
