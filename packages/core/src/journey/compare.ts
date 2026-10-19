/**
 * How a replacement compares with the card it would replace, as a few better/worse marks the Swap step shows under the
 * pair ("1 cheaper to cast", "played in more decks"). Pure: the panel supplies what it knows about each card, and a
 * fact either card lacks makes no mark rather than a guess.
 */

/** What comparing reads from each card. */
export interface CompareCard {
  manaValue: number;
  /** The front face's type line decides speed: an instant or a card with flash beats one cast at sorcery speed. */
  typeLine: string;
  keywords: readonly string[];
  /** Estimated price in USD, null when unpriced. */
  priceUsd: number | null;
  /** Share of this commander's decks that run the card (0..1), null without play data. */
  inclusionRate: number | null;
  /** Printed power and toughness, null for a non-creature; "*" and the like make no mark. */
  power: string | null;
  toughness: string | null;
}

export type CompareTone = 'better' | 'worse';

export interface CompareMark {
  /** Stable key per kind of mark, for lists. */
  key: 'cost' | 'price' | 'play' | 'speed' | 'body';
  tone: CompareTone;
  /** Short and plain: "1 cheaper to cast", "$2.10 dearer", "Instant speed". */
  label: string;
}

/** Price gaps under this many dollars are noise on an estimate and make no mark. */
export const PRICE_MARK_MIN_USD = 0.5;
/** Play-rate gaps under this share (five points) are noise and make no mark. */
export const PLAY_MARK_MIN_SHARE = 0.05;

const PERCENT = 100;

type Speed = 0 | 1 | 2;

/** 2 for instant speed (an instant, or flash), 1 for sorcery speed, 0 for a land, which isn't cast. */
function speedOf(card: CompareCard): Speed {
  const front = card.typeLine.split(' // ')[0] ?? card.typeLine;
  if (/\bLand\b/.test(front)) return 0;
  if (/\bInstant\b/.test(front) || card.keywords.includes('Flash')) return 2;
  return 1;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const whole = (s: string | null): number | null => (s !== null && /^\d+$/.test(s) ? Number(s) : null);

/** The marks for putting `incoming` in place of `outgoing`, in a fixed order: cost, speed, body, play, price. */
export function compareCards(outgoing: CompareCard, incoming: CompareCard): CompareMark[] {
  const marks: CompareMark[] = [];

  const outLand = speedOf(outgoing) === 0;
  const inLand = speedOf(incoming) === 0;
  if (!outLand && !inLand) {
    const cost = incoming.manaValue - outgoing.manaValue;
    if (cost !== 0) {
      const n = Math.abs(cost);
      marks.push(cost < 0 ? { key: 'cost', tone: 'better', label: `${n} cheaper to cast` } : { key: 'cost', tone: 'worse', label: `${n} more to cast` });
    }
    const speed = speedOf(incoming) - speedOf(outgoing);
    if (speed > 0) marks.push({ key: 'speed', tone: 'better', label: 'Instant speed' });
    else if (speed < 0) marks.push({ key: 'speed', tone: 'worse', label: 'Sorcery speed' });
  }

  const [op, ot, ip, it] = [whole(outgoing.power), whole(outgoing.toughness), whole(incoming.power), whole(incoming.toughness)];
  if (op !== null && ot !== null && ip !== null && it !== null && (ip !== op || it !== ot)) {
    const label = `${ip}/${it} body`;
    if (ip >= op && it >= ot) marks.push({ key: 'body', tone: 'better', label: `Bigger: ${label}` });
    else if (ip <= op && it <= ot) marks.push({ key: 'body', tone: 'worse', label: `Smaller: ${label}` });
  }

  if (outgoing.inclusionRate !== null && incoming.inclusionRate !== null) {
    const gap = incoming.inclusionRate - outgoing.inclusionRate;
    if (Math.abs(gap) >= PLAY_MARK_MIN_SHARE) {
      const points = Math.round(Math.abs(gap) * PERCENT);
      marks.push(
        gap > 0
          ? { key: 'play', tone: 'better', label: `In ${plural(points, 'point')} more decks` }
          : { key: 'play', tone: 'worse', label: `In ${plural(points, 'point')} fewer decks` },
      );
    }
  }

  if (outgoing.priceUsd !== null && incoming.priceUsd !== null) {
    const gap = incoming.priceUsd - outgoing.priceUsd;
    if (Math.abs(gap) >= PRICE_MARK_MIN_USD) {
      marks.push(gap < 0 ? { key: 'price', tone: 'better', label: `${usd(-gap)} cheaper` } : { key: 'price', tone: 'worse', label: `${usd(gap)} dearer` });
    }
  }

  return marks;
}
