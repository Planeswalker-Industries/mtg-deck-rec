"use client";

import { useEffect, useState } from "react";
import type { CardId, CardSet, CardSummary, CollectionEntry } from "@mtg/core/contract";
import { MAX_COLLECTION_CARD_IDS } from "@mtg/core/schemas";
import { getApis } from "@/lib/api/client";
import type { StoredCollection } from "@/lib/collection-store";
import { useCollectionSource, type CollectionSource } from "./use-collection-source";

/** How many card chunks load at once: a large collection shouldn't spend its rate-limit budget in one burst. */
const CONCURRENT_CHUNKS = 3;

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

/**
 * The visitor's collection with every card filled in, wherever it lives. The entries come from the browser or the
 * account; the cards, their tags and the set names come from the catalog, in chunks the route accepts.
 */
export function useCollectionView(): CollectionViewState {
  const { source } = useCollectionSource();
  const [state, setState] = useState<CollectionViewState>({ status: "loading", loaded: 0, total: 0 });

  useEffect(() => {
    if (source.kind === "loading" || source.kind === "none") return;
    const from: Extract<CollectionSource, { kind: "browser" | "account" }> = source;
    let active = true;

    async function load(): Promise<CollectionViewState> {
      let entries: CollectionEntry[];
      if (from.kind === "browser") entries = browserEntries(from.collection);
      else {
        const result = await getApis().actions.getMyCollectionEntries();
        if (!result.ok) return { status: "error", message: result.error.message };
        entries = result.data;
      }
      if (entries.length === 0) return { status: "none", signedIn: from.kind === "account" || from.signedIn };

      const chunks: CardId[][] = [];
      for (let i = 0; i < entries.length; i += MAX_COLLECTION_CARD_IDS) {
        chunks.push(entries.slice(i, i + MAX_COLLECTION_CARD_IDS).map((e) => e.cardId));
      }
      const setCodes = [...new Set(entries.flatMap((e) => e.setCodes))];
      let loaded = 0;
      if (active) setState({ status: "loading", loaded, total: entries.length });

      // Set names ride along with the first chunk only: there are a few hundred sets at most.
      const results = await inBatches(chunks, CONCURRENT_CHUNKS, async (cardIds) => {
        const result = await getApis().catalog.collectionCards({ cardIds, setCodes: cardIds === chunks[0] ? setCodes : [] });
        loaded += cardIds.length;
        if (active) setState({ status: "loading", loaded, total: entries.length });
        return result;
      });
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) return { status: "error", message: failed.error.message };

      const details = new Map(results.flatMap((r) => (r.ok ? r.data.cards : [])).map((d) => [d.card.id as number, d]));
      const items = entries.flatMap((e): CollectionViewItem[] => {
        const detail = details.get(e.cardId);
        return detail ? [{ card: detail.card, tags: detail.tags, quantity: e.quantity, setCodes: e.setCodes }] : [];
      });
      const sets = results.flatMap((r) => (r.ok ? r.data.sets : []));
      return { status: "ready", where: from.kind, items, sets };
    }

    void load()
      .catch((): CollectionViewState => ({ status: "error", message: "Couldn't load your collection. Try again in a moment." }))
      .then((next) => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, [source]);

  // Nothing to load: derived here rather than set from the effect.
  if (source.kind === "none") return { status: "none", signedIn: source.signedIn };
  return state;
}
