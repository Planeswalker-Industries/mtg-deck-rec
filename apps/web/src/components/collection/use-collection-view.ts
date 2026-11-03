"use client";

import { useEffect, useMemo, useState } from "react";
import type { CardId, CardSet, CardSummary, CollectionCardDetail, CollectionEntry, CollectionTotals } from "@mtg/core/contract";
import { MAX_COLLECTION_CARD_IDS } from "@mtg/core/schemas";
import { getApis } from "@/lib/api/client";
import type { StoredCollection } from "@/lib/collection-store";
import { useCollectionSource, type CollectionSource } from "./use-collection-source";

/** How many card chunks load at once: a large collection shouldn't spend its rate-limit budget in one burst. */
const CONCURRENT_CHUNKS = 3;
/** How long loaded cards and entries are reused: returning to the page stays instant, prices are at most this stale. */
const VIEW_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Cards, sets and the account's entries already loaded in this tab. Card details are catalog data, the same for
 * every visitor; the entries are reused only while the account's totals (count, copies, last change) stay the same.
 */
const cardCache = new Map<number, { detail: CollectionCardDetail; at: number }>();
/** null records a set the catalog doesn't know, so it isn't asked for again. */
const setCache = new Map<string, { set: CardSet | null; at: number }>();
let accountEntriesCache: { key: string; entries: CollectionEntry[]; at: number } | null = null;

const isFresh = (at: number) => Date.now() - at < VIEW_CACHE_TTL_MS;
const totalsKey = (t: CollectionTotals) => `${t.uniqueCards}:${t.totalQuantity}:${t.updatedAt}`;

function cachedAccountEntries(totals: CollectionTotals): CollectionEntry[] | null {
  const cached = accountEntriesCache;
  return cached && cached.key === totalsKey(totals) && isFresh(cached.at) ? cached.entries : null;
}

/** One card in the view: the card, what it does, how many copies and which sets they came from. */
export interface CollectionViewItem {
  card: CardSummary;
  tags: string[];
  quantity: number;
  setCodes: string[];
}

export type CollectionViewState =
  | { status: "loading"; loaded: number; total: number }
  | { status: "none"; signedIn: boolean }
  | { status: "error"; message: string }
  | { status: "ready"; where: "browser" | "account"; items: CollectionViewItem[]; sets: CardSet[] };

/** A browser collection's rows folded to one entry per card, like the account's `my_collection_entries`. */
function browserEntries(collection: StoredCollection): CollectionEntry[] {
  const byCard = new Map<number, { quantity: number; setCodes: Set<string> }>();
  for (const row of collection.rows) {
    const entry = byCard.get(row.cardId) ?? { quantity: 0, setCodes: new Set<string>() };
    entry.quantity += row.quantity;
    if (row.setCode) entry.setCodes.add(row.setCode);
    byCard.set(row.cardId, entry);
  }
  return [...byCard].map(([cardId, e]) => ({ cardId: cardId as CardId, quantity: e.quantity, setCodes: [...e.setCodes] }));
}

/** Runs `run` over `items` with at most `limit` in flight, keeping results in order. */
async function inBatches<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type FilledView = { status: "ready"; items: CollectionViewItem[]; sets: CardSet[] };

/** The view built from cached cards alone, or null when any card or set still has to load. */
function fromCache(entries: CollectionEntry[]): FilledView | null {
  const items: CollectionViewItem[] = [];
  for (const e of entries) {
    const cached = cardCache.get(e.cardId);
    if (!cached || !isFresh(cached.at)) return null;
    items.push({ card: cached.detail.card, tags: cached.detail.tags, quantity: e.quantity, setCodes: e.setCodes });
  }
  const sets: CardSet[] = [];
  for (const code of new Set(entries.flatMap((e) => e.setCodes))) {
    const cached = setCache.get(code);
    if (!cached || !isFresh(cached.at)) return null;
    if (cached.set) sets.push(cached.set);
  }
  return { status: "ready", items, sets };
}

/**
 * Card details for every entry, in chunks the route accepts, asking only for what this tab hasn't loaded yet.
 * `onProgress` hears how many have loaded so far.
 */
