"use client";

import { useEffect, useMemo, useState } from "react";
import type { DeckCoverageResult, DeckId, DeckInput, OwnershipInput } from "@mtg/core/contract";
import { ownedCounts } from "@mtg/core/collection";
import { deckKey } from "@mtg/core/journey";
import type { CollectionSource } from "@/components/collection/use-collection-source";
import { getApis } from "@/lib/api/client";

type CoverageState =
  | { key: object; status: "loading" }
  | { key: object; status: "ready"; data: DeckCoverageResult }
  | { key: object; status: "error" };

/** A separate private read: only the current deck and source may put a result on screen. */
export function useDeckCoverage(deck: DeckInput | null, source: CollectionSource, deckId: DeckId | undefined, enabled: boolean) {
  const [state, setState] = useState<CoverageState | null>(null);
  // A new source object means a fresh inventory read even if its totals and ids stayed the same.
  const ownership = useMemo<OwnershipInput | null>(() => {
    if (source.kind === "account") return { kind: "account", ...(deckId ? { deckId } : {}) };
    if (source.kind !== "browser") return null;
    const copies = [...ownedCounts(source.collection.rows)].sort(([a], [b]) => a - b);
    return {
      kind: "session",
      catalogEpoch: source.collection.catalogEpoch,
      ownedCardIds: copies.map(([id]) => id),
      quantities: copies.map(([, quantity]) => quantity),
    };
  }, [source, deckId]);
  const contentKey = deck ? deckKey(deck) : null;
  const requestKey = useMemo(
    () => (enabled && contentKey !== null && ownership ? {} : null),
    [enabled, contentKey, ownership],
  );

  useEffect(() => {
    if (!requestKey || !deck || !ownership) return;
    let current = true;
    const key = requestKey;
    void (async () => {
      try {
        const result = await getApis().actions.getDeckCoverage({ deck, ownership });
        if (current) setState(result.ok ? { key, status: "ready", data: result.data } : { key, status: "error" });
      } catch {
        if (current) setState({ key, status: "error" });
      }
    })();
    return () => { current = false; };
    // The request key captures deck content and ownership; deck objects are not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return requestKey ? (state?.key === requestKey ? state : { key: requestKey, status: "loading" as const }) : null;
}
