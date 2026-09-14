import path from 'node:path';
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
  colorIdentity: number;
  canBeCommander: boolean;
  legal: boolean;
  isBasicLand: boolean;
  slug: string;
}

export const EXCLUSIONS = [
  'duplicate',
  'too_many_commanders',
  'commander_not_in_catalog',
  'commander_not_legal',
  'no_eligible_commander',
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
  /** Non-basic cards in the 99, as catalog card ids. */
  cardIds: Set<number>;
}

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
      color_identity: number;
      can_be_commander: boolean;
      legal_commander: string;
      is_basic_land: boolean;
      slug: string;
    }[]
  >`
    select id, oracle_id::text, color_identity, can_be_commander, legal_commander, is_basic_land, slug
    from public.cards
    where deleted_at is null
  `;
  const catalog = new Map<string, CatalogCard>();
  for (const r of rows) {
    catalog.set(r.oracle_id, {
      id: r.id,
      colorIdentity: r.color_identity,
      canBeCommander: r.can_be_commander,
      legal: r.legal_commander === 'legal',
      isBasicLand: r.is_basic_land,
      slug: r.slug,
    });
  }
  if (catalog.size === 0) throw new Error('The card catalog is empty. Run sync:catalog first.');
  return catalog;
}

/**
 * A deck counts when its commanders (at most two, at least one able to lead) are in the catalog and legal, every card
 * fits their color identity, and no more than `maxUnresolvedCards` cards are missing from the catalog. Duplicates are
 * the caller's to detect.
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
      cardIds,
    },
  };
}

export { shrunkInclusion } from '@mtg/core/scoring';
