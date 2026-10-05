import { COMMANDER_DECK_SIZE, isValidPartnerPair, type CommanderCardFacts } from './validate';

/**
 * The one rule a deck passes to count in the corpus statistics (docs/roadmap/card-graph-plan.md, "corpus"): a legal
 * commander or a legal pair, every card known to the catalog and inside the commanders' colour identity, exactly 100
 * cards. The collator applies it to every deck source, crawled and players' alike, so each counts decks the same way.
 *
 * Card legality beyond the commanders is deliberately not part of it: a deck last edited before a ban still says what
 * players run with that commander, and recommendations leave banned cards out on their own.
 */

/** The card facts the rule reads; mirrors columns on public.cards. */
export type CorpusCommanderFacts = Pick<
  CommanderCardFacts,
  'id' | 'name' | 'colorIdentityMask' | 'legalCommander' | 'canBeCommander' | 'partnerKind' | 'partnerQualifier'
>;

export const CORPUS_EXCLUSIONS = [
  /** No commander, or more than two. */
  'commander_count',
  /** A commander the catalog doesn't have (yet): the deck waits in raw and is tried again when the catalog changes. */
  'unresolved_commander',
  'commander_not_legal',
  /** Neither commander can lead a deck (a source's Commander section can hold companions and misfiled cards). */
  'no_eligible_commander',
  'invalid_partner_pair',
  /** A card the catalog doesn't have (yet): waits in raw like an unresolved commander. */
  'unresolved_cards',
  'outside_identity',
  'not_100_cards',
] as const;
export type CorpusExclusion = (typeof CORPUS_EXCLUSIONS)[number];

const MAX_COMMANDERS = 2;

/** The reasons the commanders alone can fail on. */
export type CorpusCommanderExclusion = Extract<
  CorpusExclusion,
  'commander_count' | 'unresolved_commander' | 'commander_not_legal' | 'no_eligible_commander' | 'invalid_partner_pair'
>;

export type CorpusCommanders =
  | { ok: true; commanders: CorpusCommanderFacts[]; identity: number }
  | { ok: false; reason: CorpusCommanderExclusion };

/**
 * The commanders half of the rule: one commander or a legal pair, all known and legal, at least one able to lead a
 * deck. Returns them sorted by card id, with their combined colour identity.
 */
export function corpusCommanders(commanders: readonly (CorpusCommanderFacts | undefined)[]): CorpusCommanders {
  if (commanders.length === 0 || commanders.length > MAX_COMMANDERS) return { ok: false, reason: 'commander_count' };
  if (!commanders.every((c): c is CorpusCommanderFacts => c !== undefined)) return { ok: false, reason: 'unresolved_commander' };
  if (!commanders.every((c) => c.legalCommander === 'legal')) return { ok: false, reason: 'commander_not_legal' };
  // A Background can't lead alone, so the pair check below decides whether its partner makes it legal.
  if (!commanders.some((c) => c.canBeCommander)) return { ok: false, reason: 'no_eligible_commander' };
  const [first, second] = commanders;
  if (first && second && (first.id === second.id || !isValidPartnerPair(first, second))) return { ok: false, reason: 'invalid_partner_pair' };
  return {
    ok: true,
    commanders: [...commanders].sort((a, b) => a.id - b.id),
    identity: commanders.reduce((mask, c) => mask | c.colorIdentityMask, 0),
  };
}

/** What a deck source knows about one deck, with its cards already looked up in the catalog. */
export interface CorpusDeckFacts {
  /** The deck's commanders as the source lists them; undefined where the catalog lacks one. */
  commanders: readonly (CorpusCommanderFacts | undefined)[];
  /** Cards in the rest of the deck the catalog lacks. */
  unresolvedCards: number;
  /** Union of the colour identities of the rest of the deck. */
  cardsIdentity: number;
  /** Every card, commanders and basic lands included, counting copies. */
  deckSize: number;
}

export type CorpusDeckCheck =
  | { ok: true; commanderIds: number[]; identity: number }
  | { ok: false; reason: CorpusExclusion };

/** The whole rule. On a pass, the commanders' card ids ascending and their colour identity. */
export function checkCorpusDeck(deck: CorpusDeckFacts): CorpusDeckCheck {
  const commanders = corpusCommanders(deck.commanders);
  if (!commanders.ok) return commanders;
  if (deck.unresolvedCards > 0) return { ok: false, reason: 'unresolved_cards' };
  if ((deck.cardsIdentity & ~commanders.identity) !== 0) return { ok: false, reason: 'outside_identity' };
  if (deck.deckSize !== COMMANDER_DECK_SIZE) return { ok: false, reason: 'not_100_cards' };
  return { ok: true, commanderIds: commanders.commanders.map((c) => c.id), identity: commanders.identity };
}
