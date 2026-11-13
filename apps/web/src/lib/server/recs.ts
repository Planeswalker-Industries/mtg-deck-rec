import type { CollectionCopies } from "@mtg/core/collection";
import type {
  AddResult,
  AddSuggestion,
  BuildFill,
  BuildResult,
  CardSummary,
  CommanderKeyId,
  CutResult,
  FixResult,
  RecContext,
  StatTargets,
  SwapResult,
  TagId,
  TagRef,
} from "@mtg/core/contract";
import { buildTally, buyLines, manaLetters, openBuyLines, toTallyCard, type BuyLines, type DeckTally, type TallyEntry } from "@mtg/core/journey";
import {
  ADD_POOL_SIZE,
  BASIC_LAND_NAMES,
  bracketExclusions,
  buildDeck,
  commanderCorpusScore,
  commanderPlayRates,
  fixPool,
  mainDeckIds,
  modeOf,
  ownCopies,
  ownedFirst,
  ownedOnly,
  rankAdds,
  rankCuts,
  rankSwaps,
  type BasicColour,
  type RankCard,
  type RoleTarget,
  type SwapPool,
} from "@mtg/core/scoring";
import { loadBracketBasics } from "./brackets";
import { fetchCardsById, rankCardOf, toCardSummary, type CardRow } from "./cards";
import { availabilityFor, loadStandIns } from "./collection-availability";
import { cachedConfig } from "./config-cache";
import { maskToIdentity } from "@mtg/core/commander";
import { commanderKeyCounts } from "./corpus";
import { deckStatTargets } from "./deck";
import { loadStatInputs, type StatInputs } from "./deck-stats";
import { loadScoringConfig } from "./scoring-config";
import { loadDeckAffinity, loadServedAdds, loadServedBuild, loadServedCuts, loadServedSwapPool } from "./serving";
import type { PublicClient } from "./supabase";

/**
 * Add, cut and swap suggestions: every read goes out at once (serving.ts), then `@mtg/core/scoring` ranks the rows with
 * the weights in `app_config.scoring`. Keep `next/cache` out of this file, so scripts can run it outside Next.js.
 */

/** How many tag-similar candidates the database returns before blending and trimming. */
const CANDIDATE_POOL = 120;
/** A pool shared across decks can't leave out any one deck's cards up front, so it holds more candidates. */
export const SHARED_SWAP_POOL = CANDIDATE_POOL + 100;
export const MAX_SWAP_LIMIT = 20;
/** Replacements shown when a request names no limit. */
export const DEFAULT_SWAP_LIMIT = 10;
export const MAX_CUT_LIMIT = 40;
export const MAX_ADD_PER_CATEGORY = 30;
/** Fix reads every add the pool scored, then keeps each Deck stats line's best (`fixPool`). */
const EVERY_ADD = Number.POSITIVE_INFINITY;

/** The colour a colourless deck's basic land (Wastes) is filed under. */
const COLOURLESS: BasicColour = "C";

export class NotFoundError extends Error {}

/**
 * How far an owned card moves up in 'first' mode (`app_config.ownership.firstBoost`, required). Read only when that
 * mode is on; otherwise nothing moves.
 */
export async function loadOwnedBoost(db: PublicClient, context: RecContext): Promise<number> {
  if (!ownedFirst(context)) return 0;
  return cachedConfig("ownership", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "ownership" });
    if (error) throw new Error(`Loading collection settings failed: ${error.message}`);
    const boost = (data as { firstBoost?: unknown } | null)?.firstBoost;
    if (typeof boost !== "number" || !Number.isFinite(boost)) throw new Error("app_config.ownership.firstBoost is missing or malformed");
    return boost;
  });
}

export async function fetchTags(db: PublicClient, ids: readonly string[]): Promise<Map<string, TagRef>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data, error } = await db.from("tags").select("id, slug, label").in("id", unique);
  if (error) throw new Error(`Loading tags failed: ${error.message}`);
  return new Map(data.map((t) => [t.id, { id: t.id as TagId, slug: t.slug, label: t.label }]));
}

