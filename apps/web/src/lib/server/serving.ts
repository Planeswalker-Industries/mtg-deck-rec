import type { TagId, TagRef } from "@mtg/core/contract";
import {
  cardPrior,
  commanderCardCounts,
  commanderShare,
  identityBaselineDecks,
  servedCardRates,
  type SwapPool,
  type SwapPoolCandidate,
} from "@mtg/core/scoring";
import { pricesCheckedAt, rankCardOf, withPriceCheck, type CardRow } from "./cards";
import { loadCommanderCorpus, loadIdentityMonths, type CardCorpus, type CommanderCorpus } from "./corpus";
import type { Database } from "./database.types";
import type { PublicClient } from "./supabase";

/**
 * The recommendation reads (T055). Every read a request makes goes out at once: the database functions take the
 * deck's commander ids and work out the rest themselves, and each card comes back as one serving_card row (the card,
 * its stored counts for those commanders, its baseline and its roles), which becomes the CardRow and CardCorpus the
 * ranking in recs.ts reads. Keep `next/cache` out of this file, so scripts can run it outside Next.js.
 */

type ServingCard = Database["public"]["CompositeTypes"]["serving_card"];

/** One tag match as serving_swap_candidates returns it, by tag id. */
interface RawMatch {
  targetTagId: string;
  candidateTagId: string;
  viaTagId: string | null;
  distance: number;
}

/** Which pool a serving_add_pool row came from (see that function). */
type PoolKind = "commander" | "partners" | "baseline";

/** A serving_card as the CardRow fetchCardsById gives: the same columns, the price date applied the same way. */
function cardRowOf(card: ServingCard, checkedAt: string | null): CardRow {
  return withPriceCheck(
    {
      id: card.card_id ?? 0,
      oracle_id: card.oracle_id ?? "",
      name: card.name ?? "",
      slug: card.slug ?? "",
      mana_value: card.mana_value ?? 0,
      mana_cost: card.mana_cost,
      type_line: card.type_line ?? "",
      color_identity: card.color_identity ?? 0,
      images: card.images,
      game_changer: card.game_changer ?? false,
      released_at: card.released_at,
      reference_price_usd: card.reference_price_usd,
      reference_price_finish: card.reference_price_finish,
      prices_as_of: card.prices_as_of,
      legal_commander: card.legal_commander ?? "",
      can_be_commander: card.can_be_commander ?? false,
      partner_kind: card.partner_kind,
      partner_qualifier: card.partner_qualifier,
      copy_limit: card.copy_limit,
      is_basic_land: card.is_basic_land ?? false,
      artist: card.artist,
      keywords: card.keywords,
    },
    checkedAt,
  );
}

/**
 * A card's play rates under these commanders: its stored counts where a source deck ran it, a pair's partner totals at
 * their weight, or counts from the commander's deck months where nothing ran it; shrunk toward the commander's EDHREC
 * page when it has one (T061) and the live baseline otherwise.
 */
function cardCorpusOf(card: ServingCard, corpus: CommanderCorpus, identityMonths: ReadonlyMap<number, Record<string, number>>): CardCorpus {
  const facts = { identity: card.color_identity ?? 0, releaseMonth: card.release_month };
  const baseline = {
    rate: card.baseline_rate ?? 0,
    decksWith: card.baseline_decks_with ?? 0,
    // Cards no deck runs have no baseline row; count the decks that could have run them from the identity histograms.
    eligibleDecks: card.baseline_eligible_decks ?? identityBaselineDecks(identityMonths, facts),
  };
  const weight = corpus.settings.partnerPoolWeight;
  const counts =
    card.decks_with !== null && card.commander_decks !== null
      ? { decksWith: card.decks_with, commanderDecks: card.commander_decks }
      : commanderCardCounts(corpus.sources, facts, {
          decksWith: weight * (card.partner_decks_with ?? 0),
          tooEarly: weight * (card.partner_too_early ?? 0),
        });
  const page = card.edhrec_decks !== null && card.edhrec_floor !== null ? { deckCount: card.edhrec_decks, floor: card.edhrec_floor } : null;
  const listing = card.prior_rate !== null && card.prior_decks !== null ? { rate: card.prior_rate, potentialDecks: card.prior_decks } : null;
  const prior = cardPrior(page, listing, baseline.rate, corpus.settings);
  return servedCardRates(counts, baseline, corpus.settings, corpus.borrowedDeckCount > 0, prior);
}

