import { isValidPartnerPair, type CommanderCardFacts } from '@mtg/core/commander';
import type { CardId } from '@mtg/core/contract';
import type { Sql } from './db';

/** Shared by the corpus jobs, so every job counts the same decks. */

export const IDENTITIES = 32;
const MAX_COMMANDERS = 2;
/** Decks read from corpus.decks per round trip. */
const CORPUS_CURSOR_ROWS = 1000;

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

/**
 * One deck as the collated corpus.decks holds it: resolved to our card ids by the collator (T054), with basics out of
 * the card list.
 */
export interface CorpusDeck {
  source: string;
  /** The source's own deck id; unique within a source. */
  sourceDeckId: string;
  /** Commander card ids, ascending. */
  commanderIds: number[];
  /** Card ids of the rest of the deck, distinct, basics excluded. */
  cardIds: number[];
  /** 'YYYY-MM' the deck was last updated. */
  month: string;
}

export const EXCLUSIONS = [
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

/** Live catalog cards by card id. */
export async function loadCatalog(sql: Sql): Promise<Map<number, CatalogCard>> {
  const rows = await sql<
    {
      id: number;
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
    select c.id, c.name, c.color_identity, c.can_be_commander, c.legal_commander, c.is_basic_land, c.slug,
           c.partner_kind, c.partner_qualifier, to_char(coalesce(st.first_printed_at, c.released_at), 'YYYY-MM') as release_month
    from public.cards c
    left join public.card_stats st on st.card_id = c.id
    where c.deleted_at is null
  `;
  const catalog = new Map<number, CatalogCard>();
  for (const r of rows) {
    catalog.set(r.id, {
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

/**
 * Which tracked roles (deck_role_targets) each card fills, through the tag hierarchy and skipping disabled tags.
 * Mirrors public.rec_card_roles, which the app uses for the deck being analyzed.
 */
export async function loadRoleCards(sql: Sql): Promise<Map<number, string[]>> {
  const [config] = await sql<{ value: { roles?: { tagId?: unknown }[] } }[]>`
    select value from public.app_config where key = 'deck_role_targets'
  `;
  const roleIds = (config?.value.roles ?? []).flatMap((r) => (typeof r.tagId === 'string' ? [r.tagId] : []));
  if (roleIds.length === 0) return new Map();
  const rows = await sql<{ card_id: number; role_id: string }[]>`
    select distinct ct.card_id, tc.ancestor_id::text as role_id
    from public.card_tags ct
    join public.tags t on t.id = ct.tag_id and not t.disabled and t.deleted_at is null
    join public.tag_closure tc on tc.descendant_id = ct.tag_id
    where tc.ancestor_id = any (${roleIds}::uuid[])
  `;
  const rolesByCard = new Map<number, string[]>();
  for (const r of rows) rolesByCard.set(r.card_id, [...(rolesByCard.get(r.card_id) ?? []), r.role_id]);
  return rolesByCard;
}

/**
 * The collated decks the corpus jobs count, streamed so the whole corpus is never in memory at once. corpus.decks is
 * written only by the collator (T054); until it runs, the table is empty.
 */
export async function* loadCorpusDecks(sql: Sql): AsyncGenerator<CorpusDeck> {
  const cursor = sql<{ source: string; source_deck_id: string; commander_card_ids: number[]; card_ids: number[]; month: string }[]>`
    select source, source_deck_id, commander_card_ids, card_ids, to_char(updated_month, 'YYYY-MM') as month
    from corpus.decks
    order by id
  `.cursor(CORPUS_CURSOR_ROWS);
  for await (const rows of cursor) {
    for (const r of rows) {
      yield { source: r.source, sourceDeckId: r.source_deck_id, commanderIds: r.commander_card_ids, cardIds: r.card_ids, month: r.month };
    }
  }
}

/** When corpus.decks last changed and how many decks it holds. */
export async function corpusVersion(sql: Sql): Promise<{ updatedAt: string; decks: number }> {
  const [row] = await sql<{ updated_at: Date | null; decks: number }[]>`
    select max(collated_at) as updated_at, count(*)::int as decks from corpus.decks
  `;
  return { updatedAt: (row?.updated_at ?? new Date(0)).toISOString(), decks: row?.decks ?? 0 };
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
 * identity, and no more than `maxUnresolvedCards` cards are missing from the live catalog. The collator applies the
 * same rule when it writes corpus.decks, so this only catches what changed since: a card the catalog has since dropped,
 * a commander since banned.
 */
export function resolveDeck(
  deck: CorpusDeck,
  catalog: ReadonlyMap<number, CatalogCard>,
  config: CorpusConfig,
): { ok: true; deck: ResolvedDeck } | { ok: false; reason: Exclusion } {
  if (deck.commanderIds.length > MAX_COMMANDERS) return { ok: false, reason: 'too_many_commanders' };
  const commanders = deck.commanderIds.map((id) => catalog.get(id));
  if (!commanders.every((c): c is CatalogCard => c !== undefined)) return { ok: false, reason: 'commander_not_in_catalog' };
  if (!commanders.every((c) => c.legal)) return { ok: false, reason: 'commander_not_legal' };
  if (!commanders.some((c) => c.canBeCommander)) return { ok: false, reason: 'no_eligible_commander' };
  // A source's Commander section can also hold companions and misfiled cards; only real pairs share a command zone.
  const [first, second] = commanders;
  if (first && second && !isValidPartnerPair(commanderFacts(first), commanderFacts(second))) {
    return { ok: false, reason: 'invalid_partner_pair' };
  }

  const identity = commanders.reduce((mask, c) => mask | c.colorIdentity, 0);
  const cardIds = new Set<number>();
  let unresolved = 0;
  for (const id of deck.cardIds) {
    const card = catalog.get(id);
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
      month: deck.month,
      cardIds,
    },
  };
}
