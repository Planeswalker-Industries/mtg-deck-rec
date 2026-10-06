import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { estimateBracket, maskToIdentity } from '@mtg/core/commander';
import type { CardId, CardSummary, OracleId, RecContext } from '@mtg/core/contract';
import {
  ADD_POOL_SIZE,
  addPoolScore,
  bootstrapMean,
  cardPrior,
  commanderShare,
  countsFromTotals,
  decksSinceRelease,
  evaluateGate,
  identityBaselineDecks,
  isHeldOut,
  pageEvidence,
  parseCorpusSettings,
  parseEvalConfig,
  parseScoringConfig,
  pickCorpusSources,
  precisionAt,
  rankAdds,
  rankCuts,
  recallAt,
  sample,
  seededRandom,
  servedCardRates,
  sizeBucket,
  sourceDeckTotals,
  sourcesConfidence,
  stableUnit,
  weightedSample,
  type BaselineCounts,
  type CardFacts,
  type CardPlayRates,
  type CorpusKey,
  type CorpusSettings,
  type EvalConfig,
  type Interval,
  type RankCard,
  type RankCorpus,
  type RoleTarget,
  type RowSums,
  type ScoringConfig,
  type SourceDeckTotals,
} from '@mtg/core/scoring';
import { DATA_DIR } from '../lib/config';
import { loadCatalog, loadCorpusConfig, loadCorpusDecks, resolveDeck, type CatalogCard, type CorpusConfig } from '../lib/corpus';
import { connect, type Sql } from '../lib/db';
import { globalStatRows, identityMonths, type KeyAggregate } from '../lib/key-stats';
import { loadEdhrecPages, type PageRows } from '../lib/serving';

/**
 * `cli eval:holdout` (T058; docs/roadmap/scoring-design.md, "Evaluation"). Holds out a seeded share of the collated
 * decks, rebuilds every play rate from the rest in memory, and grades the app's own ranking (`@mtg/core/scoring`
 * `rankAdds`, `rankCuts`) on the held-out decks:
 *
 * - adds: hide some nonland cards, ask for adds, count how many hidden cards come back in the top k (recall@k), and how
 *   many of those hits are generic staples (the "Sol Ring rate");
 * - cuts: plant cards from other commanders' decks, ask for cuts, count how many planted cards are in the top k;
 * - collection mode: the player owns the hidden cards and a popular sample of others, adds limited to owned cards;
 * - small commanders, simulated: commanders with plenty of decks keep only a few of their training decks;
 * - agreement with EDHREC's lists and with authors' declared brackets, reported only.
 *
 * With `--candidate <file.json>` (`{ "scoring": {...}, "corpus": {...} }`, merged over today's settings) it runs both
 * on the same split and applies the gate. `--time-split` holds out every deck updated after the EDHREC snapshot instead
 * of a random share, which is how anything EDHREC touches must be tested (its numbers already include many of our
 * older decks). Writes a report to `$MTG_DATA_DIR/reports`; reads only.
 */

/** Hidden and planted cards are drawn per deck from the seed and the deck's id, so both runs see the same ones. */
const HIDE_SALT = 'hide';
const PLANT_SALT = 'plant';
const OWN_SALT = 'own';
const SIMULATE_SALT = 'simulate';
/** Every candidate is ranked when grading, not a display-sized slice. */
const ALL_CATEGORIES = ADD_POOL_SIZE;
const UINT32_RANGE = 2 ** 32;
const MS_PER_SECOND = 1000;
/** The bracket every graded deck is asked for: the middle one, Game Changers allowed, as the parity checks used. */
const EVAL_BRACKET = 3;

interface EvalDeck {
  id: string;
  source: string;
  sourceDeckId: string;
  key: string;
  commanderIds: number[];
  identity: number;
  month: string;
  /** Non-basic cards in the 99. */
  cardIds: number[];
}

interface Data {
  catalog: Map<number, CatalogCard>;
  cards: Map<number, RankCard>;
  nonland: Set<number>;
  gameChangers: Set<number>;
  facts: Map<number, CardFacts>;
  roles: Map<number, string[]>;
  roleTargets: RoleTarget[];
  decks: EvalDeck[];
  /** EDHREC pages by commander set ('c1:c2', c2 0 for one). */
  pages: Map<string, PageRows>;
  /** 'YYYY-MM' of the EDHREC snapshot: decks updated after it can't be in EDHREC's numbers. */
  edhrecMonth: string | null;
  declaredBrackets: Map<string, number>;
}

interface Settings {
  corpus: CorpusSettings;
  config: CorpusConfig;
  scoring: ScoringConfig;
  eval: EvalConfig;
}