/** Card rows, play rates (none until the corpus exists) and roles for a set of serving_card rows. */
export interface ServedCards {
  rows: Map<number, CardRow>;
  rates: Map<number, CardCorpus>;
  roles: Map<number, string[]>;
}

function servedCards(
  cards: readonly ServingCard[],
  corpus: CommanderCorpus,
  identityMonths: ReadonlyMap<number, Record<string, number>>,
  checkedAt: string | null,
): ServedCards {
  const rows = new Map<number, CardRow>();
  const rates = new Map<number, CardCorpus>();
  const roles = new Map<number, string[]>();
  for (const card of cards) {
    if (card.card_id === null) continue;
    rows.set(card.card_id, cardRowOf(card, checkedAt));
    roles.set(card.card_id, (card.role_ids ?? []) as string[]);
    if (corpus.available) rates.set(card.card_id, cardCorpusOf(card, corpus, identityMonths));
  }
  return { rows, rates, roles };
}

const asCards = (data: unknown) => (data ?? []) as ServingCard[];

/**
 * What add suggestions need, read in one round: the commanders, the pool and its cards, the deck's roles. With `owned`
 * (a collection in 'only' mode), the collection's pool (the commander's cards and the colours' it holds) and, beside
 * it, the pool everyone gets, for the buy list.
 */
export interface ServedAdds {
  corpus: CommanderCorpus;
  commanderRows: Map<number, CardRow>;
  /** The pool's card ids, best first. */
  poolIds: number[];
  pool: ServedCards;
  deckRoles: Map<number, string[]>;
}

export async function loadServedAdds(
  db: PublicClient,
  input: {
    commanderIds: readonly number[];
    mainIds: readonly number[];
    exclude: readonly number[];
    allowGameChangers: boolean;
    owned: readonly number[] | null;
    limit: number;
  },
): Promise<ServedAdds> {
  const commanderIds = [...input.commanderIds];
  const pool = (owned: readonly number[] | null) =>
    db.rpc("serving_add_pool", {
      p_commander_ids: commanderIds,
      p_exclude: [...input.exclude],
      p_allow_game_changers: input.allowGameChangers,
      p_limit: input.limit,
      p_mode: "adds",
      ...(owned ? { p_owned: [...owned] } : {}),
    });
  const [poolResult, openResult, corpus, deckRolesResult, commandersResult, identityMonths, checkedAt] = await Promise.all([
    pool(input.owned),
    input.owned ? pool(null) : Promise.resolve(null),
    loadCommanderCorpus(db, commanderIds),
    input.mainIds.length > 0
      ? db.from("card_roles").select("card_id, role_id").in("card_id", [...input.mainIds])
      : Promise.resolve({ data: [] as { card_id: number; role_id: string }[], error: null }),
    db.rpc("serving_cards", { p_commander_ids: commanderIds, p_card_ids: commanderIds }),
    loadIdentityMonths(db),
    pricesCheckedAt(db),
  ]);
  if (poolResult.error) throw new Error(`Loading the add pool failed: ${poolResult.error.message}`);
  if (openResult?.error) throw new Error(`Loading the add pool failed: ${openResult.error.message}`);
  if (deckRolesResult.error) throw new Error(`Loading card roles failed: ${deckRolesResult.error.message}`);
  if (commandersResult.error) throw new Error(`Loading commanders failed: ${commandersResult.error.message}`);

  // One pool for a commander set the precompute scored; both for a pair no key knows, which picks here with the rule
  // the old path used per request. A collection's pool keeps the colours' cards too, after the chosen pool's.
  const useCommander = commanderShare(corpus.effectiveDeckCount, corpus.settings) > 0;
  const chosenCards = (rows: readonly { pool: string; position: number; card: ServingCard }[], withBaseline: boolean) => {
    const kinds = new Set(rows.map((r) => r.pool as PoolKind));
    const chosen: PoolKind = kinds.has("commander") ? "commander" : kinds.has("partners") && useCommander ? "partners" : "baseline";
    const order = (kind: PoolKind) =>
      rows
        .filter((r) => r.pool === kind)
        .sort((a, b) => a.position - b.position)
        .map((r) => r.card);
    return withBaseline && chosen !== "baseline" ? [...order(chosen), ...order("baseline")] : order(chosen);
  };
  const seen = new Set<number>();
  const poolCards = [...chosenCards(poolResult.data ?? [], input.owned !== null), ...chosenCards(openResult?.data ?? [], false)].filter(
    (c) => c.card_id !== null && !seen.has(c.card_id) && seen.add(c.card_id),
  );

  const deckRoles = new Map<number, string[]>();
  for (const { card_id, role_id } of deckRolesResult.data ?? []) deckRoles.set(card_id, [...(deckRoles.get(card_id) ?? []), role_id]);
  return {
    corpus,
    commanderRows: servedCards(asCards(commandersResult.data), corpus, identityMonths, checkedAt).rows,
    poolIds: poolCards.flatMap((c) => (c.card_id === null ? [] : [c.card_id])),
    pool: servedCards(poolCards, corpus, identityMonths, checkedAt),
    deckRoles,
  };
}

