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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cut suggestions that don't need play-rate data: rule problems first (score 1), then cards whose every tracked role
 * is overloaded, then expensive cards. Within each group, higher mana value ranks higher. Cards with no reason
 * are left out rather than guessed at. Pass the main deck only (no commanders).
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

    const cardRoles = card.roleIds.filter((r) => tracked.has(r));
    const redundant = !card.isLand && cardRoles.length > 0 && cardRoles.every((r) => overloaded.has(r));
    if (redundant) reasons.push('ROLE_REDUNDANT');
    if (!card.isLand && card.manaValue >= HIGH_MANA_VALUE) reasons.push('HIGH_MANA_VALUE');
    if (reasons.length === 0) continue;

    const manaShare = card.manaValue / maxManaValue;
    const cutScore = mustCut ? 1 : redundant ? 0.5 + 0.4 * manaShare : 0.3 + 0.2 * manaShare;
    results.push({ cardId: card.cardId, cutScore: round2(cutScore), reasons });
  }
  return results.sort((a, b) => b.cutScore - a.cutScore);
}
