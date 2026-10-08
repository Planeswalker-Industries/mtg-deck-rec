import type { Bracket, StatTargets } from '../contract';
import type { BracketRules } from '../formats/commander/bracket';
import { CURVE_TOP_MANA_VALUE } from '../journey/deck-stats';
import { commanderShare } from './corpus';
import type { RoleTarget } from './cut';
import type { Profile } from './curve';
import { roleTargetsFor, type RankCorpus } from './rank';

export interface StatTargetsInput {
  /** The commander's corpus; null when the corpus has nothing for them. */
  corpus: RankCorpus | null;
  genericRoles: readonly RoleTarget[];
  /** `typical_deck_profile()`'s curve. */
  typicalCurve: Profile;
  /** `app_config.scoring.build`'s typical land counts by colour count. */
  build: { landCounts: readonly number[]; basicLandCounts: readonly number[] };
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
  const decks = Math.round(corpus?.effectiveDeckCount ?? 0);
  const label =
    source === 'commander'
      ? `${input.commanderLabel} decks (${decks})`
      : source === 'blended'
        ? `${input.commanderLabel} decks (${decks}), filled out with typical decks`
        : 'Typical decks';
  const ownCurve = corpus && Object.keys(corpus.curveProfile).length > 0 ? corpus.curveProfile : null;
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
    // The rules' schema holds both bracket numbers to 1-5, which is what `Bracket` names.
    bracketLimits: {
      massLandDenialFromBracket: massLandDenialFromBracket as Bracket,
      maxExtraTurnCards,
      extraTurnLoopResults,
      extraTurnLoopFromBracket: extraTurnLoopFromBracket as Bracket,
    },
  };
}
