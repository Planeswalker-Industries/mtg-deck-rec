import type { AddSuggestion, CutSuggestion, FixCard, FixPool, OwnedInfo } from '../contract';
import { linesBoughtFor, type BuyLines } from '../journey/buy-for';
import { CURVE_LINE, toTallyCard } from '../journey/deck-tally';
import { curveBucket, isFrontLand, STAT_CARD_TYPES } from './curve';
import { rankKey } from './owned';
import { byStaple, type RankCard } from './rank';

/**
 * Fix's pool (T086): what the server hands the Fix engine (`@mtg/core/journey` `fix.ts`), from the scores adds and
 * cuts already give. Pure, so the app, the regression fixtures and the evaluation build it the same way.
 *
 * - In: the best `perLine` adds for each Deck stats line (every tracked role, card type, curve bar, lands and colour),
 *   and the best `perLine` whatever they do, so a line over its band has cards to bring in that break nothing. The
 *   basic lands of the deck's colours are always in. With lines opened to buying, the best `perLine` unowned cards for
 *   each opened line come too, marked with those lines. The in cards come in the order Fix tries them: best first, and
 *   in 'first' mode an owned card ahead of an unowned one that scores less than `ownedBoost` higher, as adds are
 *   ranked. The same order decides which cards a line keeps, so an owned card is not crowded out of the pool.
 * - Out: every main-deck card by how well it fits, 1 minus its cut score. `rankCuts` scores only cards with a reason to
 *   cut, so the rest sit above all of those, ordered by how much the commander's decks play them.
 */

/**
 * In cards kept per Deck stats line. A line a deck starts far outside its band needs about a dozen moves, and some
 * candidates break another line's band; a wider pool only adds to the response.
 */
export const FIX_INS_PER_LINE = 16;

const LANDS = 'lands';
const SOURCES_PREFIX = 'sources:';
const CURVE_BAR_PREFIX = `${CURVE_LINE}:`;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export interface FixPoolInput {
  /**
   * Every add `rankAdds` listed for the deck, with no cap per group: in 'only' mode the cards the collection supplies
   * and those for lines opened to buying.
   */
  adds: readonly AddSuggestion[];
  /** The tracked roles of an add's card. */
  rolesOf: (add: AddSuggestion) => readonly string[];
  /** The basic lands of the deck's colours (Wastes for a colourless deck), with the copies owned. */
  basics: readonly { card: RankCard; owned: OwnedInfo | null }[];
  /** The deck's main cards. */
  deck: readonly { card: RankCard; roles: readonly string[]; owned: OwnedInfo | null }[];
  /** `rankCuts` over the whole deck, with no limit: the cards with a reason to cut. */
  cuts: readonly CutSuggestion[];
  /** How much the commander's decks play a deck card, 0..1. Null when they can't judge it (a basic land, a new card). */
  playScore: (cardId: number) => number | null;
  /** The tracked roles (`deck_role_targets`). */
  roleIds: readonly string[];
  /** The deck's colours (`manaLetters`). */
  deckColours: string;
  /**
   * 'only' mode: the lines the player opened to buying (`buyLines`). An add with no owned copy is then a card to buy,
   * for the opened lines it helps. Null in every other mode: an unowned add is like any other.
   */
  buyLines: BuyLines | null;
  /** Whether a collection limits the adds to what it supplies ('only' mode). */
  only: boolean;
  /** How far an owned card moves up in 'first' mode (`app_config.ownership.firstBoost`); 0 in every other mode. */
  ownedBoost: number;
  perLine?: number;
}

interface In {
  fix: FixCard;
  /** The lines it is kept for: a role id, a card type, 'curve:3', 'lands', 'sources:U'. */
  lines: string[];
  staple: AddSuggestion['score'];
}

/** The pool for one deck. */
export function fixPool(input: FixPoolInput): FixPool {
  const perLine = input.perLine ?? FIX_INS_PER_LINE;
  // Every line a card can count on, read the way a card for an opened line is.
  const everyLine: BuyLines = {
    keys: [...input.roleIds, ...STAT_CARD_TYPES.map((t) => t.key), LANDS, ...[...input.deckColours].map((c) => `${SOURCES_PREFIX}${c}`)],
    curveBars: null,
    deckColours: input.deckColours,
  };
  const candidates = input.adds
    // A card that would complete a combo above the bracket breaks the bracket line it would be judged on.
    .filter((add) => !add.completesOverBracket?.length)
    .flatMap((add): In[] => {
      const roles = [...input.rolesOf(add)];
      const card = toTallyCard(add.card, roles);
      const toBuy = input.only && add.owned === null;
      const buyFor = toBuy ? linesBoughtFor(card, input.buyLines) : null;
      // 'only' mode lists an unowned card for an opened line alone.
      if (buyFor?.length === 0) return [];
      const lines = linesBoughtFor(card, everyLine);
      if (!isFrontLand(add.card.typeLine)) lines.push(`${CURVE_BAR_PREFIX}${curveBucket(add.card.manaValue)}`);
      const opened = (line: string) => buyFor === null || buyFor.includes(line.startsWith(CURVE_BAR_PREFIX) ? CURVE_LINE : line);
      return [
        {
          fix: { card: { ...add.card, roles }, roles, score: add.score.total, owned: add.owned, ...(buyFor ? { buyFor } : {}) },
          lines: lines.filter(opened),
          staple: add.score,
        },
      ];
    })
    .sort(
      (a, b) =>
        rankKey(b.fix.score, b.fix.owned !== null, input.ownedBoost) - rankKey(a.fix.score, a.fix.owned !== null, input.ownedBoost) ||
        byStaple(a.staple, b.staple) ||
        a.fix.card.name.localeCompare(b.fix.card.name) ||
        a.fix.card.id - b.fix.card.id,
    );

  // Best first, a card is kept while a line it counts on has room; supplied cards and cards to buy are counted apart.
  const kept = new Set<In>();
  const take = (pool: readonly In[], withAnyLine: boolean) => {
    const room = new Map<string, number>();
    let any = withAnyLine ? perLine : 0;
    for (const c of pool) {
      let wanted = false;
      for (const line of c.lines) {
        const left = room.get(line) ?? perLine;
        if (left <= 0) continue;
        room.set(line, left - 1);
        wanted = true;
      }
      if (any > 0) {
        any--;
        wanted = true;
      }
      if (wanted) kept.add(c);
    }
  };
  take(candidates.filter((c) => c.fix.buyFor === undefined), true);
  take(candidates.filter((c) => c.fix.buyFor !== undefined), false);

  const basics = input.basics.map(({ card, owned }): FixCard => ({ card: { ...card.summary, roles: [] }, roles: [], score: 0, owned }));

  const cutScores = new Map(input.cuts.map((s) => [s.card.id as number, s.cutScore]));
  // A card with no reason to cut fits better than every card with one: its place among the others is a share of the
  // weakest cut's score, by how little the commander's decks play it.
  const weakestCut = input.cuts.reduce((least, s) => Math.min(least, s.cutScore), 1);
  const deck = input.deck.map(({ card, roles, owned }): FixCard => {
    const cut = cutScores.get(card.summary.id);
    const cutScore = cut ?? weakestCut * (1 - (input.playScore(card.summary.id) ?? 1));
    return { card: { ...card.summary, roles: [...roles] }, roles: [...roles], score: round3(1 - cutScore), owned };
  });

  return { ins: [...candidates.filter((c) => kept.has(c)).map((c) => c.fix), ...basics], deck };
}
