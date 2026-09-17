import type { FavoriteKind, TagAdminRow } from '../account';
import type { CardDetail, CardSummary, TagRef } from '../cards';
import type { ResolvedCollectionRow, UnresolvedCollectionRow } from '../collection';
import type {
  CommanderKeyRef,
  DeckAnalysis,
  DeckCardEntry,
  DeckInput,
  DeckIssue,
  DeckSection,
  ParsedLine,
  ResolvedLine,
  SavedDeckSummary,
} from '../decks';
import type { ApiError, Result } from '../errors';
import type { Bracket, CardId, CommanderKeyId, DeckId, TagId } from '../ids';
import type {
  AddResult,
  AddSuggestion,
  CardCategory,
  CorpusEvidence,
  CostDelta,
  CutReason,
  CutResult,
  CutSuggestion,
  OwnershipInput,
  RecContext,
  ScoreBreakdown,
  ScoreComponent,
  SwapResult,
  SwapSuggestion,
  TagMatch,
  VoteSummary,
} from '../recs';
import type { CommanderRequest, CommanderRequestStatus } from '../commander-requests';
import type { ActionsApi, CatalogApi, DataApi, RecsApi } from '../transport';
import {
  frontFaceName,
  MOCK_AS_OF,
  MOCK_COMMANDER_ID,
  mockCardTags,
  mockCards,
  mockDecklistText,
  mockTagParent,
  mockTags,
} from './fixtures';

export * from './fixtures';

export interface MockApis {
  recs: RecsApi;
  actions: ActionsApi;
  catalog: CatalogApi;
  data: DataApi;
}

const MOCK_DECK_COUNT = 1204;
const MOCK_ACCOUNT_OWNED = new Set<number>([2, 3, 5, 9, 12, 16, 17]);
const WEIGHTS: Record<ScoreComponent, number> = { tag: 0.4, manaValue: 0.1, staple: 0.2, corpus: 0.2, votes: 0.1, role: 0 };
const COMPONENTS: ScoreComponent[] = ['tag', 'manaValue', 'staple', 'corpus', 'votes', 'role'];

const byId = new Map<number, CardSummary>(mockCards.map((c) => [c.id, c]));
const byName = new Map<string, CardSummary>(
  mockCards.flatMap((c) => [
    [c.name.toLowerCase(), c] as const,
    [frontFaceName(c.name).toLowerCase(), c] as const,
  ]),
);

class MockNotFound extends Error {}

const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = (code: ApiError['code'], message: string): Result<never> => ({ ok: false, error: { code, message } });
const wait = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const getCard = (id: number): CardSummary => {
  const card = byId.get(id);
  if (!card) throw new MockNotFound(`Unknown card id ${id}`);
  return card;
};

const withinIdentity = (card: CardSummary, identity: string) =>
  [...card.colorIdentity].every((color) => identity.includes(color));

const unionIdentity = (cards: CardSummary[]) =>
  [...'WUBRG'].filter((color) => cards.some((c) => c.colorIdentity.includes(color))).join('');

const isBasicLand = (card: CardSummary) => card.typeLine.startsWith('Basic Land');
const isCommanderEligible = (card: CardSummary) => card.typeLine.startsWith('Legendary Creature');

