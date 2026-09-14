import { setTimeout as sleep } from 'node:timers/promises';
import { HttpError, politeFetch, RateLimiter } from '../../lib/http';

/**
 * Archidekt's public read API. Staff allow read access and learning it from the site's own network requests
 * (https://archidekt.com/forum/thread/40353), ask for a link back when data is published, and warn that heavy
 * use could get the API locked down. So: one request at a time, spaced well apart, and slower after every 429.
 */
const API = 'https://archidekt.com/api';
/** Starting spacing. One per second drew 429s on 2026-09-14. Override with ARCHIDEKT_INTERVAL_MS (never below 1 s). */
const START_INTERVAL_MS = Math.max(1_000, Number(process.env.ARCHIDEKT_INTERVAL_MS) || 3_000);
const MAX_INTERVAL_MS = 60_000;
/** Archidekt's 429s carry no Retry-After, so wait this long (times the streak) before trying again. */
const RATE_LIMIT_PAUSE_MS = 5 * 60_000;
/** This many 429s in a row means pacing isn't enough: stop rather than press on. */
const MAX_CONSECUTIVE_RATE_LIMITS = 3;
/** Server errors get politeFetch's short backoff; 429s are handled here with long pauses. */
const SERVER_ERRORS: ReadonlySet<number> = new Set([500, 502, 503, 504]);
const limiter = new RateLimiter(START_INTERVAL_MS);

export const COMMANDER_FORMAT = 3;

export interface DeckSummary {
  id: number;
  name: string;
  size: number;
  deckFormat: number;
  updatedAt: string;
  createdAt: string;
}

/** Archidekt reports at most this many matching decks. Below it `count` is exact; pages continue past it either way. */
export const COUNT_CAP = 1000;

export interface DeckPage {
  count: number;
  hasNext: boolean;
  results: DeckSummary[];
}

export interface DeckListQuery {
  page: number;
  commanderName?: string | undefined;
  /** Exact deck size, as counted by Archidekt. */
  size?: number | undefined;
  edhBracket?: 1 | 2 | 3 | 4 | 5 | undefined;
  orderBy?: '-updatedAt' | '-viewCount' | undefined;
}

export interface DeckCard {
  quantity: number;
  categories: string[];
  oracleId: string;
  name: string;
}

export interface Deck {
  id: number;
  deckFormat: number;
  edhBracket: number | null;
  updatedAt: string;
  createdAt: string;
  private: boolean;
  unlisted: boolean;
  categories: { name: string; includedInDeck: boolean }[];
  cards: DeckCard[];
}

/** The response no longer looks like what the crawler was written against. Quarantine, don't guess. */
export class ShapeError extends Error {
  constructor(what: string, detail: string) {
    super(`Archidekt ${what} response changed shape: ${detail}`);
  }
}

/** Counts for this process, so reports can show request volume and how often Archidekt pushed back. */
export const requestStats = { requests: 0, retries: 0, retryStatuses: {} as Record<number, number> };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function field<T>(obj: Json, key: string, check: (value: unknown) => value is T, what: string): T {
  const value = obj[key];
  if (!check(value)) throw new ShapeError(what, `unexpected "${key}": ${JSON.stringify(value)?.slice(0, 80)}`);
  return value;
}
const isNumber = (v: unknown): v is number => typeof v === 'number';
const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isArray = (v: unknown): v is unknown[] => Array.isArray(v);
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === 'number';

/** Archidekt kept refusing requests after long pauses. Jobs stop and leave it alone. */
export class RateLimitedError extends Error {}

function countRetry(status: number): void {
  requestStats.retries++;
  requestStats.retryStatuses[status] = (requestStats.retryStatuses[status] ?? 0) + 1;
}

async function getJson(url: string): Promise<unknown> {
  for (let streak = 0; ; ) {
    requestStats.requests++;
    try {
      const res = await politeFetch(url, { limiter, retryStatuses: SERVER_ERRORS, onRetry: countRetry });
      return await res.json();
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 429) throw err;
      countRetry(429);
      streak++;
      if (streak >= MAX_CONSECUTIVE_RATE_LIMITS) {
        throw new RateLimitedError(`Archidekt answered 429 ${streak} times in a row, even after pausing; stopping`);
      }
      const interval = Math.min(limiter.intervalMs * 2, MAX_INTERVAL_MS);
      limiter.setIntervalMs(interval);
      const pauseMs = RATE_LIMIT_PAUSE_MS * streak;
      console.warn(`Archidekt rate limited a request (429). Pausing ${pauseMs / 60_000} min, then spacing requests ${interval / 1000} s apart.`);
      await sleep(pauseMs);
    }
  }
}

