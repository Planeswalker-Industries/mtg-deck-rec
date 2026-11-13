import type { Bracket, StatTargets } from '../contract';
import type { BracketRules } from '../formats/commander/bracket';
import { CURVE_TOP_MANA_VALUE } from '../journey/deck-stats';
import { commanderShare } from './corpus';
import type { RoleTarget } from './cut';
import { STAT_CARD_TYPES, type Profile } from './curve';
import { roleTargetsFor, type RankCorpus } from './rank';

export interface StatTargetsInput {
  /**
   * The commander's corpus; null when the corpus has nothing for them. The share reads its effective deck count (own
   * plus borrowed partner decks at their weight); the label names its own decks and says when partners' were borrowed.
   */
  corpus: (RankCorpus & { ownDeckCount: number; borrowedDeckCount: number }) | null;
  genericRoles: readonly RoleTarget[];
  /** `typical_deck_profile()`'s curve. */
  typicalCurve: Profile;
  /** `typical_deck_profile()`'s types (T071); empty until a full pass has written type profiles, which leaves types out. */
  typicalTypes: Profile;
  /** The commander's nonland cards per type over the corpus's source decks at their weights; empty when unknown. */
  commanderTypes: Profile;
  /** `app_config.scoring.build`'s typical land counts and colour source caps by colour count. */
  build: { landCounts: readonly number[]; basicLandCounts: readonly number[]; colourSourceCaps: readonly (number | null)[] };
  colourCount: number;
  bracketRules: BracketRules;
  /** The commanders as the label names them: "Liesa", "Tymna & Thrasios". */
  commanderLabel: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function at(values: readonly number[], index: number, name: string): number {
  const value = values[index];
  if (value === undefined) throw new Error(`${name} has no value for ${index} colours.`);
  return value;
}

/** Deck stats' targets: the commander's averages blended toward typical decks by the commander's share (T045). */
export function statTargetsFor(input: StatTargetsInput): StatTargets {
  const { corpus } = input;
  const share = corpus ? commanderShare(corpus.effectiveDeckCount, corpus.settings) : 0;
  const blend = (own: number | null | undefined, typical: number) =>
    own === null || own === undefined || share === 0 ? round1(typical) : round1(share * own + (1 - share) * typical);
  const source = share >= 1 ? 'commander' : share > 0 ? 'blended' : 'typical';
  const borrowed = corpus !== null && corpus.borrowedDeckCount > 0 ? ' with partner decks' : '';
  const named = `${input.commanderLabel} decks (${corpus?.ownDeckCount ?? 0})${borrowed}`;
  const label = source === 'commander' ? named : source === 'blended' ? `${named}, filled out with typical decks` : 'Typical decks';
  const ownCurve = corpus && Object.keys(corpus.curveProfile).length > 0 ? corpus.curveProfile : null;
  const ownTypes = corpus && Object.keys(input.commanderTypes).length > 0 ? input.commanderTypes : null;
  const hasTypes = Object.keys(input.typicalTypes).length > 0;
  const { massLandDenialFromBracket, maxExtraTurnCards, extraTurnLoopResults, extraTurnLoopFromBracket } = input.bracketRules;
  return {
    source,
    label,
    lands: blend(corpus?.landCount, at(input.build.landCounts, input.colourCount, 'landCounts')),
    basicLands: blend(corpus?.basicLandCount, at(input.build.basicLandCounts, input.colourCount, 'basicLandCounts')),
    roles: (corpus ? roleTargetsFor(input.genericRoles, corpus) : [...input.genericRoles]).map((t) => ({
      roleId: t.roleId,
      label: t.label,
      target: t.target,
    })),
    curve: Array.from({ length: CURVE_TOP_MANA_VALUE + 1 }, (_, bar) =>
      blend(ownCurve ? (ownCurve[String(bar)] ?? 0) : null, input.typicalCurve[String(bar)] ?? 0),
    ),
    types: hasTypes
      ? STAT_CARD_TYPES.map((t) => ({
          cardType: t.key,
          label: t.label,
          target: blend(ownTypes ? (ownTypes[t.key] ?? 0) : null, input.typicalTypes[t.key] ?? 0),
        }))
      : [],
    colourSourceCap: input.build.colourSourceCaps[input.colourCount] ?? null,
    // The rules' schema holds both bracket numbers to 1-5, which is what `Bracket` names.
    bracketLimits: {
      massLandDenialFromBracket: massLandDenialFromBracket as Bracket,
      maxExtraTurnCards,
      extraTurnLoopResults,
      extraTurnLoopFromBracket: extraTurnLoopFromBracket as Bracket,
    },
  };
}