const categoryOf = (typeLine: string): CardCategory => {
  const order: CardCategory[] = ['land', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment'];
  const lower = typeLine.toLowerCase();
  return order.find((c) => lower.includes(c)) ?? 'artifact';
};

const corpusFor = (id: number): CorpusEvidence => {
  const inclusionRate = (((id * 37) % 60) + 5) / 100;
  return {
    scope: 'commander',
    decksWith: Math.round(inclusionRate * MOCK_DECK_COUNT),
    commanderDeckCount: MOCK_DECK_COUNT,
    inclusionRate,
    synergy: round(inclusionRate - 0.2),
    limited: false,
  };
};

const corpusScore = (e: CorpusEvidence) =>
  round(clamp(0.6 * (0.5 + 0.5 * clamp(e.synergy / 0.3, -1, 1)) + 0.4 * Math.sqrt(e.inclusionRate), 0, 1));

const blend = (components: Record<ScoreComponent, number | null>, voteCount: number): ScoreBreakdown => {
  const raw = Object.fromEntries(
    COMPONENTS.map((k) => {
      if (components[k] === null) return [k, 0];
      return [k, k === 'votes' ? WEIGHTS.votes * (voteCount / (voteCount + 25)) : WEIGHTS[k]];
    }),
  ) as Record<ScoreComponent, number>;
  const sum = COMPONENTS.reduce((acc, k) => acc + raw[k], 0) || 1;
  const effectiveWeights = Object.fromEntries(COMPONENTS.map((k) => [k, round(raw[k] / sum)])) as Record<ScoreComponent, number>;
  const total = COMPONENTS.reduce((acc, k) => acc + (raw[k] / sum) * (components[k] ?? 0), 0);
  return { total: round(total), components, effectiveWeights };
};

const tagMatches = (targetId: number, candidateId: number): TagMatch[] => {
  const matches: TagMatch[] = [];
  for (const tt of mockCardTags[targetId] ?? []) {
    for (const ct of mockCardTags[candidateId] ?? []) {
      if (tt.id === ct.id) {
        matches.push({ targetTag: tt, candidateTag: ct, via: null, distance: 0 });
        continue;
      }
      const tp = mockTagParent[tt.id];
      const cp = mockTagParent[ct.id];
      if (tp && cp && tp.id === cp.id) matches.push({ targetTag: tt, candidateTag: ct, via: tp, distance: 2 });
    }
  }
  return matches;
};

const tagScore = (matches: TagMatch[]) => (matches.length === 0 ? 0 : Math.max(...matches.map((m) => 0.5 ** m.distance)));

const ownedIds = (ownership: OwnershipInput | null): Set<number> | null => {
  if (!ownership) return null;
  return ownership.kind === 'session' ? new Set<number>(ownership.ownedCardIds) : MOCK_ACCOUNT_OWNED;
};

const deckCardIds = (deck: DeckInput) => new Set<number>([...deck.commanders, ...deck.cards.map((c) => c.cardId)]);
const deckIdentity = (deck: DeckInput) => unionIdentity(deck.commanders.map(getCard));

const commanderKeyRef = (commanders: CardId[]): CommanderKeyRef => {
  const has = commanders.length > 0;
  return {
    id: has ? (1 as CommanderKeyId) : null,
    slug: has ? commanders.map((id) => getCard(id).slug).join('--') : null,
    commanders: commanders.map(getCard),
    deckCount: has ? MOCK_DECK_COUNT : 0,
    confidence: has ? 'full' : 'none',
  };
};

const costDelta = (target: CardSummary, replacement: CardSummary, owned: Set<number> | null): CostDelta => {
  const targetUsd = target.price?.usd;
  const replacementUsd = replacement.price?.usd;
  if (owned?.has(replacement.id) && owned.has(target.id)) return { usd: 0, basis: 'both_owned', asOf: MOCK_AS_OF };
  if (owned?.has(replacement.id)) {
    return targetUsd === undefined
      ? { usd: null, basis: 'price_unavailable', asOf: null }
      : { usd: -targetUsd, basis: 'owned_replacement', asOf: MOCK_AS_OF };
  }
  if (targetUsd === undefined || replacementUsd === undefined) return { usd: null, basis: 'price_unavailable', asOf: null };
  return { usd: round(replacementUsd - targetUsd), basis: 'buy_replacement_vs_buy_target', asOf: MOCK_AS_OF };
};

const SECTION_HEADERS: Record<string, DeckSection> = {
  commander: 'commander',
  commanders: 'commander',
  deck: 'main',
  main: 'main',
  mainboard: 'main',
  sideboard: 'sideboard',
  maybeboard: 'maybeboard',
  considering: 'maybeboard',
  companion: 'companion',
};
const LINE = /^(?:(\d+)x?\s+)?(.+?)(?:\s+\(([A-Za-z0-9]+)\)(?:\s+(\S+))?)?$/;

/** Deliberately naive; the real parser lives in packages/core/src/parse. */
const mockParse = (text: string): ResolvedLine[] => {
  let section: DeckSection = 'main';
  const out: ResolvedLine[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const header = SECTION_HEADERS[trimmed.replace(/[:/]/g, '').trim().toLowerCase()];
    if (header) {
      section = header;
      continue;
    }
    const m = LINE.exec(trimmed);
    const name = m?.[2] ?? trimmed;
    const alchemy = /^a-/i.test(name);
    const card = byName.get(name.toLowerCase().replace(/^a-/, ''));
    const flags: ParsedLine['flags'] = card ? (alchemy ? ['alchemy_mapped'] : []) : ['unresolved'];
    const line: ParsedLine = { lineNo: i + 1, raw, quantity: Number(m?.[1] ?? 1), name, section, flags };
    if (m?.[3]) line.setCode = m[3];
    if (m?.[4]) line.collectorNumber = m[4];
    out.push({
      line,
      resolution: card
        ? { status: 'resolved', card, via: alchemy ? 'alchemy_mapped' : 'exact' }
        : { status: 'unresolved', suggestions: [] },
    });
  }
  return out;
};

const deckFromLines = (lines: ResolvedLine[]): DeckInput => {
  const commanders: CardId[] = [];
  const cards: DeckCardEntry[] = [];
  for (const { line, resolution } of lines) {
    if (resolution.status !== 'resolved') continue;
    if (line.section === 'commander') commanders.push(resolution.card.id);
    else cards.push({ cardId: resolution.card.id, quantity: line.quantity, section: line.section });
  }
  return { commanders, cards };
};

const analyze = (deck: DeckInput): DeckAnalysis => {
  const commanders = deck.commanders.map(getCard);
  const identity = unionIdentity(commanders);
  const all = [...deck.commanders, ...deck.cards.map((c) => c.cardId)].map(getCard);
  const gameChangerIds = all.filter((c) => c.gameChanger).map((c) => c.id);
  const issues: DeckIssue[] = [];
  if (commanders.length === 0) issues.push({ code: 'MISSING_COMMANDER', message: 'Pick a commander.' });
  for (const c of all) {
    if (commanders.length > 0 && !withinIdentity(c, identity)) {
      issues.push({ code: 'OUTSIDE_COLOR_IDENTITY', cardId: c.id, message: `${c.name} is outside the commander's color identity.` });
    }
  }
  const size = deck.commanders.length + deck.cards.filter((c) => c.section === 'main').reduce((n, c) => n + c.quantity, 0);
  if (size !== 100) issues.push({ code: 'WRONG_DECK_SIZE', message: `Deck has ${size} cards; Commander decks have 100.` });
  const estimatedBracket: Bracket = gameChangerIds.length === 0 ? 2 : gameChangerIds.length <= 3 ? 3 : 4;
  const analysis: DeckAnalysis = {
    deck,
    colorIdentity: identity,
    commanderKey: commanderKeyRef(deck.commanders),
    estimatedBracket,
    gameChangerIds,
    issues,
  };
  if (commanders.length === 0) analysis.commanderCandidates = all.filter(isCommanderEligible);
  return analysis;
};

const modeOf = (ctx: RecContext): SwapResult['mode'] => (ctx.ownership ? 'collection_aware' : 'collection_less');
const confidenceOf = (ctx: RecContext): SwapResult['confidence'] => (ctx.deck.commanders.length > 0 ? 'full' : 'none');
const ownedInfo = (owned: Set<number> | null, id: number) => (owned?.has(id) ? { quantity: 1 } : null);

/** In-memory implementations of the contract for frontend work (NEXT_PUBLIC_USE_MOCKS=1). */
export function createMockApis({ latencyMs = 150 }: { latencyMs?: number } = {}): MockApis {
  const delay = <T>(value: T, ms = latencyMs) => wait(value, ms);
  const decks = new Map<string, { name: string; deck: DeckInput; isPublic: boolean; updatedAt: string }>();
  const favorites = new Set<string>();
  const votes = new Map<string, -1 | 1>();
  const disabledTags = new Map<string, { reason: string; at: string }>();
  let collectionRows: ResolvedCollectionRow[] = [];
  let nextDeckId = 1;

  const voteSummary = (targetId: number, replacementId: number): VoteSummary => {
    const value = votes.get(`${targetId}:${replacementId}`);
    const up = value === 1 ? 1 : 0;
    const down = value === -1 ? 1 : 0;
    return { score: round((up + 10 * 0.5) / (up + down + 10)), voteCount: up + down, myVote: value ?? 0 };
  };

  const recs: RecsApi = {
    async swap({ context, targetCardId, limit = 10 }) {
      const target = byId.get(targetCardId);
      if (!target) return delay(fail('NOT_FOUND', `Unknown card ${targetCardId}`));
      try {
        const owned = ownedIds(context.ownership);
        const inDeck = deckCardIds(context.deck);
        const identity = deckIdentity(context.deck);
        const suggestions = mockCards
          .filter((c) => c.id !== target.id && !inDeck.has(c.id) && !isBasicLand(c) && withinIdentity(c, identity))
          .filter((c) => context.includeGameChangers || !c.gameChanger)
          .filter((c) => !owned || owned.has(c.id))
          .map((c): SwapSuggestion => {
            const matchedTags = tagMatches(target.id, c.id);
            const corpus = corpusFor(c.id);
            const votesFor = voteSummary(target.id, c.id);
            return {
              card: c,
              functionalTwin: false,
              matchedTags,
              corpus,
              score: blend(
                {
                  tag: tagScore(matchedTags),
                  manaValue: round(Math.exp(-Math.abs(c.manaValue - target.manaValue) / 1.5)),
                  staple: null,
                  corpus: corpusScore(corpus),
                  votes: votesFor.score,
                  role: null,
                },
                votesFor.voteCount,
              ),
              votes: votesFor,
              costDelta: costDelta(target, c, owned),
              owned: ownedInfo(owned, c.id),
            };
          })
          .filter((s) => (s.score.components.tag ?? 0) >= 0.25)
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, limit);

        const result: SwapResult = { mode: modeOf(context), target, confidence: confidenceOf(context), suggestions };
        if (suggestions.length === 0) {
          const noTags = (mockCardTags[target.id] ?? []).length === 0;
          result.emptyReason = noTags ? 'NO_TAGS_ON_TARGET' : owned ? 'NOTHING_OWNED_FITS' : 'NO_CANDIDATES';
        }
        return delay(ok(result));
      } catch (e) {
        return delay(fail('VALIDATION', (e as Error).message));
      }
    },

    async add({ context, limitPerCategory = 5 }) {
      try {
        const owned = ownedIds(context.ownership);
        const inDeck = deckCardIds(context.deck);
        const identity = deckIdentity(context.deck);
        const groups = new Map<CardCategory, AddSuggestion[]>();
        for (const c of mockCards) {
          if (inDeck.has(c.id) || isBasicLand(c) || !withinIdentity(c, identity)) continue;
          if (!context.includeGameChangers && c.gameChanger) continue;
          if (owned && !owned.has(c.id)) continue;
          const corpus = corpusFor(c.id);
          const category = categoryOf(c.typeLine);
          const suggestion: AddSuggestion = {
            card: c,
            category,
            corpus,
            score: blend({ tag: null, manaValue: null, staple: null, corpus: corpusScore(corpus), votes: null, role: null }, 0),
            fillsRoles: (mockCardTags[c.id] ?? []).map((tag): TagRef => mockTagParent[tag.id] ?? tag),
            owned: ownedInfo(owned, c.id),
          };
          groups.set(category, [...(groups.get(category) ?? []), suggestion]);
        }
        const result: AddResult = {
          mode: modeOf(context),
          commanderKey: commanderKeyRef(context.deck.commanders),
          confidence: confidenceOf(context),
          groups: [...groups].map(([category, list]) => ({
            category,
            suggestions: list.sort((a, b) => b.score.total - a.score.total).slice(0, limitPerCategory),
          })),
        };
        return delay(ok(result));
      } catch (e) {
        return delay(fail('VALIDATION', (e as Error).message));
      }
    },

    async cut({ context, limit = 15 }) {
      try {
        const owned = ownedIds(context.ownership);
        const identity = deckIdentity(context.deck);
        const suggestions = context.deck.cards
          .filter((entry) => entry.section === 'main')
          .flatMap((entry): CutSuggestion[] => {
            const c = getCard(entry.cardId);
            if (isBasicLand(c)) return [];
            const corpus = corpusFor(c.id);
            const score = corpusScore(corpus);
            const reasons: CutReason[] = [];
            if (!withinIdentity(c, identity)) reasons.push('OUTSIDE_COLOR_IDENTITY');
            if (c.gameChanger && !context.includeGameChangers) reasons.push('GAME_CHANGER_EXCLUDED');
            if (c.manaValue >= 5) reasons.push('HIGH_MANA_VALUE');
            if (score < 0.5) reasons.push('LOW_SYNERGY');
            if (owned && !owned.has(c.id)) reasons.push('NOT_OWNED');
            const hard = reasons.includes('OUTSIDE_COLOR_IDENTITY') || reasons.includes('GAME_CHANGER_EXCLUDED');
            return [{ card: c, cutScore: hard ? 1 : round(1 - score), reasons, corpus, owned: ownedInfo(owned, c.id) }];
          })
          .sort((a, b) => b.cutScore - a.cutScore)
          .slice(0, limit);
        const result: CutResult = { mode: modeOf(context), confidence: confidenceOf(context), suggestions };
        return delay(ok(result));
      } catch (e) {
        return delay(fail('VALIDATION', (e as Error).message));
      }
    },
  };

  // Commander deck lookups advance with the clock, so the deck tool's progress UI runs without the worker.
  const lookups = new Map<string, { commanderId: CardId; startedAt: number }>();
  const LOOKUP_DECKS = 100;
  const lookupProgress = (id: string): CommanderRequest => {
    const lookup = lookups.get(id);
    if (!lookup) throw new MockNotFound(`Unknown lookup ${id}`);
    const elapsed = Date.now() - lookup.startedAt;
    const collected = clamp(Math.floor((elapsed - 3_500) / 120), 0, LOOKUP_DECKS);
    const status: CommanderRequestStatus =
      elapsed < 1_500 ? 'checking' : elapsed < 15_500 ? 'collecting' : elapsed < 19_500 ? 'aggregating' : 'done';
    const etaSeconds = status === 'done' ? null : Math.max(Math.round((19_500 - elapsed) / 1000), 1);
    return {
      id,
      commander: getCard(lookup.commanderId),
      status,
      decksListed: status === 'checking' ? null : 240,
      decksCollected: status === 'checking' ? 0 : status === 'collecting' ? collected : LOOKUP_DECKS,
      decksTarget: LOOKUP_DECKS,
      queuePosition: 0,
      etaSeconds,
      joined: false,
      collectorOnline: true,
      error: null,
      updatedAt: new Date(lookup.startedAt + Math.min(elapsed, 19_500)).toISOString(),
    };
  };
  const activeLookupFor = (commanderId: CardId) =>
    [...lookups.entries()].find(([id, l]) => l.commanderId === commanderId && lookupProgress(id).status !== 'done')?.[0];

  const actions: ActionsApi = {
    async getCommanderCoverage({ commanderId }) {
      if (!byId.has(commanderId)) return delay(fail('NOT_FOUND', 'Unknown commander.'));
      const active = activeLookupFor(commanderId);
      return delay(ok({ request: active ? lookupProgress(active) : null, estimatedSeconds: 20, collectorOnline: true }));
    },

    async requestCommanderDecks({ commanderId }) {
      if (!byId.has(commanderId)) return delay(fail('VALIDATION', "That card can't lead a Commander deck."));
      const active = activeLookupFor(commanderId);
      const id = active ?? String(lookups.size + 1);
      if (!active) lookups.set(id, { commanderId, startedAt: Date.now() });
      return delay(ok(lookupProgress(id)));
    },

    async getCommanderRequest({ requestId }) {
      if (!lookups.has(requestId)) return delay(fail('NOT_FOUND', "That deck lookup doesn't exist."));
      return delay(ok(lookupProgress(requestId)));
    },

    async parseDeck({ text }) {
      if (text.length > 20_000) return delay(fail('PAYLOAD_TOO_LARGE', 'Decklist exceeds 20 KB.'));
      const lines = mockParse(text);
      const resolved = lines.every((l) => l.resolution.status === 'resolved');
      return delay(ok({ lines, analysis: resolved ? analyze(deckFromLines(lines)) : null }));
    },

    async importDeckFromUrl({ url }) {
      if (/moxfield\.com\/decks\//i.test(url)) {
        return delay(fail('UPSTREAM_NOT_AUTHORIZED', 'Moxfield import is not available yet. Paste the decklist text instead.'));
      }
      if (!/archidekt\.com\/decks\/\d+/i.test(url)) return delay(fail('VALIDATION', 'Unsupported deck URL.'));
      const lines = mockParse(mockDecklistText);
      return delay(ok({ lines, analysis: analyze(deckFromLines(lines)), source: 'archidekt' as const, sourceUrl: url }), 600);
    },

    async analyzeDeck({ deck }) {
      try {
        return delay(ok(analyze(deck)));
      } catch (e) {
        return delay(fail('VALIDATION', (e as Error).message));
      }
    },

    async resolveCollectionRows({ rows }) {
      if (rows.length > 2000) return delay(fail('PAYLOAD_TOO_LARGE', 'Send at most 2,000 rows per call.'));
      const resolved: ResolvedCollectionRow[] = [];
      const unresolved: UnresolvedCollectionRow[] = [];
      for (const row of rows) {
        const card = row.name ? byName.get(row.name.toLowerCase()) : undefined;
        if (!card || row.quantity <= 0) {
          unresolved.push({ rowNo: row.rowNo, input: row, reason: card ? 'INVALID' : 'NOT_FOUND' });
          continue;
        }
        resolved.push({
          rowNo: row.rowNo,
          printingId: null,
          cardId: card.id,
          finish: row.finish ?? 'nonfoil',
          condition: row.condition ?? 'NM',
          lang: row.lang ?? 'en',
          quantity: row.quantity,
          via: 'name_only',
        });
      }
      return delay(ok({ catalogEpoch: 'mock-1', resolved, unresolved }));
    },

    async saveCollectionBatch({ importId, mode, rows, final }) {
      if (importId === null && mode === 'replace') collectionRows = [];
      collectionRows.push(...rows);
      const totals = final
        ? {
            uniqueCards: new Set(collectionRows.map((r) => r.cardId)).size,
            totalQuantity: collectionRows.reduce((n, r) => n + r.quantity, 0),
            updatedAt: new Date().toISOString(),
          }
        : null;
      return delay(ok({ importId: importId ?? 'mock-import-1', totals }));
    },

    async deleteCollection() {
      collectionRows = [];
      return delay(ok(null));
    },

    async saveDeck({ deckId, name, deck, isPublic }) {
      const id = deckId ?? (`mock-deck-${nextDeckId++}` as DeckId);
      decks.set(id, { name, deck, isPublic, updatedAt: new Date().toISOString() });
      return delay(ok({ deckId: id }));
    },

    async renameDeck({ deckId, name }) {
      const saved = decks.get(deckId);
      if (!saved) return delay(fail('NOT_FOUND', 'Deck not found.'));
      decks.set(deckId, { ...saved, name, updatedAt: new Date().toISOString() });
      return delay(ok(null));
    },

    async duplicateDeck({ deckId, name }) {
      const saved = decks.get(deckId);
      if (!saved) return delay(fail('NOT_FOUND', 'Deck not found.'));
      const id = `mock-deck-${nextDeckId++}` as DeckId;
      decks.set(id, { ...saved, name: name ?? `${saved.name} (copy)`, updatedAt: new Date().toISOString() });
      return delay(ok({ deckId: id }));
    },

    async setDeckVisibility({ deckId, isPublic }) {
      const saved = decks.get(deckId);
      if (!saved) return delay(fail('NOT_FOUND', 'Deck not found.'));
      decks.set(deckId, { ...saved, isPublic, updatedAt: new Date().toISOString() });
      return delay(ok(null));
    },

    async deleteDeck({ deckId }) {
      if (!decks.delete(deckId)) return delay(fail('NOT_FOUND', 'Deck not found.'));
      return delay(ok(null));
    },

    async exportDeck({ deckId, format }) {
      const saved = decks.get(deckId);
      if (!saved) return delay(fail('NOT_FOUND', 'Deck not found.'));
      const line = (id: number, qty: number) => `${qty} ${getCard(id).name}`;
      const content = [
        'Commander',
        ...saved.deck.commanders.map((id) => line(id, 1)),
        '',
        'Deck',
        ...saved.deck.cards.map((c) => line(c.cardId, c.quantity)),
      ].join('\n');
      return delay(ok({ filename: `${saved.name || 'deck'}.${format === 'archidekt_csv' ? 'csv' : 'txt'}`, content }));
    },

    async castVote({ targetCardId, replacementCardId, value }) {
      const key = `${targetCardId}:${replacementCardId}`;
      if (value === 0) votes.delete(key);
      else votes.set(key, value);
      return delay(ok(voteSummary(targetCardId, replacementCardId)));
    },

    async setFavorite({ kind, refId, on }) {
      const key = `${kind}:${refId}`;
      if (on) favorites.add(key);
      else favorites.delete(key);
      return delay(ok(null));
    },

    async adminSetTagDisabled({ tagId, disabled, reason, includeDescendants }) {
      const affected: TagId[] = [tagId];
      if (includeDescendants) {
        for (const [childId, parent] of Object.entries(mockTagParent)) {
          if (parent.id === tagId) affected.push(childId as TagId);
        }
      }
      for (const id of affected) {
        if (disabled) disabledTags.set(id, { reason, at: new Date().toISOString() });
        else disabledTags.delete(id);
      }
      return delay(ok({ affected }));
    },

    async dealRaterCards({ commanderIds, commanderSlug }) {
      const commanders = commanderIds
        ? commanderIds.flatMap((id) => byId.get(id) ?? [])
        : (commanderSlug ?? '').split('--').flatMap((slug) => mockCards.find((c) => c.slug === slug) ?? []);
      if (commanders.length === 0 || !commanders.every(isCommanderEligible)) {
        return delay(fail('NOT_FOUND', "That card can't lead a Commander deck."));
      }
      const ids = commanders.map((c) => c.id);
      const identity = unionIdentity(commanders);
      const cards = mockCards
        .filter((c) => !ids.includes(c.id) && !c.typeLine.includes('Land') && withinIdentity(c, identity))
        .sort((a, b) => corpusScore(corpusFor(b.id)) - corpusScore(corpusFor(a.id)))
        .slice(0, 40);
      return delay(ok({ commanderKey: commanderKeyRef(ids), cards }), 400);
    },
  };

  const catalog: CatalogApi = {
    async searchCards({ q, commanderEligible, limit = 8 }) {
      const needle = q.trim().toLowerCase();
      if (needle.length < 2) return delay(fail('VALIDATION', 'Type at least 2 letters.'));
      const hits = mockCards
        .filter((c) => c.name.toLowerCase().includes(needle))
        .filter((c) => !commanderEligible || isCommanderEligible(c))
        .sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle)))
        .slice(0, limit);
      return delay(ok(hits), 50);
    },
  };

  const unwrap = <T>(r: Result<T>): T | null => (r.ok ? r.data : null);

  const data: DataApi = {
    async getCardBySlug(slug) {
      const card = mockCards.find((c) => c.slug === slug);
      if (!card) return delay(null);
      const tags = mockCardTags[card.id] ?? [];
      const ancestors = new Map<string, TagRef>();
      for (const tag of tags) {
        const parent = mockTagParent[tag.id];
        if (parent) ancestors.set(parent.id, parent);
      }
      const detail: CardDetail = {
        ...card,
        oracleText: 'Mock oracle text.',
        layout: 'normal',
        faces: null,
        legalCommander: 'legal',
        canBeCommander: isCommanderEligible(card),
        tags,
        tagAncestors: [...ancestors.values()],
        scryfallUri: `https://scryfall.com/search?q=${encodeURIComponent(`!"${card.name}"`)}`,
      };
      return delay(detail);
    },

    async getCardAlternatives(slug, opts) {
      const card = mockCards.find((c) => c.slug === slug);
      if (!card) return delay(null);
      const commander = opts?.commanderSlug ? mockCards.find((c) => c.slug === opts.commanderSlug) : getCard(MOCK_COMMANDER_ID);
      if (!commander) return delay(null);
      const context: RecContext = {
        deck: { commanders: [commander.id], cards: [] },
        bracket: 3,
        bracketSource: 'inferred',
        includeGameChangers: true,
        ownership: null,
      };
      return unwrap(await recs.swap({ context, targetCardId: card.id }));
    },

    async getCommanderBySlug(slug) {
      const commander = mockCards.find((c) => c.slug === slug && isCommanderEligible(c));
      if (!commander) return delay(null);
      const context: RecContext = {
        deck: { commanders: [commander.id], cards: [] },
        bracket: 3,
        bracketSource: 'inferred',
        includeGameChangers: true,
        ownership: null,
      };
      const top = unwrap(await recs.add({ context }));
      if (!top) return null;
      return {
        key: commanderKeyRef([commander.id]),
        top,
        roleProfile: [
          { tag: mockTags.ramp, avgPerDeck: 11.2 },
          { tag: mockTags.draw, avgPerDeck: 9.1 },
          { tag: mockTags.removal, avgPerDeck: 8.4 },
          { tag: mockTags.counter, avgPerDeck: 3 },
        ],
        computedAt: MOCK_AS_OF,
      };
    },

    async searchCards(q, opts) {
      const needle = q.trim().toLowerCase();
      const hits = mockCards
        .filter((c) => c.name.toLowerCase().includes(needle))
        .filter((c) => !opts?.commanderEligible || isCommanderEligible(c))
        .slice(0, opts?.limit ?? 10);
      return delay(hits, 50);
    },

    async getMySavedDecks() {
      const list: SavedDeckSummary[] = [...decks].map(([id, d]) => ({
        id: id as DeckId,
        name: d.name,
        commanderKey: commanderKeyRef(d.deck.commanders),
        isPublic: d.isPublic,
        cardCount: d.deck.commanders.length + d.deck.cards.reduce((n, c) => n + c.quantity, 0),
        updatedAt: d.updatedAt,
      }));
      return delay(list);
    },

    async getMyCollectionTotals() {
      if (collectionRows.length === 0) return delay(null);
      return delay({
        uniqueCards: new Set(collectionRows.map((r) => r.cardId)).size,
        totalQuantity: collectionRows.reduce((n, r) => n + r.quantity, 0),
        updatedAt: MOCK_AS_OF,
      });
    },

    async getMyFavorites() {
      return delay(
        [...favorites].map((key) => {
          const [kind, refId] = key.split(':') as [FavoriteKind, string];
          return { kind, refId };
        }),
      );
    },

    async adminListTags(q) {
      const needle = q?.trim().toLowerCase() ?? '';
      const rows: TagAdminRow[] = Object.values(mockTags)
        .filter((tag) => tag.label.toLowerCase().includes(needle) || tag.slug.includes(needle))
        .map((tag) => {
          const disabled = disabledTags.get(tag.id);
          const cardCount = mockCards.filter((c) =>
            (mockCardTags[c.id] ?? []).some((ct) => ct.id === tag.id || mockTagParent[ct.id]?.id === tag.id),
          ).length;
          return {
            tag,
            cardCount,
            disabled: disabled !== undefined,
            disabledReason: disabled?.reason ?? null,
            disabledAt: disabled?.at ?? null,
          };
        });
      return delay(rows);
    },

    async adminSyncStatus() {
      return delay([
        { job: 'scryfall_catalog', status: 'succeeded', startedAt: MOCK_AS_OF, finishedAt: MOCK_AS_OF, rowsChanged: 412, error: null },
        { job: 'oracle_tags', status: 'succeeded', startedAt: MOCK_AS_OF, finishedAt: MOCK_AS_OF, rowsChanged: 1893, error: null },
        { job: 'archidekt_crawl', status: 'running', startedAt: MOCK_AS_OF, finishedAt: null, rowsChanged: 5120, error: null },
      ]);
    },
  };

  return { recs, actions, catalog, data };
}
