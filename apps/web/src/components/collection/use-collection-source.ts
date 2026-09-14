"use client";

import { useEffect, useState } from "react";
import type { CollectionTotals } from "@mtg/core/contract";
import { getAccountCollectionAction } from "@/app/collection/actions";
import { loadCollection, type StoredCollection } from "@/lib/collection-store";

/** Where the visitor's collection lives: nowhere yet, this browser, or their account. */
export type CollectionSource =
  | { kind: "loading" }
  | { kind: "none"; signedIn: boolean }
  /** `signedIn` means it's about to move to the account. */
  | { kind: "browser"; signedIn: boolean; collection: StoredCollection }
  | { kind: "account"; totals: CollectionTotals };

const CHANGED_EVENT = "mtg-deck-rec:collection-changed";

/** Tells collection views on this page to load again, e.g. after the browser's collection moved to the account. */
export function notifyCollectionChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

async function loadSource(): Promise<CollectionSource> {
  const [collection, account] = await Promise.all([loadCollection(), getAccountCollectionAction().catch(() => null)]);
  // When the account can't be checked, the visitor is treated as signed out.
  const signedIn = account?.ok === true && account.data.signedIn;
  // A collection still in this browser wins until it has moved to the account.
  if (collection) return { kind: "browser", signedIn, collection };
  if (account?.ok && account.data.totals) return { kind: "account", totals: account.data.totals };
  return { kind: "none", signedIn };
}

/** The visitor's collection, loaded on mount and again whenever it changes elsewhere on the page. */
export function useCollectionSource() {
  const [source, setSource] = useState<CollectionSource>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    let latest = 0;
    const load = () => {
      const id = ++latest;
      void loadSource().then((next) => {
        if (active && id === latest) setSource(next);
      });
    };
    load();
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, []);

  return { source, setSource };
}