async function fillEntries(
  entries: CollectionEntry[],
  onProgress: (loaded: number, total: number) => void,
): Promise<{ status: "error"; message: string } | FilledView> {
  const missingCards = [...new Set(entries.map((e) => e.cardId))].filter((id) => {
    const cached = cardCache.get(id);
    return !cached || !isFresh(cached.at);
  });
  const missingSets = [...new Set(entries.flatMap((e) => e.setCodes))].filter((code) => {
    const cached = setCache.get(code);
    return !cached || !isFresh(cached.at);
  });
  const chunks: CardId[][] = [];
  for (let i = 0; i < missingCards.length; i += MAX_COLLECTION_CARD_IDS) {
    chunks.push(missingCards.slice(i, i + MAX_COLLECTION_CARD_IDS));
  }
  // Only missing sets left: one request with no cards fetches them.
  if (chunks.length === 0 && missingSets.length > 0) chunks.push([]);
  let loaded = entries.length - missingCards.length;
  onProgress(loaded, entries.length);

  // Set names ride along with the first chunk only: there are a few hundred sets at most.
  const results = await inBatches(chunks, CONCURRENT_CHUNKS, async (cardIds) => {
    const setCodes = cardIds === chunks[0] ? missingSets : [];
    const result = await getApis().catalog.collectionCards({ cardIds, setCodes });
    if (result.ok) {
      const at = Date.now();
      for (const detail of result.data.cards) cardCache.set(detail.card.id, { detail, at });
      const known = new Map(result.data.sets.map((s) => [s.code, s]));
      for (const code of setCodes) setCache.set(code, { set: known.get(code) ?? null, at });
    }
    loaded += cardIds.length;
    onProgress(loaded, entries.length);
    return result;
  });
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return { status: "error", message: failed.error.message };

  // Cards the catalog didn't return stay out of the view, as before; everything else is now cached.
  const returned = new Set(results.flatMap((r) => (r.ok ? r.data.cards.map((d) => d.card.id as number) : [])));
  const asked = new Set<number>(missingCards);
  const present = entries.filter((e) => returned.has(e.cardId) || !asked.has(e.cardId));
  return fromCache(present) ?? { status: "error", message: "Couldn't load your collection. Try again in a moment." };
}

/**
 * The visitor's collection with every card filled in, wherever it lives. The entries come from the browser or the
 * account; the cards, their tags and the set names come from the catalog, in chunks the route accepts.
 */
export function useCollectionView(): CollectionViewState {
  const { source } = useCollectionSource();
  const [state, setState] = useState<CollectionViewState>({ status: "loading", loaded: 0, total: 0 });

  // A collection this tab has already loaded, unchanged since, shows at once without asking the server again.
  const cached = useMemo((): CollectionViewState | null => {
    if (source.kind !== "browser" && source.kind !== "account") return null;
    const entries = source.kind === "browser" ? browserEntries(source.collection) : cachedAccountEntries(source.totals);
    if (!entries || entries.length === 0) return null;
    const filled = fromCache(entries);
    return filled && { ...filled, where: source.kind };
  }, [source]);

  useEffect(() => {
    if (source.kind === "loading" || source.kind === "none" || cached) return;
    const from: Extract<CollectionSource, { kind: "browser" | "account" }> = source;
    let active = true;

    async function load(): Promise<CollectionViewState> {
      let entries: CollectionEntry[];
      if (from.kind === "browser") entries = browserEntries(from.collection);
      else {
        const result = await getApis().actions.getMyCollectionEntries();
        if (!result.ok) return { status: "error", message: result.error.message };
        entries = result.data;
        accountEntriesCache = { key: totalsKey(from.totals), entries, at: Date.now() };
      }
      if (entries.length === 0) return { status: "none", signedIn: from.kind === "account" || from.signedIn };
      const filled = await fillEntries(entries, (loaded, total) => {
        if (active) setState({ status: "loading", loaded, total });
      });
      return filled.status === "ready" ? { ...filled, where: from.kind } : filled;
    }

    void load()
      .catch((): CollectionViewState => ({ status: "error", message: "Couldn't load your collection. Try again in a moment." }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [source, cached]);

  // Nothing to load: derived here rather than set from the effect.
  if (source.kind === "none") return { status: "none", signedIn: source.signedIn };
  return cached ?? state;
}

export type SharedCollectionViewState =
  | { status: "loading"; loaded: number; total: number }
  | { status: "error"; message: string }
  | { status: "ready"; displayName: string | null; items: CollectionViewItem[]; sets: CardSet[] };

/** Someone's shared collection, by the code in its link, with every card filled in. */
export function useSharedCollectionView(code: string): SharedCollectionViewState {
  const [state, setState] = useState<SharedCollectionViewState>({ status: "loading", loaded: 0, total: 0 });

  useEffect(() => {
    let active = true;

    async function load(): Promise<SharedCollectionViewState> {
      const result = await getApis().actions.getSharedCollection({ code });
      if (!result.ok) return { status: "error", message: result.error.message };
      const filled = await fillEntries(result.data.entries, (loaded, total) => {
        if (active) setState({ status: "loading", loaded, total });
      });
      return filled.status === "ready" ? { ...filled, displayName: result.data.displayName } : filled;
    }

    void load()
      .catch((): SharedCollectionViewState => ({ status: "error", message: "Couldn't load this collection. Try again in a moment." }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [code]);

  return state;
}