function parseRoleTargets(value: unknown): RoleTarget[] {
  const roles = (value as { roles?: unknown } | null)?.roles;
  if (!Array.isArray(roles)) return [];
  return roles.flatMap((r): RoleTarget[] => {
    const { tagId, label, target } = (r ?? {}) as Record<string, unknown>;
    return typeof tagId === "string" && typeof label === "string" && typeof target === "number"
      ? [{ roleId: tagId, label, target }]
      : [];
  });
}

export function loadRoleTargets(db: PublicClient): Promise<RoleTarget[]> {
  return cachedConfig("deck_role_targets", async () => {
    const { data, error } = await db.rpc("get_public_config", { p_key: "deck_role_targets" });
    if (error) throw new Error(`Loading role targets failed: ${error.message}`);
    return parseRoleTargets(data);
  });
}

/** The tracked roles' tags, for naming the roles a card fills. */
export function loadRoleTags(db: PublicClient): Promise<Map<string, TagRef>> {
  return cachedConfig("role_tags", async () =>
    fetchTags(
      db,
      (await loadRoleTargets(db)).map((t) => t.roleId),
    ),
  );
}

/** Suggestion cards carry their tracked roles, so Deck stats can count a card the moment it is taken (T045). */
const withRoles = <T extends { card: CardSummary }>(items: readonly T[], roles: ReadonlyMap<number, readonly string[]>): T[] =>
  items.map((item) => ({ ...item, card: { ...item.card, roles: [...(roles.get(item.card.id) ?? [])] } }));

/** A swap result with each suggestion's roles, taken from the pools' candidates (the serving read already holds them). */
export function swapWithRoles(result: SwapResult, ...pools: readonly (SwapPool | null)[]): SwapResult {
  const roles = new Map<number, readonly string[]>();
  for (const pool of pools) for (const c of pool?.candidates ?? []) if (!roles.has(c.cardId)) roles.set(c.cardId, c.roles ?? []);
  return {
    ...result,
    suggestions: withRoles(result.suggestions, roles),
    ...(result.buyList ? { buyList: withRoles(result.buyList, roles) } : {}),
  };
}

const rankCards = (rows: ReadonlyMap<number, CardRow>): Map<number, RankCard> => new Map([...rows].map(([id, row]) => [id, rankCardOf(row)]));

/** The commanders' combined colour identity, as a bitmask. */
const identityMask = (commanderRows: Iterable<CardRow>): number => [...commanderRows].reduce((mask, row) => mask | row.color_identity, 0);

/** The deck's colours as the mana base reads them (`manaLetters`). */
const deckColoursOf = (commanderRows: Iterable<CardRow>): string => manaLetters(maskToIdentity(identityMask(commanderRows)));

/** Deck stats' targets for the request's commanders, as the analysis hands them to the client. */
const statTargetsOf = (
  corpus: Parameters<typeof deckStatTargets>[0],
  commanderRows: Iterable<CardRow>,
  stats: StatInputs,
  rules: Parameters<typeof deckStatTargets>[4],
): StatTargets => deckStatTargets(corpus, stats, "", maskToIdentity(identityMask(commanderRows)).length, rules);

/** The request's deck as Deck stats counts it. */
function deckTally(
  context: RecContext,
  cards: ReadonlyMap<number, RankCard>,
  roles: ReadonlyMap<number, readonly string[]>,
  commanderRows: ReadonlyMap<number, CardRow>,
): DeckTally {
  const main = context.deck.cards.flatMap((entry): TallyEntry[] => {
    const card = entry.section === "main" ? cards.get(entry.cardId) : undefined;
    return card ? [{ card: toTallyCard(card.summary, roles.get(entry.cardId) ?? []), quantity: entry.quantity }] : [];
  });
  const commanders = context.deck.commanders.flatMap((id) => {
    const row = commanderRows.get(id);
    return row ? [toTallyCard(toCardSummary(row), [])] : [];
  });
  return buildTally(main, commanders);
}

