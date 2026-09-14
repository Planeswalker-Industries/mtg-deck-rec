import type { CardId, CutReason } from '../contract';

export interface CutCandidate {
  cardId: CardId;
  manaValue: number;
  isLand: boolean;
  isCommanderLegal: boolean;
  withinIdentity: boolean;
  gameChanger: boolean;
  /** Role tags (from the role targets) this card belongs to. */
  roleIds: readonly string[];
  /** 0..1 play-rate score from the commander's own decks; null or absent without enough of them. */
  corpusScore?: number | null;
}

export interface RoleTarget {
  roleId: string;
  label: string;
  /** How many cards a typical Commander deck runs in this role. */
  target: number;
}

export interface CutOptions {
  includeGameChangers: boolean;
  gameChangerLimit: number;
  roleTargets: readonly RoleTarget[];
}

export interface CutScore {
  cardId: CardId;
  /** 0..1, higher = stronger cut candidate */
  cutScore: number;
  reasons: CutReason[];
}

/** A role is overloaded once the deck has this much more than its target. */
export const ROLE_OVERLOAD_RATIO = 1.25;

/** Nonland cards at or above this mana value are flagged as expensive. */
export const HIGH_MANA_VALUE = 6;

/** Below this play-rate score (roughly: in under 3% of the commander's decks, and no more than elsewhere) a card is low synergy. */
export const LOW_SYNERGY_SCORE = 0.35;

/** At or above this play-rate score, decks with the commander clearly run the card; cost alone isn't a reason to cut it. */
export const WELL_PLAYED_SCORE = 0.5;

/** Optional cuts stay below rule problems, which always score 1. */
const OPTIONAL_CUT_CAP = 0.95;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cut suggestions: rule problems first (score 1), then optional cuts. With play rates from the commander's decks, an
 * optional cut scores 0.5·(1 − play rate) + 0.3·(role overloaded) + 0.2·(relative mana value), and cards those decks
 * clearly run are flagged for neither cost nor role overlap (generic role targets don't know that, say, Krenko decks
 * run far more removal). Without play rates: cards whose every tracked role is overloaded, then expensive cards.
 * Cards with no reason are left out rather than guessed at. Pass the main deck only (no commanders).
 */
export function scoreCuts(cards: readonly CutCandidate[], options: CutOptions): CutScore[] {
  const tracked = new Set(options.roleTargets.map((t) => t.roleId));
  const roleCounts = new Map<string, number>();
  for (const card of cards) {
    for (const role of new Set(card.roleIds)) {
      if (tracked.has(role)) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
  }
  const overloaded = new Set(
    options.roleTargets.filter((t) => (roleCounts.get(t.roleId) ?? 0) > t.target * ROLE_OVERLOAD_RATIO).map((t) => t.roleId),
  );
  const gameChangerCount = cards.filter((c) => c.gameChanger).length;
  const maxManaValue = Math.max(1, ...cards.map((c) => c.manaValue));

  const results: CutScore[] = [];
  for (const card of cards) {
    const reasons: CutReason[] = [];
    if (!card.isCommanderLegal) reasons.push('NOT_LEGAL');
    if (!card.withinIdentity) reasons.push('OUTSIDE_COLOR_IDENTITY');
    if (card.gameChanger && !options.includeGameChangers) reasons.push('GAME_CHANGER_EXCLUDED');
    else if (card.gameChanger && gameChangerCount > options.gameChangerLimit) reasons.push('OVER_BRACKET_GC_LIMIT');
    const mustCut = reasons.length > 0;

    const corpusScore = card.corpusScore ?? null;
    const wellPlayed = corpusScore !== null && corpusScore >= WELL_PLAYED_SCORE;
    const lowSynergy = corpusScore !== null && corpusScore < LOW_SYNERGY_SCORE;
    if (lowSynergy) reasons.push('LOW_SYNERGY');
    const cardRoles = card.roleIds.filter((r) => tracked.has(r));
    const redundant = !card.isLand && !wellPlayed && cardRoles.length > 0 && cardRoles.every((r) => overloaded.has(r));
    if (redundant) reasons.push('ROLE_REDUNDANT');
    const expensive = !card.isLand && card.manaValue >= HIGH_MANA_VALUE;
    if (expensive) reasons.push('HIGH_MANA_VALUE');

    if (reasons.length === 0) continue;
    if (!mustCut && wellPlayed) continue;

    const manaShare = card.isLand ? 0 : card.manaValue / maxManaValue;
    let cutScore: number;
    if (mustCut) cutScore = 1;
    else if (corpusScore !== null) cutScore = Math.min(OPTIONAL_CUT_CAP, 0.5 * (1 - corpusScore) + 0.3 * (redundant ? 1 : 0) + 0.2 * manaShare);
    else cutScore = redundant ? 0.5 + 0.4 * manaShare : 0.3 + 0.2 * manaShare;
    results.push({ cardId: card.cardId, cutScore: round2(cutScore), reasons });
  }
  return results.sort((a, b) => b.cutScore - a.cutScore);
}
