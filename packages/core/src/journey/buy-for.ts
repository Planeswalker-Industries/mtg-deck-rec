import type { StatTargets } from '../contract';
import { curveBucket, isFrontLand, isStatCardType, statCardType } from '../scoring/curve';
import { isBasicLand } from './builder';
import { CURVE_TOP_MANA_VALUE } from './deck-stats';
import { cardsShort, CURVE_LINE, type DeckTally, type TallyCard } from './deck-tally';
import { colourTarget, manaBase, sourceCredit } from './mana-base';

/**
 * Buying per line (T086). In 'only' mode a player may open a Deck stats line to unowned cards (`RecContext.buyFor`).
 * These say which opened lines a card helps, so adds, cuts, builds and Fix read it the same way.
 */

const SOURCES_PREFIX = 'sources:';
const LANDS = 'lands';
const BASIC_LANDS = 'basicLands';

/** A source is judged against the costliest spell the curve counts, so a rock that only helps late spells counts too. */
const SOURCE_SPELL_MANA_VALUE = CURVE_TOP_MANA_VALUE;

/** The lines a card may be bought for. */
export interface BuyLines {
  /** Line keys: a role id, a card type, 'curve', 'lands', 'basicLands' or a colour's 'sources:B'. */
  keys: readonly string[];
  /** With 'curve' among the keys: the bars a card may be bought for. Null: every bar. */
  curveBars: ReadonlySet<number> | null;
  /** The deck's colours (`manaLetters`), for reading what a card is a source of. */
  deckColours: string;
}

/**
 * Every opened line, whatever the deck holds: what cuts and Fix read (Fix stops at a line's band by itself). Null with
 * no line opened.
 */
export function buyLines(buyFor: readonly string[] | undefined, deckColours: string): BuyLines | null {
  const keys = [...new Set(buyFor ?? [])];
  return keys.length > 0 ? { keys, curveBars: null, deckColours } : null;
}

/**
 * The opened lines still short of their target in a deck: what cards to add read, so buying stops at the target.
 * 'basicLands' is open while the deck holds more basics than its target: a nonbasic land takes one's place. Null when
 * none is open.
 */
export function openBuyLines(buyFor: readonly string[] | undefined, deckColours: string, tally: DeckTally, targets: StatTargets): BuyLines | null {
  const all = buyLines(buyFor, deckColours);
  if (!all) return null;
  const short = (value: number, target: number) => cardsShort({ value, target }) > 0;
  const curveBars = new Set(targets.curve.flatMap((target, bar) => (short(tally.curve[bar] ?? 0, target) ? [bar] : [])));
  const roleTargets = new Map(targets.roles.map((r) => [r.roleId, r.target]));
  const typeTargets = new Map(targets.types.map((t) => [t.cardType, t.target]));
  const mana = all.keys.some((key) => key.startsWith(SOURCES_PREFIX)) ? manaBase([...tally.main.values()], tally.commanders, deckColours) : null;
  const cap = targets.colourSourceCap ?? null;
  const open = (key: string): boolean => {
    if (key === CURVE_LINE) return curveBars.size > 0;
    if (key === LANDS) return short(tally.lands, targets.lands);
    if (key === BASIC_LANDS) return tally.basicLands > Math.round(targets.basicLands);
    if (key.startsWith(SOURCES_PREFIX)) {
      const need = mana?.colours.find((n) => n.colour === key.slice(SOURCES_PREFIX.length));
      return need !== undefined && need.sources < colourTarget(need.needed, cap);
    }
    const role = roleTargets.get(key);
    if (role !== undefined) return short(tally.roles.get(key) ?? 0, role);
    const type = typeTargets.get(key);
    return type !== undefined && short(tally.types.get(key) ?? 0, type);
  };
  const keys = all.keys.filter(open);
  return keys.length > 0 ? { keys, curveBars, deckColours } : null;
}

/** The lines among `lines` that one copy of a card helps; none without lines. */
export function linesBoughtFor(card: TallyCard, lines: BuyLines | null): string[] {
  if (!lines) return [];
  const land = isFrontLand(card.typeLine);
  return lines.keys.filter((key) => {
    if (key === LANDS) return land;
    if (key === BASIC_LANDS) return land && !isBasicLand(card);
    if (key === CURVE_LINE) return !land && (lines.curveBars === null || lines.curveBars.has(Number(curveBucket(card.manaValue))));
    if (key.startsWith(SOURCES_PREFIX)) return sourceCredit(card, key.slice(SOURCES_PREFIX.length), SOURCE_SPELL_MANA_VALUE, lines.deckColours) > 0;
    if (isStatCardType(key)) return !land && statCardType(card.typeLine) === key;
    return card.roles.includes(key);
  });
}
