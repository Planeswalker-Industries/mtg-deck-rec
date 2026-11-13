/**
 * How a card coming in compares with the card going out, as a few short marks shown under the pair in Fix and Swap
 * ("Cost" up, "Speed" up, "Popular"). The arrow says which way the thing moves, the tone whether that is good. Pure:
 * the caller supplies what it knows about each card, and a fact either card lacks makes no mark rather than a guess.
 */

/** What comparing reads from each card. */
export interface CompareCard {
  manaValue: number;
  /** The front face's type line decides speed: an instant or a card with flash beats one cast at sorcery speed. */
  typeLine: string;
  keywords: readonly string[];
  /** Share of this commander's decks that run the card (0..1), null without play data. */
  inclusionRate: number | null;
  /** Printed power and toughness, null for a non-creature or when unknown; "*" and the like make no mark. */
  power: string | null;
  toughness: string | null;
}

export type CompareTone = 'better' | 'worse';

export interface CompareMark {
  /** Stable key per kind of mark, for lists. */
  key: 'cost' | 'play' | 'speed' | 'body';
  tone: CompareTone;
  /** Which way the thing moves: more (a higher cost, a bigger body) is up. */
  direction: 'up' | 'down';
  /** One or two words: "Cost", "Speed", "Body", "Popular", "Rarely played". */
  label: string;
  /** The specifics, for screen readers: "1 more to cast", "6/6 body". */
  detail: string;
}

/** Play-rate gaps under this share (five points) are noise and make no mark. */
export const PLAY_MARK_MIN_SHARE = 0.05;

type Speed = 0 | 1 | 2;

/** 2 for instant speed (an instant, or flash), 1 for sorcery speed, 0 for a land, which isn't cast. */
function speedOf(card: CompareCard): Speed {
  const front = card.typeLine.split(' // ')[0] ?? card.typeLine;
  if (/\bLand\b/.test(front)) return 0;
  if (/\bInstant\b/.test(front) || card.keywords.includes('Flash')) return 2;
  return 1;
}

const whole = (s: string | null): number | null => (s !== null && /^\d+$/.test(s) ? Number(s) : null);

/** The marks for putting `incoming` in place of `outgoing`, in a fixed order: cost, speed, body, play. Price makes no mark. */
export function compareCards(outgoing: CompareCard, incoming: CompareCard): CompareMark[] {
  const marks: CompareMark[] = [];

  const outLand = speedOf(outgoing) === 0;
  const inLand = speedOf(incoming) === 0;
  if (!outLand && !inLand) {
    const cost = incoming.manaValue - outgoing.manaValue;
    if (cost !== 0) {
      const n = Math.abs(cost);
      marks.push(
        cost < 0
          ? { key: 'cost', tone: 'better', direction: 'down', label: 'Cost', detail: `${n} cheaper to cast` }
          : { key: 'cost', tone: 'worse', direction: 'up', label: 'Cost', detail: `${n} more to cast` },
      );
    }
    const speed = speedOf(incoming) - speedOf(outgoing);
    if (speed > 0) marks.push({ key: 'speed', tone: 'better', direction: 'up', label: 'Speed', detail: 'instant speed' });
    else if (speed < 0) marks.push({ key: 'speed', tone: 'worse', direction: 'down', label: 'Speed', detail: 'sorcery speed' });
  }

  const [op, ot, ip, it] = [whole(outgoing.power), whole(outgoing.toughness), whole(incoming.power), whole(incoming.toughness)];
  if (op !== null && ot !== null && ip !== null && it !== null && (ip !== op || it !== ot)) {
    const detail = `${ip}/${it} body`;
    if (ip >= op && it >= ot) marks.push({ key: 'body', tone: 'better', direction: 'up', label: 'Body', detail });
    else if (ip <= op && it <= ot) marks.push({ key: 'body', tone: 'worse', direction: 'down', label: 'Body', detail });
  }

  if (outgoing.inclusionRate !== null && incoming.inclusionRate !== null) {
    const gap = incoming.inclusionRate - outgoing.inclusionRate;
    if (Math.abs(gap) >= PLAY_MARK_MIN_SHARE) {
      marks.push(
        gap > 0
          ? { key: 'play', tone: 'better', direction: 'up', label: 'Popular', detail: 'played more with this commander' }
          : { key: 'play', tone: 'worse', direction: 'down', label: 'Rarely played', detail: 'rarely played with this commander' },
      );
    }
  }

  return marks;
}
