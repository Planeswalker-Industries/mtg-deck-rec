"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CollectionTotals } from "@mtg/core/contract";
import { getAccountCollectionAction } from "@/app/collection/actions";
import { collectionTotals, loadCollection, type StoredCollection } from "@/lib/collection-store";

/** A browser collection a signed-in visitor still has waiting to move to the account. */
export interface PendingMove {
  totals: { uniqueCards: number; totalQuantity: number };
  /** The last attempt failed; the next page load tries again. */
  failed: boolean;
}

/**
 * Where the visitor's collection lives: nowhere yet, this browser, or their account. An account that already holds
 * cards stays the source while a browser collection waits to move into it (`pending`), so its cards never disappear
 * from view during the move.
 */
export type CollectionSource =
  | { kind: "loading" }
  | { kind: "none"; signedIn: boolean }
  /** `signedIn` means it's about to move to the account; `moveFailed` that the last attempt didn't make it. */
  | { kind: "browser"; signedIn: boolean; collection: StoredCollection; moveFailed?: boolean }
  | { kind: "account"; totals: CollectionTotals; pending?: PendingMove };

const CHANGED_EVENT = "mtg-deck-rec:collection-changed";

/** Tells collection views on this page to load again, e.g. after the browser's collection moved to the account. */
export function notifyCollectionChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

let browserMoveFailed = false;

/** Records how the latest move of the browser collection to the account went, and has collection views reload. */
export function setBrowserMoveFailed(failed: boolean) {
  browserMoveFailed = failed;
  notifyCollectionChanged();
}

async function loadSource(): Promise<CollectionSource> {
  const [collection, account] = await Promise.all([loadCollection(), getAccountCollectionAction().catch(() => null)]);
  // When the account can't be checked, the visitor is treated as signed out.
  const signedIn = account?.ok === true && account.data.signedIn;
  const totals = account?.ok ? account.data.totals : null;
  if (collection && signedIn && totals) {
    return { kind: "account", totals, pending: { totals: collectionTotals(collection), failed: browserMoveFailed } };
  }
  // With nothing in the account yet, a collection still in this browser wins until it has moved there.
  if (collection) return { kind: "browser", signedIn, collection, ...(signedIn && browserMoveFailed ? { moveFailed: true } : {}) };
  if (totals) return { kind: "account", totals };
  return { kind: "none", signedIn };
}

/** The visitor's collection, loaded on mount and again whenever it changes elsewhere on the page. */
export function useCollectionSource() {
  const [source, setSource] = useState<CollectionSource>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(true);
  const mounted = useRef(true);
  const generation = useRef(0);

  /** Re-read the owner of inventory without temporarily changing the collection used by recommendations. */
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const id = ++generation.current;
    setRefreshing(true);
    try {
      const next = await loadSource();
      if (mounted.current && id === generation.current) setSource(next);
    } finally {
      if (mounted.current && id === generation.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener(CHANGED_EVENT, onChange);
    return () => {
      mounted.current = false;
      window.removeEventListener(CHANGED_EVENT, onChange);
    };
  }, [refresh]);

  return { source, setSource, refresh, refreshing };
}