/** The basic lands' card ids by colour (Wastes under C). Only a catalog sync changes them, so they are kept like the settings. */
const loadBasicLandIds = (db: PublicClient): Promise<Map<BasicColour, number>> =>
  cachedConfig("basic_land_ids", async () => {
    const names = Object.values(BASIC_LAND_NAMES);
    const { data, error } = await db.from("cards").select("id, name").in("name", names).eq("is_basic_land", true).is("deleted_at", null);
    if (error) throw new Error(`Loading the basic lands failed: ${error.message}`);
    const byName = new Map(data.map((row) => [row.name, row.id]));
    return new Map(
      (Object.entries(BASIC_LAND_NAMES) as [BasicColour, string][]).flatMap(([colour, name]) => {
        const id = byName.get(name);
        return id === undefined ? [] : [[colour, id] as const];
      }),
    );
  });

/** The basic lands' rows by colour. */
async function loadBasicLands(db: PublicClient): Promise<Map<BasicColour, RankCard>> {
  const ids = await loadBasicLandIds(db);
  const rows = await fetchCardsById(db, [...ids.values()]);
  return new Map(
    [...ids].flatMap(([colour, id]) => {
      const row = rows.get(id);
      return row ? [[colour, rankCardOf(row)] as const] : [];
    }),
  );
}

/** Loads replacement candidates for a card under a commander (or pair). Null when the card isn't in the catalog. */
export function loadSwapPool(
  db: PublicClient,
  input: {
    targetCardId: number;
    commanderIds: readonly number[];
    includeGameChangers: boolean;
    excludeIds: readonly number[];
    ownedIds: readonly number[] | null;
    poolSize: number;
    /** Colors candidates must fit. Defaults to the commanders' combined identity. */
    identityMask?: number | undefined;
  },
): Promise<SwapPool | null> {
  return loadServedSwapPool(db, input);
}

/** The pool every deck with these commanders shares: what 'only' mode's buy list is drawn from. */
const openSwapPool = (db: PublicClient, targetCardId: number, commanderIds: readonly number[], includeGameChangers: boolean) =>
  loadSwapPool(db, { targetCardId, commanderIds, includeGameChangers, excludeIds: [], ownedIds: null, poolSize: SHARED_SWAP_POOL });

/**
 * Replacements for one card, computed for this deck alone. The swap route caches through getCachedSwapSuggestions
 * instead, which passes its cached pool as `buyPool`. In 'only' mode the pool is the collection's and the buy list
 * comes from the pool everyone gets.
 */
export async function getSwapSuggestions(
  db: PublicClient,
  {
    context,
    collection = null,
    targetCardId,
    limit = DEFAULT_SWAP_LIMIT,
    buyPool = openSwapPool,
  }: {
    context: RecContext;
    collection?: CollectionCopies | null;
    targetCardId: number;
    limit?: number;
    buyPool?: typeof openSwapPool;
  },
): Promise<SwapResult> {
  const available = await availabilityFor(db, collection);
  const only = available !== null && ownedOnly(context);
  const [pool, open, standIns, ownedBoost, scoring, bracket, affinity] = await Promise.all([
    loadSwapPool(db, {
      targetCardId,
      commanderIds: context.deck.commanders,
      includeGameChangers: context.includeGameChangers,
      excludeIds: [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])],
      ownedIds: only ? available.poolIds() : null,
      poolSize: CANDIDATE_POOL,
    }),
    only ? buyPool(db, targetCardId, context.deck.commanders, context.includeGameChangers) : Promise.resolve(null),
    loadStandIns(db, available),
    loadOwnedBoost(db, context),
    loadScoringConfig(),
    loadBracketBasics(db),
    loadDeckAffinity(db, mainDeckIds(context), context.deck.commanders),
  ]);
  if (!pool) throw new NotFoundError(`Card ${targetCardId} is not in the catalog.`);
  const excluded = bracketExclusions({ ...bracket, combos: [] }, context.bracket);
  return swapWithRoles(
    rankSwaps(pool, { context, limit, ownedBoost, scoring, availability: available, standIns, buyPool: open, excluded, affinity }),
    pool,
    open,
  );
}