/** Play rates rebuilt from a set of training decks: per key, and the baseline over all of them. */
interface Training {
  aggregates: Map<string, KeyAggregate>;
  keys: CorpusKey[];
  keyByIndex: Map<number, string>;
  keysByCommander: Map<number, CorpusKey[]>;
  baseline: Map<number, BaselineCounts>;
  identityMonths: Map<number, Record<string, number>>;
  /** Baseline candidates per colour identity, best first, built on first use. */
  baselineOrder: Map<number, number[]>;
}

/** One commander set under one training: its corpus, its candidates in pool order, and play rates on demand. */
interface SetModel {
  corpus: RankCorpus;
  mask: number;
  ordered: number[];
  rates: (cardId: number) => CardPlayRates;
}

/** The serving tables' key for a commander set: 'c1:c2', with c2 0 for a single commander. */
const setKeyOf = (commanderIds: readonly number[]) => {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  return `${ids[0] ?? 0}:${ids[1] ?? 0}`;
};

const seedFor = (seed: number, salt: string, id: string) => Math.floor(stableUnit(`${seed}:${salt}:${id}`) * UINT32_RANGE);
const frontIsLand = (typeLine: string) => /\bLand\b/.test(typeLine.split(' // ')[0] ?? typeLine);
const mean = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

async function loadData(sql: Sql, config: CorpusConfig): Promise<Data> {
  const catalog = await loadCatalog(sql);
  const [details, roleRows, targetsRow, pages, snapshot, declaredRows] = await Promise.all([
    sql<{ id: number; oracle_id: string; type_line: string; mana_value: number; mana_cost: string | null; game_changer: boolean }[]>`
      select id, oracle_id, type_line, mana_value, mana_cost, game_changer from public.cards where deleted_at is null
    `,
    sql<{ card_id: number; role_id: string }[]>`select card_id, role_id::text as role_id from public.card_roles`,
    sql<{ value: { roles?: { tagId?: unknown; label?: unknown; target?: unknown }[] } }[]>`
      select value from public.app_config where key = 'deck_role_targets'
    `,
    loadEdhrecPages(sql),
    sql<{ month: string | null }[]>`select to_char(max(fetched_at), 'YYYY-MM') as month from corpus.edhrec_commanders`,
    sql<{ source_deck_id: string; declared_bracket: number }[]>`
      select source_deck_id, declared_bracket from archidekt.decks where declared_bracket is not null
    `,
  ]);

  const cards = new Map<number, RankCard>();
  const nonland = new Set<number>();
  const gameChangers = new Set<number>();
  const facts = new Map<number, CardFacts>();
  for (const d of details) {
    const c = catalog.get(d.id);
    if (!c) continue;
    const summary: CardSummary = {
      id: d.id as CardId,
      oracleId: d.oracle_id as OracleId,
      name: c.name,
      slug: c.slug,
      manaValue: d.mana_value,
      manaCost: d.mana_cost ?? '',
      typeLine: d.type_line,
      colorIdentity: maskToIdentity(c.colorIdentity),
      images: null,
      gameChanger: d.game_changer,
      released: true,
      keywords: [],
      price: null,
    };
    cards.set(d.id, { summary, colorIdentity: c.colorIdentity, legal: c.legal, isBasicLand: c.isBasicLand });
    if (!frontIsLand(d.type_line)) nonland.add(d.id);
    if (d.game_changer) gameChangers.add(d.id);
    facts.set(d.id, { identity: c.colorIdentity, releaseMonth: c.releaseMonth });
  }

  const roles = new Map<number, string[]>();
  for (const r of roleRows) roles.set(r.card_id, [...(roles.get(r.card_id) ?? []), r.role_id]);
  const roleTargets = (targetsRow[0]?.value.roles ?? []).flatMap((r): RoleTarget[] =>
    typeof r.tagId === 'string' && typeof r.label === 'string' && typeof r.target === 'number'
      ? [{ roleId: r.tagId, label: r.label, target: r.target }]
      : [],
  );

  const declaredBrackets = new Map(declaredRows.map((r) => [`archidekt:${r.source_deck_id}`, r.declared_bracket]));

  const decks: EvalDeck[] = [];
  const firstSource = new Map<string, string>();
  for await (const deck of loadCorpusDecks(sql)) {
    const resolved = resolveDeck(deck, catalog, config);
    if (!resolved.ok) continue;
    // A deck posted on two sites counts once, as the aggregate counts it.
    const seen = firstSource.get(deck.contentHash);
    if (seen === undefined) firstSource.set(deck.contentHash, deck.source);
    else if (seen !== deck.source) continue;
    decks.push({
      id: `${deck.source}:${deck.sourceDeckId}`,
      source: deck.source,
      sourceDeckId: deck.sourceDeckId,
      key: resolved.deck.key,
      commanderIds: resolved.deck.commanders.map((c) => c.id),
      identity: resolved.deck.identity,
      month: resolved.deck.month,
      cardIds: [...resolved.deck.cardIds],
    });
  }
  return { catalog, cards, nonland, gameChangers, facts, roles, roleTargets, decks, pages, edhrecMonth: snapshot[0]?.month ?? null, declaredBrackets };
}

