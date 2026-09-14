import path from 'node:path';
import { isValidPartnerPair, type CommanderCardFacts } from '@mtg/core/commander';
import type { CardId } from '@mtg/core/contract';
import type { SlimDeck } from '../sources/archidekt/deck';
import { DATA_DIR } from './config';
import type { Sql } from './db';

/** Shared by the corpus jobs so aggregation and measurement always count the same decks. */

export const DEFAULT_CORPUS_FILE = path.join(DATA_DIR, 'archidekt', 'spike', 'decks.jsonl');
export const IDENTITIES = 32;
const MAX_COMMANDERS = 2;

export interface CorpusConfig {
  shrinkAlpha: number;
  minDecks: number;
  fullDecks: number;
  maxUnresolvedCards: number;
}

const DEFAULT_CONFIG: CorpusConfig = { shrinkAlpha: 20, minDecks: 50, fullDecks: 300, maxUnresolvedCards: 3 };

export interface CatalogCard {
  id: number;
  name: string;
  colorIdentity: number;
  canBeCommander: boolean;
  legal: boolean;
  isBasicLand: boolean;
  slug: string;
  partnerKind: string | null;
  partnerQualifier: string | null;
  /** 'YYYY-MM' of the card's release, or null when unknown. */
  releaseMonth: string | null;
}

export const EXCLUSIONS = [
  'duplicate',
  'too_many_commanders',
  'commander_not_in_catalog',
  'commander_not_legal',
  'no_eligible_commander',
  'invalid_partner_pair',
  'outside_identity',
  'unresolved_cards',
] as const;
export type Exclusion = (typeof EXCLUSIONS)[number];

export interface ResolvedDeck {
  /** Commander card ids, ascending, joined with ':'. */
  key: string;
  /** Sorted by card id. */
  commanders: CatalogCard[];
  identity: number;
  bracket: string;
  /** 'YYYY-MM' the deck was last updated. */
  month: string;
  /** Non-basic cards in the 99, as catalog card ids. */
  cardIds: Set<number>;
}

export { decksSinceRelease, shrunkInclusion } from '@mtg/core/scoring';

export async function loadCorpusConfig(sql: Sql): Promise<CorpusConfig> {
  const [row] = await sql<{ value: Partial<CorpusConfig> }[]>`select value from public.app_config where key = 'corpus'`;
  return { ...DEFAULT_CONFIG, ...row?.value };
}

/** Live catalog cards by oracle id. */
export async function loadCatalog(sql: Sql): Promise<Map<string, CatalogCard>> {
  const rows = await sql<
    {
      id: number;
      oracle_id: string;
      name: string;
      color_identity: number;
      can_be_commander: boolean;
      legal_commander: string;
      is_basic_land: boolean;
      slug: string;
      partner_kind: string | null;
      partner_qualifier: string | null;
      release_month: string | null;
    }[]
  >`
    -- First printing, not cards.released_at: Oracle Cards dates a card by its representative (often latest) printing.
    select c.id, c.oracle_id::text, c.name, c.color_identity, c.can_be_commander, c.legal_commander, c.is_basic_land, c.slug,
           c.partner_kind, c.partner_qualifier, to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM') as release_month
    from public.cards c
    left join public.card_stats st on st.card_id = c.id
    where c.deleted_at is null
  `;
  const catalog = new Map<string, CatalogCard>();
  for (const r of rows) {
    catalog.set(r.oracle_id, {
      id: r.id,
      name: r.name,
      colorIdentity: r.color_identity,
      canBeCommander: r.can_be_commander,
      legal: r.legal_commander === 'legal',
      isBasicLand: r.is_basic_land,
      slug: r.slug,
      partnerKind: r.partner_kind,
      partnerQualifier: r.partner_qualifier,
      releaseMonth: r.release_month,
    });
  }
  if (catalog.size === 0) throw new Error('The card catalog is empty. Run sync:catalog first.');
  return catalog;
}

const commanderFacts = (c: CatalogCard): CommanderCardFacts => ({
  id: c.id as CardId,
  name: c.name,
  colorIdentityMask: c.colorIdentity,
  legalCommander: c.legal ? 'legal' : 'not_legal',
  canBeCommander: c.canBeCommander,
  partnerKind: c.partnerKind,
  partnerQualifier: c.partnerQualifier,
  copyLimit: null,
  gameChanger: false,
});

/**
 * A deck counts when its commanders (one, or a legal pair) are in the catalog and legal, every card fits their color
 * identity, and no more than `maxUnresolvedCards` cards are missing from the catalog. Duplicates are the caller's to
 * detect.
 */
export function resolveDeck(
  deck: SlimDeck,
  catalog: ReadonlyMap<string, CatalogCard>,
  config: CorpusConfig,
): { ok: true; deck: ResolvedDeck } | { ok: false; reason: Exclusion } {
  if (deck.commanders.length > MAX_COMMANDERS) return { ok: false, reason: 'too_many_commanders' };
  const commanders = deck.commanders.map((oracleId) => catalog.get(oracleId));
  if (!commanders.every((c): c is CatalogCard => c !== undefined)) return { ok: false, reason: 'commander_not_in_catalog' };
  if (!commanders.every((c) => c.legal)) return { ok: false, reason: 'commander_not_legal' };
  if (!commanders.some((c) => c.canBeCommander)) return { ok: false, reason: 'no_eligible_commander' };
  // Archidekt's Commander category also holds companions and misfiled cards; only real pairs share a command zone.
  const [first, second] = commanders;
  if (first && second && !isValidPartnerPair(commanderFacts(first), commanderFacts(second))) {
    return { ok: false, reason: 'invalid_partner_pair' };
  }

  const identity = commanders.reduce((mask, c) => mask | c.colorIdentity, 0);
  const cardIds = new Set<number>();
  let unresolved = 0;
  for (const [oracleId] of deck.cards) {
    const card = catalog.get(oracleId);
    if (!card) unresolved++;
    else if ((card.colorIdentity & ~identity) !== 0) return { ok: false, reason: 'outside_identity' };
    else if (!card.isBasicLand) cardIds.add(card.id);
  }
  if (unresolved > config.maxUnresolvedCards) return { ok: false, reason: 'unresolved_cards' };

  commanders.sort((a, b) => a.id - b.id);
  return {
    ok: true,
    deck: {
      key: commanders.map((c) => c.id).join(':'),
      commanders,
      identity,
      bracket: deck.edhBracket === null ? 'unset' : String(deck.edhBracket),
      month: deck.updatedAt.slice(0, 7),
      cardIds,
    },
  };
}