export async function getCutSuggestions(
  db: PublicClient,
  { context, collection = null, limit = 20 }: { context: RecContext; collection?: CollectionCopies | null; limit?: number },
): Promise<CutResult> {
  const [served, roleTargets, scoring, available, bracket] = await Promise.all([
    loadServedCuts(db, { commanderIds: context.deck.commanders, mainIds: mainDeckIds(context) }),
    loadRoleTargets(db),
    loadScoringConfig(),
    availabilityFor(db, collection),
    loadBracketBasics(db),
  ]);
  return rankCuts({
    context,
    cards: rankCards(served.rows),
    rates: served.rates,
    roles: served.roles,
    corpus: served.corpus,
    roleTargets,
    scoring,
    availability: available,
    bracketFacts: { ...bracket, combos: served.combos },
    affinity: served.affinity,
    buyLines: cutBuyLines(context, available !== null, commanderRowsOf(context, served.rows)),
    limit,
  });
}

/** The commanders' rows among a deck's cards. */
const commanderRowsOf = (context: RecContext, rows: ReadonlyMap<number, CardRow>): CardRow[] =>
  context.deck.commanders.flatMap((id) => rows.get(id) ?? []);

/** Every line the player opened to buying, for a deck with a collection in 'only' mode; null otherwise. */
const cutBuyLines = (context: RecContext, hasCollection: boolean, commanderRows: Iterable<CardRow>): BuyLines | null =>
  hasCollection && ownedOnly(context) ? buyLines(context.buyFor, deckColoursOf(commanderRows)) : null;

/**
 * Cards to add: what decks with this commander run that this deck doesn't, scored by play rate and by the roles the
 * deck is short on. Without enough commander decks, cards widely played in decks of these colors stand in. In 'only'
 * mode the pool is the collection's (the commander's cards and the colours' it holds) and the pool everyone gets is
 * read beside it for the buy list.
 */