/** Per-key counts from these decks, as `tallyDecks` makes them. */
function aggregate(decks: readonly EvalDeck[], data: Data): Map<string, KeyAggregate> {
  const out = new Map<string, KeyAggregate>();
  for (const d of decks) {
    let a = out.get(d.key);
    if (!a) {
      a = {
        commanders: d.commanderIds.map((id) => data.catalog.get(id) as CatalogCard),
        identity: d.identity,
        decks: 0,
        sources: {},
        months: {},
        roleCounts: {},
        cards: new Map(),
      };
      out.set(d.key, a);
    }
    a.decks++;
    a.sources[d.source] = (a.sources[d.source] ?? 0) + 1;
    a.months[d.month] = (a.months[d.month] ?? 0) + 1;
    for (const id of d.cardIds) {
      a.cards.set(id, (a.cards.get(id) ?? 0) + 1);
      for (const role of data.roles.get(id) ?? []) a.roleCounts[role] = (a.roleCounts[role] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * Keys and the baseline from per-key counts. A simulation that changes one commander's decks passes the full training's
 * baseline (one commander's decks barely move it), which skips the costly part.
 */
function buildTraining(aggregates: Map<string, KeyAggregate>, data: Data, reuse?: Pick<Training, 'baseline' | 'identityMonths'>): Training {
  const keys: CorpusKey[] = [];
  const keyByIndex = new Map<number, string>();
  const keysByCommander = new Map<number, CorpusKey[]>();
  const decksWith = new Map<number, number>();
  for (const [key, a] of aggregates) {
    const k: CorpusKey = {
      id: keys.length,
      commander1: a.commanders[0]?.id ?? 0,
      commander2: a.commanders[1]?.id ?? null,
      identity: a.identity,
      deckCount: a.decks,
      deckMonths: a.months,
    };
    keyByIndex.set(k.id, key);
    keys.push(k);
    for (const id of a.commanders.map((c) => c.id)) keysByCommander.set(id, [...(keysByCommander.get(id) ?? []), k]);
    if (!reuse) for (const [card, n] of a.cards) decksWith.set(card, (decksWith.get(card) ?? 0) + n);
  }
  if (reuse) return { aggregates, keys, keyByIndex, keysByCommander, ...reuse, baselineOrder: new Map() };
  const monthsList = identityMonths(aggregates);
  const baseline = new Map(
    globalStatRows(decksWith, monthsList, data.catalog).map((r) => [
      r.card_id,
      { rate: r.rate, decksWith: r.decks_with, eligibleDecks: r.eligible_decks },
    ]),
  );
  return {
    aggregates,
    keys,
    keyByIndex,
    keysByCommander,
    baseline,
    identityMonths: new Map(monthsList.map((m, identity) => [identity, m])),
    baselineOrder: new Map(),
  };
}

const eligibleCandidate = (card: RankCard | undefined, mask: number) =>
  card !== undefined && card.legal && !card.isBasicLand && (card.colorIdentity & ~mask) === 0;

/** The colours' most played cards, best first: the pool for a commander whose decks earn no share yet. */
function baselineOrder(training: Training, mask: number, data: Data): number[] {
  let order = training.baselineOrder.get(mask);
  if (!order) {
    order = [...training.baseline.entries()]
      .filter(([id]) => eligibleCandidate(data.cards.get(id), mask))
      .sort((a, b) => b[1].rate - a[1].rate || (data.catalog.get(a[0])?.name ?? '').localeCompare(data.catalog.get(b[0])?.name ?? ''))
      .map(([id]) => id);
    training.baselineOrder.set(mask, order);
  }
  return order;
}

/**
 * A commander set's play rates and candidates, the way the precompute worker and the request build them: sources by
 * `pickCorpusSources`, counts per card over the sources at their weights, rates from counts and the baseline, and the
 * pool ordered by `pool_score` (or the colours' most played cards while its decks earn no share).
 */
function setModel(commanderIds: readonly number[], training: Training, settings: Settings, data: Data): SetModel {
  const ids = [...new Set(commanderIds)].sort((a, b) => a - b);
  const involved = [...new Set(ids.flatMap((id) => training.keysByCommander.get(id) ?? []))].sort((a, b) => a.id - b.id);
  const picked = pickCorpusSources(ids, involved, settings.corpus);
  const mask = ids.reduce((m, id) => m | (data.catalog.get(id)?.colorIdentity ?? 0), 0);
  const pooled = picked.borrowedDeckCount > 0;
  // The EDHREC prior (T061), as the precompute worker applies it: off when the cap is 0, and not for a pair no key knows.
  const scored = ids.length === 1 || training.aggregates.has(ids.join(':'));
  const pageRows = settings.corpus.edhrecPriorCap > 0 && scored ? (data.pages.get(setKeyOf(ids)) ?? null) : null;
  const page = pageRows?.page ?? null;

  const sums = new Map<number, RowSums>();
  const roleTotals: Record<string, number> = {};
  for (const source of picked.sources) {
    const a = training.aggregates.get(training.keyByIndex.get(source.id) ?? '');
    if (!a) continue;
    for (const [role, n] of Object.entries(a.roleCounts)) roleTotals[role] = (roleTotals[role] ?? 0) + n * source.weight;
    for (const [card, dw] of a.cards) {
      const eligible = Math.max(decksSinceRelease(a.months, data.facts.get(card)?.releaseMonth ?? null), dw);
      const sum = sums.get(card) ?? { decksWith: 0, tooEarly: 0 };
      sum.decksWith += source.weight * dw;
      sum.tooEarly += source.weight * (source.deckCount - eligible);
      sums.set(card, sum);
    }
  }

  if (pageRows) for (const cardId of pageRows.listings.keys()) if (!sums.has(cardId)) sums.set(cardId, { decksWith: 0, tooEarly: 0 });
  const priorFor = (cardId: number, baselineRate: number) => cardPrior(page, pageRows?.listings.get(cardId) ?? null, baselineRate, settings.corpus);

  const totalsMemo = new Map<string, SourceDeckTotals>();
  const countsFor = (cardId: number) => {
    const f = data.facts.get(cardId) ?? { identity: 0, releaseMonth: null };
    const memoKey = `${f.identity}:${f.releaseMonth ?? ''}`;
    let totals = totalsMemo.get(memoKey);
    if (!totals) {
      totals = sourceDeckTotals(picked.sources, f);
      totalsMemo.set(memoKey, totals);
    }
    return countsFromTotals(totals, sums.get(cardId) ?? { decksWith: 0, tooEarly: 0 });
  };
  const baselineFor = (cardId: number): BaselineCounts =>
    training.baseline.get(cardId) ?? {
      rate: 0,
      decksWith: 0,
      eligibleDecks: identityBaselineDecks(training.identityMonths, data.facts.get(cardId) ?? { identity: 0, releaseMonth: null }),
    };
  const ratesMemo = new Map<number, CardPlayRates>();
  const rates = (cardId: number): CardPlayRates => {
    let r = ratesMemo.get(cardId);
    if (!r) {
      const baseline = baselineFor(cardId);
      r = servedCardRates(countsFor(cardId), baseline, settings.corpus, pooled, priorFor(cardId, baseline.rate));
      ratesMemo.set(cardId, r);
    }
    return r;
  };

  const useCommander = commanderShare(picked.effectiveDeckCount + pageEvidence(page, settings.corpus), settings.corpus) > 0;
  const ordered = useCommander
    ? [...sums.keys()]
        .filter((id) => eligibleCandidate(data.cards.get(id), mask))
        .map((id) => ({
          id,
          score: addPoolScore(
            countsFor(id),
            Math.fround(baselineFor(id).rate),
            settings.corpus.shrinkAlpha,
            settings.scoring.corpus,
            priorFor(id, baselineFor(id).rate),
          ),
        }))
        .sort((a, b) => b.score - a.score || (data.catalog.get(a.id)?.name ?? '').localeCompare(data.catalog.get(b.id)?.name ?? ''))
        .map((e) => e.id)
    : baselineOrder(training, mask, data);

  const roleProfile = Object.fromEntries(
    Object.entries(roleTotals).map(([role, total]) => [role, total / Math.max(picked.effectiveDeckCount, 1)]),
  );
  return {
    corpus: {
      settings: settings.corpus,
      confidence: sourcesConfidence(picked, settings.corpus),
      effectiveDeckCount: picked.effectiveDeckCount,
      roleProfile,
    },
    mask,
    ordered,
    rates,
  };
}

const contextFor = (deck: EvalDeck, cards: readonly number[], owned?: readonly number[]): RecContext => ({
  deck: { commanders: deck.commanderIds as CardId[], cards: cards.map((cardId) => ({ cardId: cardId as CardId, quantity: 1, section: 'main' as const })) },
  bracket: EVAL_BRACKET,
  bracketSource: 'inferred',
  includeGameChangers: true,
  ownership: owned ? { kind: 'session', catalogEpoch: 'eval', ownedCardIds: owned as CardId[] } : null,
  ...(owned ? { ownershipMode: 'only' as const } : {}),
});

/** The adds for a deck as one list, best first, every category together. */
function rankedAdds(deck: EvalDeck, visible: readonly number[], model: SetModel, settings: Settings, data: Data, owned?: ReadonlySet<number>): number[] {
  const taken = new Set([...deck.commanderIds, ...visible]);
  const poolIds = model.ordered.filter((id) => !taken.has(id) && (!owned || owned.has(id))).slice(0, ADD_POOL_SIZE);
  const cards = new Map(poolIds.flatMap((id) => (data.cards.has(id) ? [[id, data.cards.get(id) as RankCard] as const] : [])));
  const rates = new Map(poolIds.map((id) => [id, model.rates(id)]));
  const roles = new Map([...poolIds, ...visible].map((id) => [id, data.roles.get(id) ?? []]));
  const groups = rankAdds({
    context: contextFor(deck, visible, owned ? [...owned] : undefined),
    poolIds,
    cards,
    rates,
    roles,
    corpus: model.corpus,
    roleTargets: data.roleTargets,
    roleTags: new Map(),
    ownedBoost: 0,
    scoring: settings.scoring,
    limitPerCategory: ALL_CATEGORIES,
  });
  return groups
    .flatMap((g) => g.suggestions)
    .sort((a, b) => b.score.total - a.score.total)
    .map((s) => s.card.id as number);
}

interface DeckResult {
  commanderKey: string;
  addRecall: number;
  addHits: number;
  stapleHits: number;
  cutPrecision: number;
  collectionRecall: number;
}

/**
 * Grades one held-out deck: adds, cuts and collection mode (adds alone for a simulation). Null when it has too few
 * nonland cards to hide.
 */
function gradeDeck(deck: EvalDeck, model: SetModel, training: Training, settings: Settings, data: Data, addsOnly = false): DeckResult | null {
  const e = settings.eval;
  const nonland = deck.cardIds.filter((id) => data.nonland.has(id));
  if (nonland.length < e.hiddenCards) return null;
  const hidden = sample(nonland, e.hiddenCards, seededRandom(seedFor(e.seed, HIDE_SALT, deck.id)));
  const hiddenSet = new Set(hidden);
  const visible = deck.cardIds.filter((id) => !hiddenSet.has(id));

  const adds = rankedAdds(deck, visible, model, settings, data);
  const top = adds.slice(0, e.recallAt);
  const hits = top.filter((id) => hiddenSet.has(id));
  const stapleHits = hits.filter((id) => (training.baseline.get(id)?.rate ?? 0) >= e.stapleBaselineRate).length;
  const addRecall = recallAt(adds, hiddenSet, e.recallAt);
  if (addsOnly) return { commanderKey: deck.key, addRecall, addHits: hits.length, stapleHits, cutPrecision: 0, collectionRecall: 0 };

  // Cuts: plant popular cards from other commanders' decks, inside the identity, that this deck doesn't run.
  const inDeck = new Set([...deck.commanderIds, ...deck.cardIds]);
  const plantable = [...training.baseline.keys()].filter(
    (id) => !inDeck.has(id) && data.nonland.has(id) && eligibleCandidate(data.cards.get(id), model.mask),
  );
  const planted = weightedSample(
    plantable,
    (id) => training.baseline.get(id)?.decksWith ?? 0,
    e.injectedCuts,
    seededRandom(seedFor(e.seed, PLANT_SALT, deck.id)),
  );
  const cutDeck = [...deck.cardIds, ...planted];
  const cutCards = new Map(cutDeck.flatMap((id) => (data.cards.has(id) ? [[id, data.cards.get(id) as RankCard] as const] : [])));
  for (const id of deck.commanderIds) if (data.cards.has(id)) cutCards.set(id, data.cards.get(id) as RankCard);
  const cuts = rankCuts({
    context: contextFor(deck, cutDeck),
    cards: cutCards,
    rates: new Map(cutDeck.map((id) => [id, model.rates(id)])),
    roles: new Map(cutDeck.map((id) => [id, data.roles.get(id) ?? []])),
    corpus: model.corpus,
    roleTargets: data.roleTargets,
    scoring: settings.scoring,
    limit: e.cutPrecisionAt,
  });
  const cutPrecision = precisionAt(
    cuts.suggestions.map((s) => s.card.id as number),
    new Set(planted),
    e.cutPrecisionAt,
  );

  // Collection mode: the player owns the hidden cards and a popular sample of others.
  const extra = weightedSample(
    plantable,
    (id) => training.baseline.get(id)?.decksWith ?? 0,
    e.collectionExtraCards,
    seededRandom(seedFor(e.seed, OWN_SALT, deck.id)),
  );
  const owned = new Set([...hidden, ...extra]);
  const collectionRecall = recallAt(rankedAdds(deck, visible, model, settings, data, owned), hiddenSet, e.recallAt);

  return {
    commanderKey: deck.key,
    addRecall,
    addHits: hits.length,
    stapleHits,
    cutPrecision,
    collectionRecall,
  };
}

interface RunResult {
  /** Per commander key with at least one graded deck: mean add recall, cut precision, collection recall. */
  commanders: Map<string, { bucket: string; addRecall: number; cutPrecision: number; collectionRecall: number; decks: number }>;
  decksGraded: number;
  addHits: number;
  stapleHits: number;
  /** Simulated small commanders: mean add recall by training decks kept. */
  simulated: Map<number, number[]>;
  edhrecOverlap: number[];
}

function run(settings: Settings, data: Data, training: Training, trainingDecks: Map<string, EvalDeck[]>, heldOut: EvalDeck[]): RunResult {
  const e = settings.eval;
  const models = new Map<string, SetModel>();
  const modelFor = (key: string, commanderIds: readonly number[]) => {
    let m = models.get(key);
    if (!m) {
      m = setModel(commanderIds, training, settings, data);
      models.set(key, m);
    }
    return m;
  };

  const byCommander = new Map<string, DeckResult[]>();
  let decksGraded = 0;
  let addHits = 0;
  let stapleHits = 0;
  for (const deck of heldOut) {
    const result = gradeDeck(deck, modelFor(deck.key, deck.commanderIds), training, settings, data);
    if (!result) continue;
    decksGraded++;
    addHits += result.addHits;
    stapleHits += result.stapleHits;
    byCommander.set(deck.key, [...(byCommander.get(deck.key) ?? []), result]);
  }

  const commanders = new Map<string, { bucket: string; addRecall: number; cutPrecision: number; collectionRecall: number; decks: number }>();
  for (const [key, results] of byCommander) {
    commanders.set(key, {
      bucket: sizeBucket(training.aggregates.get(key)?.decks ?? 0, e.bucketMinDecks),
      addRecall: mean(results.map((r) => r.addRecall)),
      cutPrecision: mean(results.map((r) => r.cutPrecision)),
      collectionRecall: mean(results.map((r) => r.collectionRecall)),
      decks: results.length,
    });
  }

  // Simulated small commanders: the same held-out decks, graded with only a few of the commander's training decks.
  const simulated = new Map<number, number[]>(e.simulatedDecks.map((n) => [n, []]));
  for (const [key, held] of groupBy(heldOut, (d) => d.key)) {
    const own = trainingDecks.get(key) ?? [];
    if (own.length < e.simulateFromDecks) continue;
    for (const n of e.simulatedDecks) {
      const kept = sample(own, n, seededRandom(seedFor(e.seed, SIMULATE_SALT, `${key}:${n}`)));
      const aggregates = new Map(training.aggregates);
      if (kept.length === 0) aggregates.delete(key);
      else aggregates.set(key, aggregate(kept, data).get(key) as KeyAggregate);
      const reduced = buildTraining(aggregates, data, { baseline: training.baseline, identityMonths: training.identityMonths });
      const commanderIds = held[0]?.commanderIds ?? [];
      const model = setModel(commanderIds, reduced, settings, data);
      const recalls = held.flatMap((deck) => {
        const r = gradeDeck(deck, model, reduced, settings, data, true);
        return r ? [r.addRecall] : [];
      });
      if (recalls.length > 0) simulated.get(n)?.push(mean(recalls));
    }
  }

  // EDHREC agreement: our pool's top against EDHREC's top by inclusion, for commanders with a page.
  const edhrecOverlap: number[] = [];
  for (const key of commanders.keys()) {
    const pageRows = data.pages.get(setKeyOf(key.split(':').map(Number)));
    const model = models.get(key);
    if (!pageRows || !model) continue;
    const ours = new Set(model.ordered.slice(0, e.edhrecTop));
    const top = [...pageRows.listings]
      .sort((a, b) => b[1].rate - a[1].rate || a[0] - b[0])
      .slice(0, e.edhrecTop)
      .map(([id]) => id);
    if (top.length > 0) edhrecOverlap.push(top.filter((id) => ours.has(id)).length / top.length);
  }

  return { commanders, decksGraded, addHits, stapleHits, simulated, edhrecOverlap };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) out.set(keyOf(item), [...(out.get(keyOf(item)) ?? []), item]);
  return out;
}

/** Deep merge of plain objects; arrays and values in `over` replace. */
function merge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over) || base === null || typeof base !== 'object') return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
  return out as T;
}

interface Summary {
  label: string;
  commanders: number;
  decksGraded: number;
  addRecall: Interval;
  cutPrecision: Interval;
  collectionRecall: Interval;
  stapleRate: number;
  buckets: { bucket: string; commanders: number; addRecall: Interval }[];
  simulated: { decksKept: number; commanders: number; addRecall: number }[];
  edhrecOverlap: { commanders: number; mean: number };
}

function summarize(label: string, result: RunResult, order: readonly string[], e: EvalConfig): Summary {
  const rows = order.flatMap((k) => (result.commanders.has(k) ? [result.commanders.get(k)!] : []));
  const buckets = [...groupBy(rows, (r) => r.bucket)].map(([bucket, rs]) => ({
    bucket,
    commanders: rs.length,
    addRecall: bootstrapMean(
      rs.map((r) => r.addRecall),
      e.bootstrapResamples,
      e.seed,
    ),
  }));
  return {
    label,
    commanders: rows.length,
    decksGraded: result.decksGraded,
    addRecall: bootstrapMean(
      rows.map((r) => r.addRecall),
      e.bootstrapResamples,
      e.seed,
    ),
    cutPrecision: bootstrapMean(
      rows.map((r) => r.cutPrecision),
      e.bootstrapResamples,
      e.seed,
    ),
    collectionRecall: bootstrapMean(
      rows.map((r) => r.collectionRecall),
      e.bootstrapResamples,
      e.seed,
    ),
    stapleRate: result.addHits === 0 ? 0 : result.stapleHits / result.addHits,
    buckets: buckets.sort((a, b) => a.bucket.localeCompare(b.bucket)),
    simulated: [...result.simulated].map(([decksKept, recalls]) => ({ decksKept, commanders: recalls.length, addRecall: mean(recalls) })),
    edhrecOverlap: { commanders: result.edhrecOverlap.length, mean: mean(result.edhrecOverlap) },
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const interval = (i: Interval) => `${pct(i.mean)} (${pct(i.low)}–${pct(i.high)})`;

function markdown(summaries: readonly Summary[], extras: string[]): string {
  const lines = ['# Offline evaluation', '', ...extras, ''];
  for (const s of summaries) {
    lines.push(`## ${s.label}`, '', `${s.commanders} commanders, ${s.decksGraded} held-out decks graded.`, '');
    lines.push('| Test | Mean (95% interval) |', '|---|---|');
    lines.push(`| Adds recall@k | ${interval(s.addRecall)} |`);
    lines.push(`| Cuts precision@k | ${interval(s.cutPrecision)} |`);
    lines.push(`| Collection-mode recall@k | ${interval(s.collectionRecall)} |`);
    lines.push(`| Sol Ring rate (hits that are staples) | ${pct(s.stapleRate)} |`, '');
    lines.push('| Size bucket | Commanders | Adds recall@k |', '|---|---|---|');
    for (const b of s.buckets) lines.push(`| ${b.bucket} | ${b.commanders} | ${interval(b.addRecall)} |`);
    lines.push('', '| Simulated: training decks kept | Commanders | Adds recall@k |', '|---|---|---|');
    for (const sim of s.simulated) lines.push(`| ${sim.decksKept} | ${sim.commanders} | ${pct(sim.addRecall)} |`);
    lines.push('', `EDHREC agreement: ${pct(s.edhrecOverlap.mean)} of EDHREC's top cards in our pool's top, over ${s.edhrecOverlap.commanders} commanders with a page.`, '');
  }
  return lines.join('\n');
}

export async function evalHoldout({ candidatePath, timeSplit = false }: { candidatePath?: string; timeSplit?: boolean } = {}): Promise<void> {
  const sql = connect();
  const started = Date.now();
  try {
    const config = await loadCorpusConfig(sql);
    const [scoringRow] = await sql<{ value: Record<string, unknown> }[]>`select value from public.app_config where key = 'scoring'`;
    const baseSettings: Settings = {
      corpus: config,
      config,
      scoring: parseScoringConfig(scoringRow?.value),
      eval: parseEvalConfig(scoringRow?.value.eval),
    };
    const e = baseSettings.eval;
    const data = await loadData(sql, config);
    // The time split holds out every deck updated after the EDHREC snapshot; otherwise a seeded share.
    const snapshot = data.edhrecMonth;
    if (timeSplit && !snapshot) throw new Error('--time-split needs an EDHREC snapshot (corpus.edhrec_commanders is empty).');
    const held = (d: EvalDeck) => (timeSplit ? d.month > (snapshot ?? '') : isHeldOut(d.id, e.seed, e.holdoutShare));
    const heldOut = data.decks.filter(held);
    const train = data.decks.filter((d) => !held(d));
    const training = buildTraining(aggregate(train, data), data);
    const trainingDecks = groupBy(train, (d) => d.key);
    console.log(`eval:holdout: ${data.decks.length} decks, ${train.length} training, ${heldOut.length} held out.`);

    const baseline = run(baseSettings, data, training, trainingDecks, heldOut);
    const order = [...baseline.commanders.keys()].sort();
    const summaries = [summarize('Today\'s settings', baseline, order, e)];
    const extras: string[] = [
      `Run ${new Date().toISOString()}: seed ${e.seed}, ${timeSplit ? `every deck updated after the EDHREC snapshot (${snapshot}) held out` : `${pct(e.holdoutShare)} held out`}, ${e.hiddenCards} cards hidden, recall@${e.recallAt}, ` +
        `${e.injectedCuts} planted, precision@${e.cutPrecisionAt}, ${e.bootstrapResamples} resamples.`,
    ];

    // Authors' declared brackets against our estimate: a check on the estimator only, never a score.
    const agreement = new Map<string, number>();
    for (const deck of heldOut) {
      const declared = data.declaredBrackets.get(deck.id);
      if (declared === undefined) continue;
      const estimated = estimateBracket({ gameChangerCount: [...deck.commanderIds, ...deck.cardIds].filter((id) => data.gameChangers.has(id)).length });
      const cell = `${declared}→${estimated}`;
      agreement.set(cell, (agreement.get(cell) ?? 0) + 1);
    }
    extras.push(
      agreement.size === 0
        ? 'Bracket estimator: no held-out deck has a declared bracket yet (the crawl records them from T056 on).'
        : `Bracket estimator, declared→estimated: ${[...agreement].map(([cell, n]) => `${cell} ${n}`).join(', ')}.`,
    );

    let gateLines: string[] = [];
    if (candidatePath) {
      const overrides = JSON.parse(readFileSync(candidatePath, 'utf8')) as { scoring?: unknown; corpus?: unknown };
      const candidateSettings: Settings = {
        ...baseSettings,
        corpus: parseCorpusSettings(merge(baseSettings.corpus, overrides.corpus)),
        scoring: parseScoringConfig(merge(baseSettings.scoring, overrides.scoring)),
      };
      const candidate = run(candidateSettings, data, training, trainingDecks, heldOut);
      const candidateSummary = summarize('Candidate', candidate, order, e);
      summaries.push(candidateSummary);
      const keys = order.filter((k) => candidate.commanders.has(k));
      const gate = evaluateGate({
        baselineRecall: keys.map((k) => baseline.commanders.get(k)?.addRecall ?? 0),
        candidateRecall: keys.map((k) => candidate.commanders.get(k)?.addRecall ?? 0),
        buckets: summaries[0]!.buckets.map((b) => ({
          bucket: b.bucket,
          baseline: b.addRecall,
          candidateMean: candidateSummary.buckets.find((c) => c.bucket === b.bucket)?.addRecall.mean ?? 0,
        })),
        baselineStapleRate: summaries[0]!.stapleRate,
        candidateStapleRate: candidateSummary.stapleRate,
        solRingTolerance: e.solRingTolerance,
        resamples: e.bootstrapResamples,
        seed: e.seed,
      });
      gateLines = [
        `## Gate: ${gate.pass ? 'PASS' : 'FAIL'}`,
        '',
        ...gate.checks.map((c) => `- ${c.pass ? 'pass' : 'FAIL'}: ${c.name}: ${c.detail}`),
        '- run separately: the regression fixtures (`yarn workspace @mtg/web regress`)',
        '',
      ];
    }

    const report = markdown(summaries, extras) + (gateLines.length > 0 ? `\n${gateLines.join('\n')}` : '');
    const dir = path.join(DATA_DIR, 'reports');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(path.join(dir, `eval-${stamp}.md`), report);
    writeFileSync(path.join(dir, `eval-${stamp}.json`), JSON.stringify({ summaries, extras, gate: gateLines }, null, 2));
    console.log(report);
    console.log(`eval:holdout: report in ${dir} (${Math.round((Date.now() - started) / MS_PER_SECOND)} s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