/** What cut suggestions need, read in one round: the deck's cards with their play rates and roles. */
export async function loadServedCuts(
  db: PublicClient,
  input: { commanderIds: readonly number[]; mainIds: readonly number[] },
): Promise<ServedCards & { corpus: CommanderCorpus }> {
  const commanderIds = [...input.commanderIds];
  const [cardsResult, corpus, identityMonths, checkedAt] = await Promise.all([
    db.rpc("serving_cards", { p_commander_ids: commanderIds, p_card_ids: [...input.mainIds, ...commanderIds] }),
    loadCommanderCorpus(db, commanderIds),
    loadIdentityMonths(db),
    pricesCheckedAt(db),
  ]);
  if (cardsResult.error) throw new Error(`Loading the deck's cards failed: ${cardsResult.error.message}`);
  return { corpus, ...servedCards(asCards(cardsResult.data), corpus, identityMonths, checkedAt) };
}

/**
 * Replacement candidates for a card, read in one round: the stored substitutes under the deck's filters, each with its
 * tag matches (names included), card row and play rates, plus the target's row and tag count. Null when the target
 * isn't in the catalog.
 */
export async function loadServedSwapPool(
  db: PublicClient,
  input: {
    targetCardId: number;
    commanderIds: readonly number[];
    includeGameChangers: boolean;
    excludeIds: readonly number[];
    ownedIds: readonly number[] | null;
    poolSize: number;
    identityMask?: number | undefined;
  },
): Promise<SwapPool | null> {
  const commanderIds = [...input.commanderIds];
  const [candidatesResult, tagCountResult, corpus, targetResult, identityMonths, checkedAt] = await Promise.all([
    db.rpc("serving_swap_candidates", {
      p_target: input.targetCardId,
      p_commander_ids: commanderIds,
      p_exclude: [...input.excludeIds],
      p_allow_game_changers: input.includeGameChangers,
      p_limit: input.poolSize,
      ...(input.ownedIds ? { p_owned: [...input.ownedIds] } : {}),
      ...(input.identityMask !== undefined ? { p_identity_mask: input.identityMask } : {}),
    }),
    db.rpc("rec_functional_tag_count", { p_card_id: input.targetCardId }),
    loadCommanderCorpus(db, commanderIds),
    db.rpc("serving_cards", { p_commander_ids: commanderIds, p_card_ids: [input.targetCardId] }),
    loadIdentityMonths(db),
    pricesCheckedAt(db),
  ]);
  if (candidatesResult.error) throw new Error(`Swap candidates failed: ${candidatesResult.error.message}`);
  if (tagCountResult.error) throw new Error(`Tag count failed: ${tagCountResult.error.message}`);
  if (targetResult.error) throw new Error(`Loading the card failed: ${targetResult.error.message}`);
  const targetRow = servedCards(asCards(targetResult.data), corpus, identityMonths, checkedAt).rows.get(input.targetCardId);
  if (!targetRow) return null;

  const rows = candidatesResult.data ?? [];
  const tags = new Map<string, TagRef>();
  for (const r of rows) {
    for (const t of (r.match_tags ?? []) as { id: string; slug: string; label: string }[]) {
      tags.set(t.id, { id: t.id as TagId, slug: t.slug, label: t.label });
    }
  }
  const cards = servedCards(
    rows.map((r) => r.card),
    corpus,
    identityMonths,
    checkedAt,
  );
  return {
    target: rankCardOf(targetRow),
    tagCount: tagCountResult.data ?? 0,
    corpus,
    candidates: rows.flatMap((r): SwapPoolCandidate[] => {
      const cardId = r.card.card_id;
      const row = cardId === null ? undefined : cards.rows.get(cardId);
      if (cardId === null || !row) return [];
      const matches = (r.matches ?? []) as unknown as RawMatch[];
      return [
        {
          cardId,
          card: rankCardOf(row),
          tagSimilarity: r.tag_similarity,
          stapleScore: r.staple_score,
          functionalTwin: r.is_functional_twin,
          matchedTags: matches.flatMap((m) => {
            const targetTag = tags.get(m.targetTagId);
            const candidateTag = tags.get(m.candidateTagId);
            if (!targetTag || !candidateTag) return [];
            return [{ targetTag, candidateTag, via: m.viaTagId ? (tags.get(m.viaTagId) ?? null) : null, distance: m.distance }];
          }),
          rates: cards.rates.get(cardId) ?? null,
        },
      ];
    }),
  };
}