/**
 * One page (60 decks) of Commander decks. The filters are the ones Archidekt's own deck search sends. The commander
 * filter also matches decks that merely contain the card, so every deck must still be checked.
 */
export async function listDecks({ page, commanderName, size, edhBracket, orderBy = '-updatedAt' }: DeckListQuery): Promise<DeckPage> {
  const params = new URLSearchParams({ deckFormat: String(COMMANDER_FORMAT), orderBy, page: String(page) });
  if (commanderName !== undefined) params.set('commanderName', commanderName);
  if (size !== undefined) params.set('size', String(size));
  if (edhBracket !== undefined) params.set('edhBracket', String(edhBracket));
  return parseDeckPage(await getJson(`${API}/decks/v3/?${params}`));
}

/** Validates one page of a deck list response. Separate from fetching so saved responses can be tested offline. */
export function parseDeckPage(body: unknown): DeckPage {
  if (!isObject(body)) throw new ShapeError('deck list', 'body is not an object');

  const results = field(body, 'results', isArray, 'deck list').map((item) => {
    if (!isObject(item)) throw new ShapeError('deck list', 'result is not an object');
    return {
      id: field(item, 'id', isNumber, 'deck list'),
      name: field(item, 'name', isString, 'deck list'),
      size: field(item, 'size', isNumber, 'deck list'),
      deckFormat: field(item, 'deckFormat', isNumber, 'deck list'),
      updatedAt: field(item, 'updatedAt', isString, 'deck list'),
      createdAt: field(item, 'createdAt', isString, 'deck list'),
    };
  });
  return {
    count: field(body, 'count', isNumber, 'deck list'),
    hasNext: body.next !== null && body.next !== undefined,
    results,
  };
}

/** Full deck. Keeps only what aggregation needs: no owner, description, prices, or EDHREC-derived fields. */
export async function getDeck(id: number): Promise<Deck> {
  return parseDeck(await getJson(`${API}/decks/${id}/`));
}

/** Validates a deck detail response. Separate from fetching so saved responses can be tested offline. */
export function parseDeck(body: unknown): Deck {
  if (!isObject(body)) throw new ShapeError('deck', 'body is not an object');

  const categories = field(body, 'categories', isArray, 'deck').map((category) => {
    if (!isObject(category)) throw new ShapeError('deck', 'category is not an object');
    return {
      name: field(category, 'name', isString, 'deck'),
      includedInDeck: field(category, 'includedInDeck', isBoolean, 'deck'),
    };
  });

  const cards = field(body, 'cards', isArray, 'deck').map((entry) => {
    if (!isObject(entry)) throw new ShapeError('deck', 'card entry is not an object');
    const card = field(entry, 'card', isObject, 'deck');
    const oracleCard = field(card, 'oracleCard', isObject, 'deck');
    const entryCategories = entry.categories ?? [];
    if (!isArray(entryCategories) || !entryCategories.every(isString)) {
      throw new ShapeError('deck', 'card categories are not strings');
    }
    return {
      quantity: field(entry, 'quantity', isNumber, 'deck'),
      categories: entryCategories,
      oracleId: field(oracleCard, 'uid', isString, 'deck'),
      name: field(oracleCard, 'name', isString, 'deck'),
    };
  });

  return {
    id: field(body, 'id', isNumber, 'deck'),
    deckFormat: field(body, 'deckFormat', isNumber, 'deck'),
    edhBracket: field(body, 'edhBracket', isNumberOrNull, 'deck'),
    updatedAt: field(body, 'updatedAt', isString, 'deck'),
    createdAt: field(body, 'createdAt', isString, 'deck'),
    private: field(body, 'private', isBoolean, 'deck'),
    unlisted: field(body, 'unlisted', isBoolean, 'deck'),
    categories,
    cards,
  };
}
