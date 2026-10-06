import type { CardId, CutReason, CutSeverity } from '../contract';
import type { CutScoring } from './config';

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
  /** Mass land denial (`bracket_cards`). */
  massLandDenial?: boolean;
  /** An extra-turn card (`bracket_cards`). */
  extraTurn?: boolean;
  /** A piece of a complete combo above the deck's bracket. */
  overBracketCombo?: boolean;
  /** A piece of a complete extra-turn loop the bracket doesn't allow. */
  extraTurnLoop?: boolean;
  /** A piece of a complete combo the bracket allows: combo pieces often have low play rates on their own. */
  comboPiece?: boolean;
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
  /**
   * Below this play-rate score a card is a severe misfit: a mandatory cut rather than a suggestion. Lives in app_config
   * (corpus.severeSynergyScore); absent means no card is a misfit on play rates alone.
   */
  severeSynergyScore?: number;
  /** Thresholds and weights (`app_config.scoring.cuts`). */
  scoring: CutScoring;
  /** The bracket allows mass land denial; absent means it does. */
  massLandDenialAllowed?: boolean;
  /** Extra-turn cards the bracket allows; absent means no limit. */
  extraTurnLimit?: number;
}

export interface CutScore {
  cardId: CardId;
  /** 0..1, higher = stronger cut candidate */
  cutScore: number;
  reasons: CutReason[];
  severity: CutSeverity;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cut suggestions: rule problems first (score 1), then bracket flags (over-bracket combos and extra turns, at the
 * optional cut cap, with a replacement offered), then optional cuts. Rule problems and severe misfits are mandatory
 * (the deck is better without them whatever replaces them) and sort first; the rest are suggestions. With play rates
 * from the commander's decks, an optional cut weighs (1 − play rate), role overload and relative mana value
 * (`scoring.withCorpus`), and cards those decks clearly run are flagged for neither cost nor role overlap (generic role
 * targets don't know that, say, Krenko decks run far more removal). Without play rates: cards whose every tracked role
 * is overloaded, then expensive cards (`scoring.withoutCorpus`).
 * Cards with no reason are left out rather than guessed at. Pass the main deck only (no commanders).
 */
export function scoreCuts(cards: readonly CutCandidate[], options: CutOptions): CutScore[] {
  const { scoring } = options;
  const tracked = new Set(options.roleTargets.map((t) => t.roleId));
  const roleCounts = new Map<string, number>();
  for (const card of cards) {
    for (const role of new Set(card.roleIds)) {
      if (tracked.has(role)) roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
  }
  const overloaded = new Set(
    options.roleTargets.filter((t) => (roleCounts.get(t.roleId) ?? 0) > t.target * scoring.roleOverloadRatio).map((t) => t.roleId),
  );
  const gameChangerCount = cards.filter((c) => c.gameChanger).length;
  const extraTurnCount = cards.filter((c) => c.extraTurn).length;
  const extraTurnLimit = options.extraTurnLimit ?? Number.POSITIVE_INFINITY;
  const maxManaValue = Math.max(1, ...cards.map((c) => c.manaValue));

  const results: CutScore[] = [];
  for (const card of cards) {
    const reasons: CutReason[] = [];
    if (!card.isCommanderLegal) reasons.push('NOT_LEGAL');
    if (!card.withinIdentity) reasons.push('OUTSIDE_COLOR_IDENTITY');
    if (card.gameChanger && !options.includeGameChangers) reasons.push('GAME_CHANGER_EXCLUDED');
    else if (card.gameChanger && gameChangerCount > options.gameChangerLimit) reasons.push('OVER_BRACKET_GC_LIMIT');
    if (card.massLandDenial && options.massLandDenialAllowed === false) reasons.push('OVER_BRACKET_MLD');
    const mustCut = reasons.length > 0;

    if (card.overBracketCombo) reasons.push('OVER_BRACKET_COMBO');
    if (card.extraTurnLoop || (card.extraTurn && extraTurnCount > extraTurnLimit)) reasons.push('OVER_BRACKET_EXTRA_TURNS');
    const flagged = reasons.length > 0 && !mustCut;

    const corpusScore = card.corpusScore ?? null;
    const wellPlayed = corpusScore !== null && corpusScore >= scoring.wellPlayedScore;
    // A piece of a combo the deck is allowed is there for the combo, so its play rate alone doesn't condemn it.
    const judged = card.comboPiece ? null : corpusScore;
    const lowSynergy = judged !== null && judged < scoring.lowSynergyScore;
    if (lowSynergy) reasons.push('LOW_SYNERGY');
    const severeMisfit = judged !== null && options.severeSynergyScore !== undefined && judged < options.severeSynergyScore;
    const cardRoles = card.roleIds.filter((r) => tracked.has(r));
    const redundant = !card.isLand && !wellPlayed && cardRoles.length > 0 && cardRoles.every((r) => overloaded.has(r));
    if (redundant) reasons.push('ROLE_REDUNDANT');
    const expensive = !card.isLand && card.manaValue >= scoring.highManaValue;
    if (expensive) reasons.push('HIGH_MANA_VALUE');

    if (reasons.length === 0) continue;
    if (!mustCut && !flagged && wellPlayed) continue;

    const manaShare = card.isLand ? 0 : card.manaValue / maxManaValue;
    let cutScore: number;
    if (mustCut) cutScore = 1;
    else if (flagged) cutScore = scoring.optionalCutCap;
    else if (corpusScore !== null) {
      const w = scoring.withCorpus;
      cutScore = Math.min(scoring.optionalCutCap, w.corpus * (1 - corpusScore) + w.role * (redundant ? 1 : 0) + w.manaValue * manaShare);
    } else {
      const w = scoring.withoutCorpus;
      cutScore = redundant ? w.redundantBase + w.redundantManaValue * manaShare : w.base + w.manaValue * manaShare;
    }
    const severity: CutSeverity = mustCut || severeMisfit ? 'mandatory' : 'suggested';
    results.push({ cardId: card.cardId, cutScore: round2(cutScore), reasons, severity });
  }
  const mandatoryFirst = (s: CutScore) => (s.severity === 'mandatory' ? 1 : 0);
  return results.sort((a, b) => mandatoryFirst(b) - mandatoryFirst(a) || b.cutScore - a.cutScore);
}