export async function getAddSuggestions(
  db: PublicClient,
  {
    context,
    collection = null,
    limitPerCategory = 8,
    excludeCardIds = [],
  }: {
    context: RecContext;
    collection?: CollectionCopies | null;
    limitPerCategory?: number | undefined;
    /** Cards the player passed on: left out of the pool like the deck's own, but not read as part of the deck. */
    excludeCardIds?: readonly number[] | undefined;
  },
): Promise<AddResult> {
  const deckIds = [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])];
  const available = await availabilityFor(db, collection);
  const only = available !== null && ownedOnly(context);
  // Lines opened to buying stop at their targets, so a request with any reads Deck stats' inputs in the same round.
  const buying = only && (context.buyFor?.length ?? 0) > 0;
  const [served, standIns, roleTargets, roleTags, ownedBoost, scoring, bracket, statInputs] = await Promise.all([
    loadServedAdds(db, {
      commanderIds: context.deck.commanders,
      mainIds: mainDeckIds(context),
      exclude: [...new Set([...deckIds, ...excludeCardIds])],
      allowGameChangers: context.includeGameChangers,
      owned: only ? available.poolIds() : null,
      limit: ADD_POOL_SIZE,
    }),
    loadStandIns(db, available),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadOwnedBoost(db, context),
    loadScoringConfig(),
    loadBracketBasics(db),
    buying ? loadStatInputs(db, context.deck.commanders, []) : Promise.resolve(null),
  ]);
  const { corpus } = served;
  const commanderKey: AddResult["commanderKey"] = {
    id: corpus.keyId as CommanderKeyId | null,
    slug: corpus.slug,
    commanders: context.deck.commanders.flatMap((id) => {
      const row = served.commanderRows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    ...commanderKeyCounts(corpus),
  };
  const mode = modeOf(context);
  if (!corpus.available) return { mode, commanderKey, confidence: "none", groups: [] };

  const roles = new Map([...served.deckRoles, ...served.pool.roles]);
  const deckColours = deckColoursOf(served.commanderRows.values());
  // Without Deck stats' inputs (their read failed) every opened line counts as short.
  const lines = !buying
    ? null
    : statInputs
      ? openBuyLines(
          context.buyFor,
          deckColours,
          deckTally(context, served.deckCards, roles, served.commanderRows),
          statTargetsOf(corpus, served.commanderRows.values(), statInputs, bracket.rules),
        )
      : buyLines(context.buyFor, deckColours);
  const { groups, buyList, combos } = rankAdds({
    context,
    poolIds: served.poolIds,
    cards: rankCards(served.pool.rows),
    rates: served.pool.rates,
    roles,
    corpus,
    roleTargets,
    roleTags,
    ownedBoost,
    scoring,
    availability: available,
    standIns,
    bracketFacts: { ...bracket, combos: served.combos },
    deckCards: served.deckCards,
    affinity: served.affinity,
    staples: served.pool.staples,
    buyLines: lines,
    limitPerCategory,
  });
  return {
    mode,
    commanderKey,
    confidence: corpus.confidence,
    groups: groups.map((g) => ({ ...g, suggestions: withRoles(g.suggestions, roles) })),
    ...(buyList ? { buyList: withRoles(buyList, roles) } : {}),
    ...(combos ? { combos: withRoles(combos, roles) } : {}),
  };
}

/**
 * A deck built for the context's commanders and bracket (T063): from the collection's cards with one (owned only, and
 * with `fill: 'value'` unowned cards by value for what it can't fill), from every card without one. The context's main
 * cards are kept. Read in one round (`serving_build_pool`), built by `@mtg/core/scoring` `buildDeck`.
 */
export async function getBuild(
  db: PublicClient,
  { context, collection = null, fill = "none" }: { context: RecContext; collection?: CollectionCopies | null; fill?: BuildFill | undefined },
): Promise<BuildResult> {
  const available = await availabilityFor(db, collection);
  const [served, standIns, roleTargets, roleTags, scoring, bracket, statInputs] = await Promise.all([
    loadServedBuild(db, {
      commanderIds: context.deck.commanders,
      keptIds: mainDeckIds(context),
      allowGameChangers: context.includeGameChangers,
      owned: available ? available.poolIds() : null,
      limit: ADD_POOL_SIZE,
    }),
    loadStandIns(db, available),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadScoringConfig(),
    loadBracketBasics(db),
    // Deck stats' inputs, so the build meets the check the build page and the journey grade it with.
    loadStatInputs(db, context.deck.commanders, []),
  ]);
  const { corpus } = served;
  const statTargets = statInputs ? statTargetsOf(corpus, served.commanderRows.values(), statInputs, bracket.rules) : null;
  const commanderKey: BuildResult["commanderKey"] = {
    id: corpus.keyId as CommanderKeyId | null,
    slug: corpus.slug,
    commanders: context.deck.commanders.flatMap((id) => {
      const row = served.commanderRows.get(id);
      return row ? [toCardSummary(row)] : [];
    }),
    ...commanderKeyCounts(corpus),
  };
  const built = buildDeck({
    context,
    poolIds: served.poolIds,
    fillIds: served.fillIds,
    cards: rankCards(served.cards.rows),
    rates: served.cards.rates,
    roles: served.cards.roles,
    corpus,
    roleTargets,
    roleTags,
    scoring,
    availability: available,
    standIns,
    bracketFacts: { ...bracket, combos: served.combos },
    affinity: served.affinity,
    basics: served.basics,
    fill,
    staples: served.cards.staples,
    statTargets,
  });
  return {
    mode: modeOf(context),
    commanderKey,
    confidence: corpus.confidence,
    ...built,
    groups: built.groups.map((g) => ({ ...g, cards: withRoles(g.cards, served.cards.roles) })),
    combos: withRoles(built.combos, served.cards.roles),
  };
}

/**
 * Fix's pool (T086): the cards to bring in for each Deck stats line and every main-deck card to take out, scored by
 * the ranking adds and cuts use; `fixPool` then keeps each line's best. One round, and no more calls than adds make:
 * the deck's play rates come with the commanders' rows, and the deck's combos and card pairs are the ones adds read
 * (cuts read a subset of both). The client pairs the moves itself, so nothing here depends on what the player skipped.
 */
export async function getFix(
  db: PublicClient,
  { context, collection = null }: { context: RecContext; collection?: CollectionCopies | null },
): Promise<FixResult> {
  const mainIds = mainDeckIds(context);
  const deckIds = [...new Set([...context.deck.commanders, ...context.deck.cards.map((c) => c.cardId)])];
  const available = await availabilityFor(db, collection);
  const only = available !== null && ownedOnly(context);
  const [adds, basicLands, standIns, roleTargets, roleTags, scoring, bracket, ownedBoost] = await Promise.all([
    loadServedAdds(db, {
      commanderIds: context.deck.commanders,
      mainIds,
      exclude: deckIds,
      allowGameChangers: context.includeGameChangers,
      owned: only ? available.poolIds() : null,
      limit: ADD_POOL_SIZE,
      deckRates: true,
    }),
    loadBasicLands(db),
    loadStandIns(db, available),
    loadRoleTargets(db),
    loadRoleTags(db),
    loadScoringConfig(),
    loadBracketBasics(db),
    // In 'first' mode Fix brings an owned card in ahead of an unowned one that scores a little higher, as Add does.
    loadOwnedBoost(db, context),
  ]);
  const { corpus } = adds;
  const cuts = adds.deck;
  if (!cuts) throw new Error("Fix's read came back without the deck's play rates.");
  const deckColours = deckColoursOf(adds.commanderRows.values());
  // Fix stops at a line's band by itself, so every opened line counts, whatever the deck holds.
  const lines = only ? buyLines(context.buyFor, deckColours) : null;

  const deckCards = rankCards(cuts.rows);
  const cut = rankCuts({
    context,
    cards: deckCards,
    rates: cuts.rates,
    roles: cuts.roles,
    corpus,
    roleTargets,
    scoring,
    availability: available,
    // Adds' combos hold those one card short too; cuts read the complete ones alone (`cutBracketMarks`).
    bracketFacts: { ...bracket, combos: adds.combos },
    affinity: adds.affinity,
    buyLines: lines,
    limit: mainIds.length,
  });

  const roles = new Map([...adds.deckRoles, ...adds.pool.roles]);
  const ranked = corpus.available
    ? rankAdds({
        context,
        poolIds: adds.poolIds,
        cards: rankCards(adds.pool.rows),
        rates: adds.pool.rates,
        roles,
        corpus,
        roleTargets,
        roleTags,
        ownedBoost,
        scoring,
        availability: available,
        standIns,
        bracketFacts: { ...bracket, combos: adds.combos },
        deckCards: adds.deckCards,
        affinity: adds.affinity,
        staples: adds.pool.staples,
        buyLines: lines,
        limitPerCategory: EVERY_ADD,
      })
    : { groups: [] };

  const owned = (card: RankCard) => {
    const quantity = ownCopies(available, card);
    return quantity > 0 ? { quantity } : null;
  };
  const basicColours = deckColours.length > 0 ? ([...deckColours] as BasicColour[]) : [COLOURLESS];
  const pool = fixPool({
    adds: ranked.groups.flatMap((g) => g.suggestions),
    // A twin standing in fills the roles of the card it stands in for.
    rolesOf: (add: AddSuggestion) => roles.get(add.card.id) ?? (add.owned?.standsInFor ? roles.get(add.owned.standsInFor.id) : undefined) ?? [],
    basics: basicColours.flatMap((colour) => {
      const card = basicLands.get(colour);
      return card ? [{ card, owned: owned(card) }] : [];
    }),
    deck: mainIds.flatMap((id) => {
      const card = deckCards.get(id);
      return card ? [{ card, roles: cuts.roles.get(id) ?? [], owned: owned(card) }] : [];
    }),
    cuts: cut.suggestions,
    playScore: (cardId) => {
      const rates = deckCards.get(cardId)?.isBasicLand ? null : commanderPlayRates(cuts.rates, cardId, corpus);
      return rates?.commanderRate ? commanderCorpusScore(rates.commanderRate, scoring.corpus) : null;
    },
    roleIds: roleTargets.map((t) => t.roleId),
    deckColours,
    buyLines: lines,
    only,
    ownedBoost,
  });
  return {
    mode: modeOf(context),
    confidence: corpus.confidence,
    pool,
    illegalIds: cut.suggestions.filter((s) => s.reasons.includes("NOT_LEGAL") || s.reasons.includes("OUTSIDE_COLOR_IDENTITY")).map((s) => s.card.id),
  };
}
