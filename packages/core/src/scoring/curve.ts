import { CURVE_TOP_MANA_VALUE } from '../journey/deck-stats';
import { commanderShare, type CorpusThresholds } from './corpus';

/**
 * The learned skeleton (T062; scoring-design.md, "`curve`"): how many nonland cards a commander's decks run at each
 * mana value, how many lands and basic lands, and the shortfall a card's mana value fills against that curve.
 */

/** A profile keyed by bucket ('0' to '7', the last for CURVE_TOP_MANA_VALUE and above) or by role tag id. */
export type Profile = Readonly<Record<string, number>>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** The curve bucket of a mana value: whole mana values, everything from CURVE_TOP_MANA_VALUE up in the last one. */
export const curveBucket = (manaValue: number): string => String(Math.min(CURVE_TOP_MANA_VALUE, Math.max(0, Math.floor(manaValue))));

/** Whether a card's front face is a land (a modal land on its back doesn't make it one), as the deck groups read it. */
export const isFrontLand = (typeLine: string): boolean => /\bLand\b/.test(typeLine.split(' // ')[0] ?? typeLine);

/** A deck's nonland cards per curve bucket. */
export function deckCurve(cards: readonly { manaValue: number; isLand: boolean }[]): Map<string, number> {
  const curve = new Map<string, number>();
  for (const c of cards) {
    if (c.isLand) continue;
    const bucket = curveBucket(c.manaValue);
    curve.set(bucket, (curve.get(bucket) ?? 0) + 1);
  }
  return curve;
}

/** How short the deck is in a card's bucket against the target curve: (target − deck) / target, 0..1. */
export function curveShortfall(targets: Profile, deck: ReadonlyMap<string, number>, manaValue: number): number {
  const bucket = curveBucket(manaValue);
  const target = targets[bucket] ?? 0;
  return target > 0 ? clamp01((target - (deck.get(bucket) ?? 0)) / target) : 0;
}

/** Whether the deck runs more than `ratio` times the target in a card's bucket. */
export function curveOverloaded(targets: Profile, deck: ReadonlyMap<string, number>, manaValue: number, ratio: number): boolean {
  const bucket = curveBucket(manaValue);
  return (deck.get(bucket) ?? 0) > (targets[bucket] ?? 0) * ratio;
}

/** The curve's average mana value: the bucket from which a card counts as expensive for this commander. */
export function curveMeanManaValue(targets: Profile): number | null {
  let cards = 0;
  let total = 0;
  for (const [bucket, n] of Object.entries(targets)) {
    cards += n;
    total += Number(bucket) * n;
  }
  return cards > 0 ? total / cards : null;
}

/** EDHREC's profile for a commander and the decks it rests on (T062): the prior our own profile is blended toward. */
export interface ProfilePrior {
  roles: Profile;
  curve: Profile;
  /** The page's decks, capped like the play-rate prior (`pageEvidence`). */
  evidence: number;
}

/**
 * EDHREC's profiles scaled to a whole deck: a page lists only its most played cards, so summed inclusion runs well under
 * what decks hold (45 nonland cards against our decks' 64, locally on 2026-10-06). The curve is scaled to
 * `nonlandCards` and the roles by the same factor, keeping their shape.
 */
export function scaledPrior(raw: { roles: Profile; curve: Profile }, nonlandCards: number): { roles: Record<string, number>; curve: Record<string, number> } {
  const total = Object.values(raw.curve).reduce((sum, n) => sum + n, 0);
  const factor = total > 0 ? nonlandCards / total : 1;
  const scale = (profile: Profile) => Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, Math.round(v * factor * 100) / 100]));
  return { roles: scale(raw.roles), curve: scale(raw.curve) };
}

/**
 * The curve a deck is measured against: our decks' curve as they earn a share of the score (`commanderShare`), the
 * rest from EDHREC's curve for the commander when it has a page. Null when neither says anything yet.
 */
export function curveTargets(ours: Profile, ourEvidence: number, prior: ProfilePrior | null, thresholds: CorpusThresholds): Profile | null {
  const ourShare = Object.keys(ours).length > 0 ? commanderShare(ourEvidence, thresholds) : 0;
  const priorShare = prior && Object.keys(prior.curve).length > 0 ? commanderShare(prior.evidence, thresholds) : 0;
  if (ourShare === 0 && priorShare === 0) return null;
  if (priorShare === 0 || !prior) return ours;
  if (ourShare === 0) return prior.curve;
  const keys = new Set([...Object.keys(ours), ...Object.keys(prior.curve)]);
  return Object.fromEntries([...keys].map((k) => [k, ourShare * (ours[k] ?? 0) + (1 - ourShare) * (prior.curve[k] ?? 0)]));
}