/**
 * A pool for the rater or a commander page, read in one round with its cards: the commander's own decks whenever any
 * count (the colours' most played cards otherwise), over every source key.
 */
export async function loadServedDeckPool(
  db: PublicClient,
  input: { commanderIds: readonly number[]; exclude: readonly number[]; limit: number },
): Promise<{ corpus: CommanderCorpus; poolIds: number[]; pool: ServedCards; commanderRows: Map<number, CardRow> }> {
  const commanderIds = [...input.commanderIds];
  const [poolResult, corpus, commandersResult, identityMonths, checkedAt] = await Promise.all([
    db.rpc("serving_add_pool", {
      p_commander_ids: commanderIds,
      p_exclude: [...input.exclude],
      p_allow_game_changers: true,
      p_limit: input.limit,
      p_mode: "decks",
    }),
    loadCommanderCorpus(db, commanderIds),
    db.rpc("serving_cards", { p_commander_ids: commanderIds, p_card_ids: commanderIds }),
    loadIdentityMonths(db),
    pricesCheckedAt(db),
  ]);
  if (poolResult.error) throw new Error(`Loading the pool failed: ${poolResult.error.message}`);
  if (commandersResult.error) throw new Error(`Loading commanders failed: ${commandersResult.error.message}`);
  const rows = poolResult.data ?? [];
  const kinds = new Set(rows.map((r) => r.pool as PoolKind));
  // A pair no key knows draws on its partners' decks whenever there are any.
  const chosen: PoolKind = kinds.has("commander") ? "commander" : kinds.has("partners") && corpus.sources.length > 0 ? "partners" : "baseline";
  const poolCards = rows
    .filter((r) => r.pool === chosen)
    .sort((a, b) => a.position - b.position)
    .map((r) => r.card);
  return {
    corpus,
    poolIds: poolCards.flatMap((c) => (c.card_id === null ? [] : [c.card_id])),
    pool: servedCards(poolCards, corpus, identityMonths, checkedAt),
    commanderRows: servedCards(asCards(commandersResult.data), corpus, identityMonths, checkedAt).rows,
  };
}

/** Rows, play rates and roles for cards the request already knows (a commander page's own top list). */
export async function loadServedCards(
  db: PublicClient,
  corpus: CommanderCorpus,
  commanderIds: readonly number[],
  cardIds: readonly number[],
): Promise<ServedCards> {
  const [cardsResult, identityMonths, checkedAt] = await Promise.all([
    db.rpc("serving_cards", { p_commander_ids: [...commanderIds], p_card_ids: [...cardIds] }),
    loadIdentityMonths(db),
    pricesCheckedAt(db),
  ]);
  if (cardsResult.error) throw new Error(`Loading cards failed: ${cardsResult.error.message}`);
  return servedCards(asCards(cardsResult.data), corpus, identityMonths, checkedAt);
}
